"""Owner-scoped, schema-driven views of uploaded Excel rows."""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.dependencies import get_dynamo_store, get_s3_store
from app.auth import current_user_id
from app.domain.enums import JobStatus
from app.services.quicksight_pipeline import flatten_workbook_rows, workbook_source_id
from app.settings import settings
from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store

router = APIRouter(prefix="/v1/analytics/quick/data", tags=["analytics"])
_INPUT_SLOT = re.compile(r"input(?:_[2-8])?\Z")
_TECHNICAL_FIELDS = {"job id", "owner id", "input slot", "row number", "row index", "job", "owner"}


def _owned_sources(owner_id: str, dynamo: DynamoStore, s3: S3Store) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for job in dynamo.list_jobs_for_owner(owner_id, limit=100):
        if job.get("owner_id") != owner_id or job.get("status") != JobStatus.COMPLETED.value:
            continue
        job_id = str(job.get("job_id", ""))
        if not job_id:
            continue
        for slot, file_info in (job.get("files") or {}).items():
            if not _INPUT_SLOT.fullmatch(str(slot)) or not file_info.get("uploaded"):
                continue
            filename = str(file_info.get("filename", ""))
            key = str(file_info.get("key", ""))
            expected_key = s3.input_key(job_id, str(slot), filename)
            if key != expected_key:
                continue
            sources.append({
                "source_id": workbook_source_id(owner_id, job_id, str(slot)),
                "job_id": job_id,
                "slot": str(slot),
                "key": key,
                "workbook_name": filename,
                "created_at": str(job.get("created_at", "")),
            })
    return sources


def _find_source(source_id: str, owner_id: str, dynamo: DynamoStore, s3: S3Store) -> dict[str, Any]:
    source = next(
        (item for item in _owned_sources(owner_id, dynamo, s3) if item["source_id"] == source_id),
        None,
    )
    if not source:
        # Keep source IDs opaque and avoid revealing whether another user's source exists.
        raise HTTPException(status_code=404, detail="workbook not found")
    return source


def _inspection_manifest(source: dict[str, Any], s3: S3Store) -> dict[str, Any]:
    filename = "manifest.json" if source["slot"] == "input" else f"{source['slot']}-manifest.json"
    key = s3.artifact_key(source["job_id"], "inspection", filename)
    if not s3.object_exists(key):
        return {}
    payload = json.loads(s3.get_bytes(key))
    return payload if isinstance(payload, dict) else {}


def _column_profiles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    values_by_column: dict[str, list[Any]] = {}
    kinds_by_column: dict[str, Counter[str]] = {}
    for row in rows:
        values = row.get("row_values", {})
        kinds = row.get("row_value_types", {})
        for name, value in values.items():
            if value is None or value == "":
                continue
            values_by_column.setdefault(name, []).append(value)
            kind = kinds.get(name, "category")
            kinds_by_column.setdefault(name, Counter())[kind] += 1

    profiles: list[dict[str, Any]] = []
    for name, values in values_by_column.items():
        normalized = re.sub(r"[_-]+", " ", name).strip().casefold()
        if normalized in _TECHNICAL_FIELDS:
            continue
        counts = kinds_by_column[name]
        kind = max(counts, key=counts.get)
        if counts[kind] / len(values) < 0.8:
            kind = "category"
        profiles.append({
            "name": name,
            "kind": kind,
            "non_empty_count": len(values),
            "unique_count": len({str(value) for value in values}),
        })
    return profiles


@router.get("/sources")
def list_excel_sources(
    request: Request,
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> dict[str, Any]:
    """List completed input workbooks belonging only to the authenticated owner."""
    sources = _owned_sources(owner_id, dynamo, s3)
    return {
        "sources": [
            {
                "source_id": source["source_id"],
                "workbook_name": source["workbook_name"],
                "created_at": source["created_at"],
            }
            for source in sources
        ],
        "request_id": request.state.request_id,
    }


@router.get("/rows")
def get_excel_rows(
    request: Request,
    source_id: str = Query(min_length=32, max_length=32),
    sheet: str | None = Query(default=None, max_length=255),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=2000, ge=1, le=5000),
    owner_id: str = Depends(current_user_id),
    dynamo: DynamoStore = Depends(get_dynamo_store),
    s3: S3Store = Depends(get_s3_store),
) -> dict[str, Any]:
    """Return typed workbook rows for one owned source, without workflow IDs."""
    source = _find_source(source_id, owner_id, dynamo, s3)
    inspection = _inspection_manifest(source, s3)
    flattened = flatten_workbook_rows(
        [(source["key"], owner_id, s3.get_bytes(source["key"]))],
        {(source["job_id"], source["slot"]): inspection},
    )
    sheet_names = list(dict.fromkeys(row["sheet"] for row in flattened))
    available_sheets = [
        {"name": name, "row_count": sum(row["sheet"] == name for row in flattened)}
        for name in sheet_names
    ]
    selected_sheet = sheet or (sheet_names[0] if sheet_names else "")
    if selected_sheet and selected_sheet not in sheet_names:
        raise HTTPException(status_code=404, detail="worksheet not found")
    selected_rows = [row for row in flattened if row["sheet"] == selected_sheet]
    page = selected_rows[offset:offset + limit]
    return {
        "source": {
            "source_id": source["source_id"],
            "workbook_name": source["workbook_name"],
            "created_at": source["created_at"],
        },
        "sheets": available_sheets,
        "sheet": selected_sheet,
        "columns": _column_profiles(selected_rows),
        "rows": [
            {
                "row_number": row["row_number"],
                "values": row["row_values"],
                "value_types": row["row_value_types"],
            }
            for row in page
        ],
        "total_rows": len(selected_rows),
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(page) < len(selected_rows),
        "request_id": request.state.request_id,
    }
