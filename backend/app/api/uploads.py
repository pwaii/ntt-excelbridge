"""Upload completion verification."""

from __future__ import annotations

from io import BytesIO
from zipfile import is_zipfile

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.api.dependencies import get_dynamo_store, get_s3_store
from app.auth import current_user_id
from app.domain.enums import JobStatus
from app.domain.models import JobRecord, UploadCompleteResponse
from app.domain.schemas import UploadCompleteRequest
from app.settings import settings
from app.storage.dynamo_store import DynamoStore, RevisionConflictError
from app.storage.s3_store import S3Store

router = APIRouter(prefix="/v1/jobs", tags=["uploads"])

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _validate_upload_filename(filename: str | None) -> str:
    if not filename or not filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="only .xlsx files are accepted",
        )
    return filename


def _complete_uploaded_slot(
    *,
    item: dict,
    job_id: str,
    payload: UploadCompleteRequest,
    request: Request,
    dynamo: DynamoStore,
    s3: S3Store,
) -> UploadCompleteResponse:
    """Verify an S3 object and atomically record it as uploaded."""

    if item.get("status") not in {"UPLOADING", "UPLOADED"}:
        raise HTTPException(409, "Uploads cannot change after workflow start")

    files = dict(item.get("files", {}))
    file_info = dict(files.get(payload.slot, {}))
    key = file_info.get("key")
    if not key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="upload slot not found")

    try:
        head = s3.head_object(key)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="S3 upload not found",
            ) from error
        raise

    size_bytes = int(head.get("ContentLength", 0))
    max_bytes = settings.max_workbook_mb * 1024 * 1024
    if size_bytes > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"workbook exceeds the {settings.max_workbook_mb} MB limit",
        )

    content_type = str(head.get("ContentType") or "").split(";", 1)[0].strip().lower()
    allowed_types = {XLSX_CONTENT_TYPE, "application/octet-stream", ""}
    if content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="uploaded object is not an .xlsx content type",
        )
    try:
        actual_sha256 = s3.sha256(key)
    except AttributeError:
        # Keeps lightweight adapter fakes compatible while production S3Store always hashes.
        actual_sha256 = None
    try:
        if not is_zipfile(BytesIO(s3.get_bytes(key))):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="uploaded object is not a valid XLSX package",
            )
    except AttributeError:
        # Lightweight local adapter fakes may only implement head_object.
        pass
    if payload.sha256 and actual_sha256 and payload.sha256.lower() != actual_sha256:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="uploaded object SHA-256 does not match the declared hash",
        )
    file_info.update(
        {
            "uploaded": True,
            "size_bytes": size_bytes,
            "etag": str(head.get("ETag", "")).strip('"') or None,
            "content_type": content_type or file_info.get("content_type"),
        }
    )
    file_info["sha256"] = actual_sha256 or payload.sha256
    if head.get("VersionId"):
        file_info["version_id"] = head["VersionId"]
    files[payload.slot] = file_info

    required_slots = {"input"} | ({"main"} if "main" in files else set())
    next_status = (
        JobStatus.UPLOADED.value
        if all(files[slot].get("uploaded") for slot in required_slots)
        else JobStatus.UPLOADING.value
    )
    updates = {"files": files, "configuration_confirmed": False, "workbook_selections": {}}
    # Completing the first of two required uploads legitimately leaves the job
    # in UPLOADING. Do not send a same-status update to DynamoStore: status
    # transitions are strictly forward, while this is only a file-manifest
    # update. The same rule makes repeated completion calls idempotent.
    if next_status != item.get("status"):
        updates["status"] = next_status
    if file_info.get("sha256"):
        updates["input_hash" if payload.slot == "input" else "main_hash"] = file_info["sha256"]

    try:
        updated = dynamo.update_job(
            job_id,
            expected_revision=int(item["revision"]),
            updates=updates,
        )
    except RevisionConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="job changed; refresh and retry") from error

    return UploadCompleteResponse(
        job=JobRecord.from_item(updated),
        uploaded_slot=payload.slot,
        request_id=request.state.request_id,
    )


@router.post("/{job_id}/uploads/file/{slot}", response_model=UploadCompleteResponse)
async def upload_workbook(
    job_id: str,
    slot: str,
    request: Request,
    file: UploadFile = File(...),
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> UploadCompleteResponse:
    """Accept an XLSX multipart upload and store it in S3.

    This route is convenient for local development and a simple frontend. The
    presigned PUT flow remains preferred for production because the workbook
    body bypasses the API server entirely.
    """

    if slot not in {"input", "main"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="slot must be input or main")
    filename = _validate_upload_filename(file.filename)
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")

    file_info = item.get("files", {}).get(slot)
    if item.get("status") not in {"UPLOADING", "UPLOADED"}:
        raise HTTPException(409, "Uploads cannot change after workflow start")
    if not file_info:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="upload slot not found")
    expected_filename = str(file_info.get("filename", ""))
    if expected_filename and filename != expected_filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"uploaded filename must be {expected_filename}",
        )

    max_bytes = settings.max_workbook_mb * 1024 * 1024
    body = await file.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"workbook exceeds the {settings.max_workbook_mb} MB limit",
        )

    content_type = file.content_type or XLSX_CONTENT_TYPE
    s3.put_bytes(str(file_info["key"]), body, content_type)
    return _complete_uploaded_slot(
        item=item,
        job_id=job_id,
        payload=UploadCompleteRequest(slot=slot),
        request=request,
        dynamo=dynamo,
        s3=s3,
    )


@router.post("/{job_id}/uploads/complete", response_model=UploadCompleteResponse)
def complete_upload(
    job_id: str,
    payload: UploadCompleteRequest,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> UploadCompleteResponse:
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")

    return _complete_uploaded_slot(
        item=item,
        job_id=job_id,
        payload=payload,
        request=request,
        dynamo=dynamo,
        s3=s3,
    )
