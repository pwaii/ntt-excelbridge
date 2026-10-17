"""Legacy download router retained for compatibility.

The application registers :mod:`app.api.artifacts`, which supersedes this
module with the complete ownership-checked artifact endpoint. Do not register
both routers because they expose the same path.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.dependencies import get_dynamo_store, get_s3_store
from app.auth import current_user_id
from app.domain.models import PresignedDownload
from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store

router = APIRouter(prefix="/v1/jobs", tags=["downloads"])
ALLOWED_ARTIFACT_TYPES = {"output", "manifest", "quality", "proposals", "inspection"}


@router.get("/{job_id}/artifacts/{artifact_type}", response_model=PresignedDownload)
def download_artifact(
    job_id: str,
    artifact_type: str,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> PresignedDownload:
    if artifact_type not in ALLOWED_ARTIFACT_TYPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not found")
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    artifact = item.get("artifacts", {}).get(artifact_type)
    if not artifact or not artifact.get("key"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not ready")
    expected_prefix = f"{s3.job_prefix(job_id)}/"
    if not artifact["key"].startswith(expected_prefix):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not found")
    signed = s3.create_download_url(artifact["key"])
    return PresignedDownload(
        artifact_type=artifact_type,
        key=signed["key"],
        url=signed["url"],
        expires_in=signed["expires_in"],
        request_id=request.state.request_id,
    )
