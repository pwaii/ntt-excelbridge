"""Paginated issue/proposal summaries for review screens."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.dependencies import get_dynamo_store, get_s3_store
from app.auth import current_user_id
from app.domain.models import PresignedDownload
from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store

router = APIRouter(prefix="/v1/jobs", tags=["artifacts"])


def _list(prefix: str, job_id: str, owner_id: str, request: Request, limit: int, cursor: str | None, dynamo: DynamoStore) -> dict:
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    if hasattr(dynamo, "list_children_page"):
        records, next_cursor = dynamo.list_children_page(job_id, prefix, limit=limit, cursor=cursor)
    else:
        records, next_cursor = dynamo.list_children(job_id, prefix, limit), None
    return {"items": records, "count": len(records), "next_cursor": next_cursor, "request_id": request.state.request_id}


@router.get("/{job_id}/issues")
def list_issues(job_id: str, request: Request, owner_id: str = Depends(current_user_id), limit: int = Query(50, ge=1, le=100), cursor: str | None = Query(None), dynamo: DynamoStore = Depends(get_dynamo_store)) -> dict:
    return _list("ISSUE#", job_id, owner_id, request, limit, cursor, dynamo)


@router.get("/{job_id}/proposals")
def list_proposals(job_id: str, request: Request, owner_id: str = Depends(current_user_id), limit: int = Query(50, ge=1, le=100), cursor: str | None = Query(None), dynamo: DynamoStore = Depends(get_dynamo_store)) -> dict:
    return _list("PROPOSAL#", job_id, owner_id, request, limit, cursor, dynamo)


@router.get("/{job_id}/artifacts/{artifact_type}", response_model=PresignedDownload)
def download_artifact(
    job_id: str,
    artifact_type: str,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> PresignedDownload:
    """Return a short-lived URL for one private job artifact."""

    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")

    artifacts = dict(item.get("artifacts", {}))
    artifact = artifacts.get(artifact_type)
    if artifact_type == "review" and item.get("last_review_key"):
        artifact = {"key": item["last_review_key"]}
    if artifact_type in {"input", "main"}:
        artifact = item.get("files", {}).get(artifact_type)
    key = artifact.get("key") if isinstance(artifact, dict) else None
    prefix = s3.job_prefix(job_id) + "/"
    if not key or not str(key).startswith(prefix):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not found")
    if hasattr(s3, "object_exists") and not s3.object_exists(str(key)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not found")

    signed = s3.create_download_url(str(key))
    return PresignedDownload(
        artifact_type=artifact_type,
        key=str(key),
        url=signed["url"],
        expires_in=signed["expires_in"],
        request_id=request.state.request_id,
    )


@router.get("/{job_id}/proposals/{proposal_id}/artifact", response_model=PresignedDownload)
def download_proposal_artifact(
    job_id: str,
    proposal_id: str,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> PresignedDownload:
    """Return a short-lived URL for one full private proposal artifact."""

    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    if not proposal_id or "/" in proposal_id or "\\" in proposal_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="proposal not found")

    proposal = None
    if hasattr(dynamo, "get_child"):
        proposal = dynamo.get_child(job_id, f"PROPOSAL#{proposal_id}")
    else:
        proposal = next(
            (record for record in dynamo.list_children(job_id, "PROPOSAL#") if record.get("proposal_id") == proposal_id),
            None,
        )
    key = proposal.get("artifact_key") if proposal else None
    prefix = s3.job_prefix(job_id) + "/"
    if not key or not str(key).startswith(prefix):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="proposal not found")
    if hasattr(s3, "object_exists") and not s3.object_exists(str(key)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="proposal not found")

    signed = s3.create_download_url(str(key))
    return PresignedDownload(
        artifact_type="proposal",
        key=str(key),
        url=signed["url"],
        expires_in=signed["expires_in"],
        request_id=request.state.request_id,
    )
