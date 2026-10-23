"""Owned, revision-safe metadata and pre-start confirmation endpoints (ADR D10)."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.dependencies import get_dynamo_store, get_s3_store
from app.auth import current_user_id
from app.domain.models import JobRecord, JobResponse
from app.domain.workbooks import SaveWorkbookConfiguration, WorkbookMetadataResponse
from app.services.workbook_metadata import inspect_upload
from app.storage.dynamo_store import DynamoStore, RevisionConflictError
from app.storage.s3_store import S3Store

router = APIRouter(prefix="/v1/jobs", tags=["workbooks"])


def owned_job(job_id, owner_id, dynamo):
    item = dynamo.get_job(job_id)
    if not item or item.get("owner_id") != owner_id:
        raise HTTPException(404, "job not found")
    return item


VALID_SLOTS = {"input", "main"} | {f"input_{index}" for index in range(2, 9)}


def inspect_slot(item, slot, s3, sheet_name=None, header_row=None):
    if slot not in VALID_SLOTS:
        raise HTTPException(422, "slot must be input, input_2 through input_8, or main")
    file = item.get("files", {}).get(slot, {})
    if not file.get("uploaded") or not file.get("key"):
        raise HTTPException(422, "workbook upload must be confirmed first")
    try:
        source = s3.get_bytes(file["key"])
        version, sheets = inspect_upload(source, sheet_name, header_row)
    except Exception as error:
        # Do not echo workbook values or storage URLs in client errors.
        if isinstance(error, ValueError):
            raise HTTPException(422, str(error)) from error
        raise HTTPException(422, "Workbook inspection failed; verify the XLSX upload") from error
    return version, sheets, len(source)


@router.get("/{job_id}/workbooks/{slot}/metadata", response_model=WorkbookMetadataResponse)
def metadata(
    job_id: str,
    slot: str,
    request: Request,
    sheet_name: str | None = Query(default=None),
    header_row: int | None = Query(default=None, ge=1, le=20),
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
):
    item = owned_job(job_id, owner_id, dynamo)
    if header_row is not None and sheet_name is None:
        raise HTTPException(422, "Select a worksheet before correcting its header row")
    version, sheets, size = inspect_slot(item, slot, s3, sheet_name, header_row)
    return WorkbookMetadataResponse(
        job_id=job_id,
        slot=slot,
        workbook_version=version,
        size_bytes=size,
        key_required=bool(item.get("config", {}).get("update")),
        sheets=sheets,
        request_id=request.state.request_id,
    )


def validate_selections(item, selections, s3):
    # Every uploaded current workbook must be confirmed; main only when a policy needs it.
    required = {slot for slot in item.get("files", {}) if slot == "input" or slot.startswith("input_")}
    if item.get("config", {}).get("standardize") or item.get("config", {}).get("update"):
        required.add("main")
    if set(selections) != required:
        raise HTTPException(422, "Confirm selections for exactly the required workbooks")
    for slot, selection in selections.items():
        version, sheets, _size = inspect_slot(
            item, slot, s3, selection.sheet_name, selection.header_row
        )
        sheet = next(sheet for sheet in sheets if sheet.name == selection.sheet_name)
        if version != selection.workbook_version:
            raise HTTPException(409, "Workbook changed; reload metadata and confirm again")
        if not selection.header_confirmed or sheet.errors:
            raise HTTPException(422, "Explicit confirmation of a valid header is required")
        available = {column.id for column in sheet.columns}
        if (item.get("config", {}).get("update") and not selection.key_column) or (
            selection.key_column and selection.key_column not in available
        ):
            raise HTTPException(422, "Select an available matching key for each required workbook")


@router.put("/{job_id}/configuration", response_model=JobResponse)
def save_configuration(
    job_id: str,
    payload: SaveWorkbookConfiguration,
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
):
    item = owned_job(job_id, owner_id, dynamo)
    if item.get("status") != "UPLOADED":
        raise HTTPException(409, "Only an uploaded, not-started job can be configured")
    validate_selections(item, payload.selections, s3)
    config = dict(item["config"])
    for slot, selection in payload.selections.items():
        # Secondary inputs (input_2..input_8) are recorded only in workbook_selections;
        # processing reads the shared input sheet/header/key from config (see spec §1 shortcut).
        if slot not in {"input", "main"}:
            continue
        config["input_sheet" if slot == "input" else "main_sheet"] = selection.sheet_name
        config["input_header_row" if slot == "input" else "main_header_row"] = selection.header_row
        # Selection IDs are Excel letters; processing uses actual header labels.
        key_label = None
        if selection.key_column:
            _version, sheets, _size = inspect_slot(item, slot, s3, selection.sheet_name, selection.header_row)
            sheet = next(sheet for sheet in sheets if sheet.name == selection.sheet_name)
            key_label = next(column.label for column in sheet.columns if column.id == selection.key_column)
        config["key_column" if slot == "input" else "main_key_column"] = key_label
    try:
        item = dynamo.update_job(
            job_id,
            expected_revision=payload.expected_revision,
            updates={
                "config": config,
                "configuration_confirmed": True,
                "workbook_selections": {
                    slot: selection.model_dump(mode="json")
                    for slot, selection in payload.selections.items()
                },
            },
        )
    except RevisionConflictError as error:
        raise HTTPException(409, "Job revision changed; reload before confirming again") from error
    return JobResponse(job=JobRecord.from_item(item), request_id=request.state.request_id)
