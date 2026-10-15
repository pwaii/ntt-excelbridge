"""Review submission with optimistic concurrency."""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.dependencies import get_dynamo_store
from app.auth import current_user_id
from app.domain.models import JobRecord, ReviewResponse
from app.domain.schemas import ReviewRequest
from app.storage.dynamo_store import DynamoStore, RevisionConflictError

router = APIRouter(prefix="/v1/jobs", tags=["reviews"])


@router.post("/{job_id}/reviews", response_model=ReviewResponse)
def submit_review(
    job_id: str,
    payload: ReviewRequest,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
) -> ReviewResponse:
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    if payload.approved_by and payload.approved_by != owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="approved_by must match authenticated user")

    review_id = str(uuid4())
    try:
        updated = dynamo.update_job(
            job_id,
            expected_revision=payload.expected_revision,
            updates={"last_review_id": review_id},
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
            "decisions": {
                key: decision.model_dump(mode="json")
                for key, decision in payload.decisions.items()
            },
        },
    )
    return ReviewResponse(
        job=JobRecord.from_item(updated),
        review_id=review_id,
        request_id=request.state.request_id,
    )
