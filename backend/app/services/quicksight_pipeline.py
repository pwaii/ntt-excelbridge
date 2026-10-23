"""Flatten per-job S3 artifacts into stable CSV sources for Amazon Quick."""

from __future__ import annotations

import csv
import io
import json
import re
from collections.abc import Iterable, Mapping
from typing import Any

QUALITY_FIELDS = (
    "job_id",
    "owner_id",
    "input_slot",
    "issue_id",
    "kind",
    "sheet",
    "column",
    "recommended_action",
    "row_count",
    "message",
)
INSPECTION_FIELDS = (
    "job_id",
    "owner_id",
    "input_slot",
    "sheet",
    "total_rows",
    "column_name",
    "column_index",
    "dominant_type",
    "blank_count",
    "blank_rate",
)
_QUALITY_NAME = re.compile(r"(?:(input_[2-8])-)?quality-report\.json\Z")
_INSPECTION_NAME = re.compile(r"(?:(input_[2-8])-)?manifest\.json\Z")


def _job_and_slot(key: str, area: str, name_pattern: re.Pattern[str]) -> tuple[str, str] | None:
    parts = key.split("/")
    if len(parts) != 4 or parts[0] != "jobs" or parts[2] != area:
        return None
    match = name_pattern.fullmatch(parts[3])
    if not match:
        return None
    return parts[1], match.group(1) or "input"


def _report_with_owner(report: tuple[Any, ...]) -> tuple[str, str, Mapping[str, Any]]:
    """Accept the legacy ``(key, report)`` pair and the owner-aware triple."""
    if len(report) == 2:
        key, value = report
        return str(key), "", value
    if len(report) == 3:
        key, owner_id, value = report
        return str(key), str(owner_id or ""), value
    raise ValueError("report entries must contain a key, optional owner, and report")


def flatten_quality_reports(reports: Iterable[tuple[Any, ...]]) -> list[dict[str, Any]]:
    """Return one row per issue, including the source workbook slot."""
    rows: list[dict[str, Any]] = []
    for report_entry in reports:
        key, owner_id, report = _report_with_owner(report_entry)
        parsed = _job_and_slot(key, "quality", _QUALITY_NAME)
        if not parsed:
            continue
        job_id, input_slot = parsed
        for issue in report.get("issues", []):
            rows.append({
                "job_id": job_id,
                "owner_id": owner_id,
                "input_slot": input_slot,
                "issue_id": issue.get("issue_id", ""),
                "kind": issue.get("kind", ""),
                "sheet": issue.get("sheet", ""),
                "column": issue.get("column", ""),
                "recommended_action": issue.get("recommended_action", ""),
                "row_count": len(issue.get("row_numbers", [])),
                "message": issue.get("message", ""),
            })
    return rows


def flatten_inspection_manifests(manifests: Iterable[tuple[Any, ...]]) -> list[dict[str, Any]]:
    """Return one row per workbook column, retaining workbook slot identity."""
    rows: list[dict[str, Any]] = []
    for manifest_entry in manifests:
        key, owner_id, manifest = _report_with_owner(manifest_entry)
        parsed = _job_and_slot(key, "inspection", _INSPECTION_NAME)
        if not parsed:
            continue
        job_id, input_slot = parsed
        total_rows = manifest.get("total_rows", 0)
        for sheet in manifest.get("sheets", []):
            for column in sheet.get("columns", []):
                distribution = column.get("type_distribution", {})
                dominant_type = max(distribution, key=distribution.get) if distribution else "unknown"
                blank_count = column.get("blank_count", 0)
                rows.append({
                    "job_id": job_id,
                    "owner_id": owner_id,
                    "input_slot": input_slot,
                    "sheet": sheet.get("name", ""),
                    "total_rows": total_rows,
                    "column_name": column.get("name", ""),
                    "column_index": column.get("index", ""),
                    "dominant_type": dominant_type,
                    "blank_count": blank_count,
                    "blank_rate": round(blank_count / total_rows, 3) if total_rows else 0,
                })
    return rows


def encode_csv(rows: list[dict[str, Any]], fields: tuple[str, ...]) -> bytes:
    """Create a header-only CSV for empty datasets instead of indexing rows[0]."""
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def parse_artifact_json(key: str, body: bytes, area: str, name_pattern: re.Pattern[str]) -> tuple[str, dict[str, Any]] | None:
    """Parse an expected JSON artifact and return its identifying metadata."""
    parsed = _job_and_slot(key, area, name_pattern)
    if parsed is None:
        return None
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError(f"Expected an object in s3://.../{key}")
    return parsed[0], value


def quality_artifact_key(key: str) -> bool:
    return _job_and_slot(key, "quality", _QUALITY_NAME) is not None


def inspection_artifact_key(key: str) -> bool:
    return _job_and_slot(key, "inspection", _INSPECTION_NAME) is not None
