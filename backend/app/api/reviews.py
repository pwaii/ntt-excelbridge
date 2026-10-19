"""Review submission with optimistic concurrency."""

from __future__ import annotations

import json
import logging
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.dependencies import get_dynamo_store, get_s3_store, get_workflow_store
from app.auth import current_user_id
from app.domain.models import JobRecord, ReviewResponse
from app.domain.schemas import ReviewRequest
from app.services.review_report import build_report, validate_decisions
from app.storage.dynamo_store import DynamoStore, RevisionConflictError
from app.storage.s3_store import S3Store
from app.storage.sfn_store import WorkflowStore

router = APIRouter(prefix="/v1/jobs", tags=["reviews"])
logger = logging.getLogger(__name__)


@router.post("/{job_id}/reviews", response_model=ReviewResponse)
def submit_review(
    job_id: str,
    payload: ReviewRequest,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
    workflow: WorkflowStore = Depends(get_workflow_store),
) -> ReviewResponse:
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    if payload.approved_by and payload.approved_by != owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="approved_by must match authenticated user",
        )

    review_id = str(uuid4())
    current_status = item.get("status")
    next_status = {
        "QUALITY_REVIEW_PENDING": "NORMALIZATION_PENDING",
        "TRANSFORMATION_REVIEW_PENDING": "APPLYING",
    }.get(current_status)
    if not next_status:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="job is not waiting for a review"
        )
    if payload.expected_revision != int(item["revision"]):
        raise HTTPException(409, "REVIEW_REVISION_CONFLICT: reload before submitting")
    stage = "quality" if current_status == "QUALITY_REVIEW_PENDING" else "transformation"
    validate_decisions(item, payload, build_report(item, stage, dynamo, s3))
    review_key = s3.artifact_key(
        job_id, "reviews", f"review-{payload.expected_revision + 1}-{review_id}.json"
    )
    review_body = {
        "review_id": review_id,
        "job_id": job_id,
        "expected_revision": payload.expected_revision,
        "approved_by": owner_id,
        "decisions": {
            key: decision.model_dump(mode="json") for key, decision in payload.decisions.items()
        },
    }
    # Persist the immutable review artifact before publishing its key in
    # DynamoDB. A stale submission may leave an orphaned S3 object, but it can
    # never leave a job pointing at an object that was not written.
    s3.put_bytes(review_key, json.dumps(review_body, indent=2).encode("utf-8"), "application/json")
    segment = 2 if current_status == "QUALITY_REVIEW_PENDING" else 3
    review_artifacts = {
        **item.get("review_artifacts", {}),
        stage: {"key": review_key, "revision": payload.expected_revision + 1},
    }
    try:
        updated = dynamo.update_job(
            job_id,
            expected_revision=payload.expected_revision,
            updates={
                "last_review_id": review_id,
                "last_review_key": review_key,
                "status": next_status,
                "workflow_segment": segment,
                "review_artifacts": review_artifacts,
            },
        )
    except RevisionConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="REVIEW_REVISION_CONFLICT: refresh the job before reviewing again",
        ) from error

    try:
        dynamo.put_child(
            job_id,
            f"REVIEW#{updated['revision']}#{review_id}",
            {
                "entity_type": "review",
                "review_id": review_id,
                "revision": updated["revision"],
                "approved_by": owner_id,
                "decision_count": len(payload.decisions),
                "artifact_key": review_key,
            },
        )
    except Exception:
        # The CAS-published S3 pointer is authoritative; the child is an index.
        logger.exception("Review index write failed; authoritative review remains persisted")
    execution_arn = None
    if workflow.state_machine_arn:
        try:
            started = workflow.start_segment(
                job_id,
                segment,
                int(updated["revision"]),
                context={"config": item.get("config", {})},
            )
        except Exception as error:
            # A lost StartExecution response may still have started processing.
            # Only a definitive AWS rejection permits a fresh processing retry.
            definitive = isinstance(error, ClientError) and error.response.get("Error", {}).get(
                "Code"
            ) in {
                "AccessDeniedException",
                "InvalidArn",
                "InvalidExecutionInput",
                "StateMachineDoesNotExist",
                "StateMachineDeleting",
                "ValidationException",
            }
            failure = (
                {
                    "status": "FAILED",
                    "error_code": "REVIEW_CONTINUATION_FAILED",
                    "error_detail": "Review was recorded, but the next segment was rejected. Retry the failed job; do not resubmit review.",
                }
                if definitive
                else {
                    "error_code": "REVIEW_CONTINUATION_UNKNOWN",
                    "error_detail": "Review was recorded; the start outcome is unknown. Reconcile workflow execution status before retrying. Do not resubmit review.",
                }
            )
            try:
                dynamo.update_job(job_id, int(updated["revision"]), failure)
            except RevisionConflictError:
                pass  # A winning execution already advanced the job.
            raise HTTPException(
                503, "Review was recorded; reload job status before retrying processing"
            ) from error
        execution_arn = started["execution_arn"]
        try:
            updated = dynamo.update_job(
                job_id,
                int(updated["revision"]),
                {"execution_arn": execution_arn, "workflow_segment": segment},
            )
        except RevisionConflictError:
            updated = dynamo.get_job(job_id) or updated
    return ReviewResponse(
        job=JobRecord.from_item(updated),
        review_id=review_id,
        execution_arn=execution_arn,
        request_id=request.state.request_id,
    )
