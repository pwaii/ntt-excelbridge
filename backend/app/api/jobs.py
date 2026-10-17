"""Job creation and metadata routes."""

from __future__ import annotations

import logging
from pathlib import PurePosixPath
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.dependencies import get_dynamo_store, get_s3_store
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
from app.storage.dynamo_store import DynamoStore, JobAlreadyExistsError, RevisionConflictError
from app.api.workbooks import validate_selections
from app.domain.workbooks import WorkbookSelection
from app.storage.s3_store import S3Store
from app.workers.demo_pipeline import run_demo_pipeline

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)
XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


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

    _validate_xlsx_filename(payload.input_filename)
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
            "filename": payload.input_filename,
            "key": s3.input_key(job_id, "input", payload.input_filename),
            "content_type": XLSX_CONTENT_TYPE,
            "uploaded": False,
        }
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
    expected_revision: int | None = Query(default=None, ge=0),
) -> JobResponse:
    """Run the AWS-backed pass-through pipeline for the uploaded workbook."""

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
        completed = run_demo_pipeline(
            job_id,
            expected_revision=int(inspecting["revision"]),
            dynamo=dynamo,
            s3=s3,
        )
    except RevisionConflictError as error:
        # A losing duplicate must not mark the winning execution as failed.
        raise HTTPException(409, "Job changed; refresh status before retrying") from error
    except Exception as error:
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

    return JobResponse(job=_record(completed), request_id=request.state.request_id)
