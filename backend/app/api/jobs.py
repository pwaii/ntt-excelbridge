"""Job creation and metadata routes."""

from __future__ import annotations

import logging
from pathlib import PurePosixPath
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.dependencies import get_dynamo_store, get_s3_store, get_workflow_store
from app.api.workbooks import validate_selections
from app.auth import current_user_id
from app.domain.enums import JobStatus
from app.domain.models import (
    CreateJobResponse,
    JobListResponse,
    JobRecord,
    JobResponse,
    PresignedUpload,
)
from app.domain.schemas import CreateJobRequest
from app.domain.workbooks import WorkbookSelection
from app.storage.dynamo_store import DynamoStore, JobAlreadyExistsError, RevisionConflictError
from app.storage.s3_store import S3Store
from app.storage.sfn_store import WorkflowNotConfiguredError, WorkflowStore

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)
XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DEFINITIVE_START_FAILURES = {
    "AccessDeniedException",
    "InvalidArn",
    "InvalidExecutionInput",
    "StateMachineDeleting",
    "StateMachineDoesNotExist",
    "ValidationException",
}


def _definitive_start_failure(error: Exception) -> bool:
    return (
        isinstance(error, ClientError)
        and error.response.get("Error", {}).get("Code") in DEFINITIVE_START_FAILURES
    )


def _record_unknown_start(dynamo: DynamoStore, job_id: str, live_status: str) -> None:
    """Record an ambiguous StartExecution outcome without changing status.

    A timeout can happen after Step Functions accepted the execution. Keeping
    the job live prevents a client from submitting a duplicate retry; a worker
    that did start can still advance the same job through its normal CAS path.
    """

    current = dynamo.get_job(job_id)
    if not current or current.get("status") != live_status:
        return
    try:
        dynamo.update_job(
            job_id,
            int(current["revision"]),
            {
                "error_code": "WORKFLOW_START_UNKNOWN",
                "error_detail": "StartExecution outcome is unknown; reconcile the execution before retrying.",
            },
        )
    except RevisionConflictError:
        # A worker/API writer won the race; its state is authoritative.
        return


def _validate_xlsx_filename(filename: str) -> None:
    safe_name = PurePosixPath(filename).name
    if safe_name != filename or not filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="only .xlsx filenames without path separators are accepted",
        )


def _record(item: dict) -> JobRecord:
    return JobRecord.from_item(item)


@router.post("", response_model=CreateJobResponse, status_code=status.HTTP_201_CREATED)
def create_job(
    payload: CreateJobRequest,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> CreateJobResponse:
    """Create metadata and return short-lived upload URLs for workbook inputs."""

    input_filenames = payload.input_filenames or ([payload.input_filename] if payload.input_filename else [])
    if not input_filenames:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="at least one current workbook is required",
        )
    if len(set(input_filenames)) != len(input_filenames):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="current workbook filenames must be unique",
        )
    for filename in input_filenames:
        _validate_xlsx_filename(filename)
    if payload.config.requires_main_file() and not payload.main_filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="main_filename is required when standardize or update is enabled",
        )
    if payload.main_filename:
        _validate_xlsx_filename(payload.main_filename)

    job_id = str(uuid4())
    files = {
        "input": {
            "filename": input_filenames[0],
            "key": s3.input_key(job_id, "input", input_filenames[0]),
            "content_type": XLSX_CONTENT_TYPE,
            "uploaded": False,
        }
    }
    for index, filename in enumerate(input_filenames[1:], start=2):
        slot = f"input_{index}"
        files[slot] = {
            "filename": filename,
            "key": s3.input_key(job_id, slot, filename),
            "content_type": XLSX_CONTENT_TYPE,
            "uploaded": False,
        }
    if payload.main_filename:
        files["main"] = {
            "filename": payload.main_filename,
            "key": s3.input_key(job_id, "main", payload.main_filename),
            "content_type": XLSX_CONTENT_TYPE,
            "uploaded": False,
        }

    try:
        item = dynamo.create_job(
            job_id=job_id,
            owner_id=owner_id,
            config=payload.config.model_dump(mode="json"),
            files=files,
        )
        # Creating upload URLs moves the job into the upload phase.
        item = dynamo.update_job(job_id, expected_revision=0, updates={"status": JobStatus.UPLOADING.value})
    except JobAlreadyExistsError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error

    uploads = []
    for slot, file_info in files.items():
        signed = s3.create_upload_url(
            job_id=job_id,
            slot=slot,
            filename=file_info["filename"],
            content_type=XLSX_CONTENT_TYPE,
        )
        uploads.append(
            PresignedUpload(
                slot=slot,
                filename=file_info["filename"],
                key=signed["key"],
                url=signed["url"],
                expires_in=signed["expires_in"],
            )
        )

    return CreateJobResponse(
        job=_record(item),
        uploads=uploads,
        request_id=request.state.request_id,
    )


@router.get("", response_model=JobListResponse)
def list_jobs(
    request: Request,
    owner_id: str = Depends(current_user_id),
    limit: int = Query(default=50, ge=1, le=100),
    dynamo: DynamoStore = Depends(get_dynamo_store),
) -> JobListResponse:
    return JobListResponse(
        jobs=[_record(item) for item in dynamo.list_jobs_for_owner(owner_id, limit=limit)],
        request_id=request.state.request_id,
    )


@router.get("/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
) -> JobResponse:
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return JobResponse(job=_record(item), request_id=request.state.request_id)


@router.post("/{job_id}/start", response_model=JobResponse)
def start_job(
    job_id: str,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
    workflow: WorkflowStore = Depends(get_workflow_store),
    expected_revision: int | None = Query(default=None, ge=0),
) -> JobResponse:
    """Start segment 1; local development falls back to the synchronous demo."""

    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    if item.get("status") == JobStatus.COMPLETED.value:
        return JobResponse(job=_record(item), request_id=request.state.request_id)
    if item.get("status") != JobStatus.UPLOADED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"job must be UPLOADED before starting; current status is {item.get('status')}",
        )

    if isinstance(expected_revision, int) and expected_revision != int(item["revision"]):
        raise HTTPException(409, "Job revision changed; reload before Start")
    if not item.get("configuration_confirmed"):
        raise HTTPException(422, "Confirm worksheet, header row and required keys before Start")
    selections = {slot: WorkbookSelection.model_validate(value) for slot, value in item.get("workbook_selections", {}).items()}
    validate_selections(item, selections, s3)

    try:
        inspecting = dynamo.update_job(
            job_id,
            expected_revision=int(item["revision"]),
            updates={"status": JobStatus.INSPECTING.value},
        )
        if workflow.state_machine_arn:
            try:
                started = workflow.start_segment(job_id, 1, int(inspecting["revision"]))
            except Exception as error:
                current = dynamo.get_job(job_id)
                if _definitive_start_failure(error) and current:
                    try:
                        current = dynamo.update_job(
                            job_id,
                            int(current["revision"]),
                            {
                                "status": JobStatus.FAILED.value,
                                "error_code": "WORKFLOW_START_FAILED",
                                "error_detail": "The workflow was rejected before execution started.",
                            },
                        )
                    except RevisionConflictError:
                        current = dynamo.get_job(job_id) or current
                    raise HTTPException(503, "workflow start was rejected; retry the failed job") from error
                _record_unknown_start(dynamo, job_id, JobStatus.INSPECTING.value)
                raise HTTPException(
                    503,
                    "workflow start outcome is unknown; reconcile job status before retrying",
                ) from error
            try:
                # This metadata write deliberately does not consume revision.
                running = dynamo.set_execution_metadata(
                    job_id,
                    {"execution_arn": started["execution_arn"], "workflow_segment": 1},
                )
            except Exception as error:
                raise HTTPException(
                    503,
                    "workflow started; reload job status before retrying",
                ) from error
            return JobResponse(job=_record(running), request_id=request.state.request_id)
        # No ARN: run segment 1 in-process, stopping at the quality review gate.
        from app.workers.orchestrator import run_quality_segment  # local: avoids app.main import cycle

        gated = run_quality_segment(job_id, dynamo=dynamo, s3=s3)
        return JobResponse(job=_record(gated), request_id=request.state.request_id)
    except WorkflowNotConfiguredError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="workflow is not configured")
    except HTTPException:
        raise
    except RevisionConflictError as error:
        # A losing duplicate must not mark the winning execution as failed.
        raise HTTPException(409, "Job changed; refresh status before retrying") from error
    except Exception as error:
        logger.exception("demo pipeline failed for job %s", job_id, exc_info=error)
        current = dynamo.get_job(job_id)
        if current and current.get("status") not in {
            JobStatus.COMPLETED.value,
            JobStatus.FAILED.value,
        }:
            try:
                dynamo.update_job(
                    job_id,
                    expected_revision=int(current["revision"]),
                    updates={
                        "status": JobStatus.FAILED.value,
                        "error_code": "DEMO_PIPELINE_FAILED",
                    },
                )
            except Exception:
                logger.exception("failed to mark demo job as FAILED")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="workflow failed; inspect the job status and server logs",
        ) from error



@router.post("/{job_id}/cancel", response_model=JobResponse)
def cancel_job(
    job_id: str,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    workflow: WorkflowStore = Depends(get_workflow_store),
) -> JobResponse:
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    if item.get("status") in {JobStatus.COMPLETED.value, JobStatus.FAILED.value, JobStatus.CANCELLED.value}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="job is already terminal")
    execution_arn = item.get("execution_arn")
    if execution_arn and workflow.state_machine_arn:
        workflow.stop(execution_arn)
    try:
        updated = dynamo.update_job(job_id, expected_revision=int(item["revision"]), updates={"status": JobStatus.CANCELLED.value})
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="job changed; refresh and retry") from error
    return JobResponse(job=_record(updated), request_id=request.state.request_id)


@router.post("/{job_id}/retry", response_model=JobResponse)
def retry_job(
    job_id: str,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    workflow: WorkflowStore = Depends(get_workflow_store),
) -> JobResponse:
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    if item.get("status") != JobStatus.FAILED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="only FAILED jobs can be retried")
    segment = int(item.get("workflow_segment", 1))
    status_by_segment = {1: JobStatus.INSPECTING.value, 2: JobStatus.NORMALIZATION_PENDING.value, 3: JobStatus.APPLYING.value}
    try:
        updated = dynamo.update_job(job_id, int(item["revision"]), {"status": status_by_segment.get(segment, JobStatus.INSPECTING.value), "error_code": None, "error_detail": None})
    except RevisionConflictError as error:
        raise HTTPException(409, "job changed; refresh before retrying") from error
    try:
        started = workflow.start_segment(job_id, segment, int(updated["revision"]), context={"config": item.get("config", {})})
    except Exception as error:
        current = dynamo.get_job(job_id) or updated
        if _definitive_start_failure(error):
            try:
                updated = dynamo.update_job(
                    job_id,
                    int(current["revision"]),
                    {
                        "status": JobStatus.FAILED.value,
                        "error_code": "WORKFLOW_START_FAILED",
                        "error_detail": "The retry workflow was rejected before execution started.",
                    },
                )
            except RevisionConflictError:
                updated = dynamo.get_job(job_id) or current
            raise HTTPException(503, "workflow retry was rejected; job is FAILED and can be retried") from error
        _record_unknown_start(dynamo, job_id, updated["status"])
        raise HTTPException(
            503,
            "workflow retry outcome is unknown; reconcile execution status before retrying",
        ) from error
    try:
        # The worker may already have consumed the retry revision. Do not CAS
        # or increment revision just to attach the execution ARN.
        updated = dynamo.set_execution_metadata(job_id, {"execution_arn": started["execution_arn"], "workflow_segment": segment})
    except Exception as error:
        raise HTTPException(503, "workflow retry started; reload job status before retrying") from error
    return JobResponse(job=_record(updated), request_id=request.state.request_id)
