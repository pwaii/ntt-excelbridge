"""A revision-bound report consumed by both review screens."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.dependencies import get_dynamo_store, get_s3_store
from app.auth import current_user_id
from app.domain.review_report import ReviewReportPage, Stage
from app.services.review_report import build_report

router = APIRouter(prefix="/v1/jobs", tags=["reviews"])


@router.get(
    "/{job_id}/review-report", response_model=ReviewReportPage, response_model_exclude_none=True
)
def review_report(
    job_id: str,
    request: Request,
    stage: Stage,
    expected_revision: int = Query(ge=0),
    cursor: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    owner_id: str = Depends(current_user_id),
    dynamo=Depends(get_dynamo_store),
    s3=Depends(get_s3_store),
):
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(404, "job not found")
    if item["revision"] != expected_revision:
        raise HTTPException(409, "REVIEW_REVISION_CONFLICT: reload the report")
    rows = build_report(item, stage, dynamo, s3)
    latest = dynamo.get_job(job_id)
    if not latest or latest["revision"] != expected_revision:
        raise HTTPException(409, "REVIEW_REVISION_CONFLICT: report changed during load")
    end = cursor + limit
    following = end if end < len(rows) else None
    return ReviewReportPage(
        job_id=job_id,
        revision=item["revision"],
        status=item["status"],
        stage=stage,
        items=rows[cursor:end],
        total=len(rows),
        next_cursor=following,
        complete=following is None,
        request_id=request.state.request_id,
    )
