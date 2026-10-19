"""Review submission with optimistic concurrency."""

from __future__ import annotations

import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.dependencies import get_dynamo_store, get_s3_store, get_workflow_store
from app.auth import current_user_id
from app.domain.models import JobRecord, ReviewResponse
from app.domain.schemas import ReviewRequest
from app.storage.dynamo_store import DynamoStore, RevisionConflictError
from app.storage.s3_store import S3Store
from app.storage.sfn_store import WorkflowStore

router = APIRouter(prefix="/v1/jobs", tags=["reviews"])


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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="approved_by must match authenticated user")

    review_id = str(uuid4())
    current_status = item.get("status")
    next_status = {
        "QUALITY_REVIEW_PENDING": "NORMALIZATION_PENDING",
        "TRANSFORMATION_REVIEW_PENDING": "APPLYING",
    }.get(current_status)
    if not next_status:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="job is not waiting for a review")
    review_key = s3.artifact_key(job_id, "reviews", f"review-{payload.expected_revision + 1}-{review_id}.json")
    review_body = {
        "review_id": review_id,
        "job_id": job_id,
        "expected_revision": payload.expected_revision,
        "approved_by": owner_id,
        "decisions": {key: decision.model_dump(mode="json") for key, decision in payload.decisions.items()},
    }
    # Persist the immutable review artifact before publishing its key in
    # DynamoDB. A stale submission may leave an orphaned S3 object, but it can
    # never leave a job pointing at an object that was not written.
    s3.put_bytes(review_key, json.dumps(review_body, indent=2).encode("utf-8"), "application/json")
    try:
        updated = dynamo.update_job(
            job_id,
            expected_revision=payload.expected_revision,
            updates={"last_review_id": review_id, "last_review_key": review_key, "status": next_status},
        )
    except RevisionConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="REVIEW_REVISION_CONFLICT: refresh the job before reviewing again",
        ) from error

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
    execution_arn = None
    if workflow.state_machine_arn:
        segment = 2 if current_status == "QUALITY_REVIEW_PENDING" else 3
        started = workflow.start_segment(job_id, segment, int(updated["revision"]), context={"config": item.get("config", {})})
        execution_arn = started["execution_arn"]
        try:
            updated = dynamo.update_job(job_id, int(updated["revision"]), {"execution_arn": execution_arn, "workflow_segment": segment})
        except RevisionConflictError:
            updated = dynamo.get_job(job_id) or updated
    return ReviewResponse(
        job=JobRecord.from_item(updated),
        review_id=review_id,
        execution_arn=execution_arn,
        request_id=request.state.request_id,
    )
