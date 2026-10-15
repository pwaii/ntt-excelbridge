"""Minimal AWS-backed pipeline for proving the input/output path.

This is intentionally a pass-through transformation: it reads the uploaded
workbook from S3, validates it with OpenPyXL, writes a separate output object,
and stores a redacted inspection manifest. The later Step Functions/Bedrock
pipeline can replace this worker without changing the API contract.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from hashlib import sha256
from io import BytesIO
from typing import Any

from openpyxl import load_workbook

from app.domain.enums import JobStatus
from app.settings import settings
from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _inspect_workbook(source: bytes) -> dict[str, Any]:
    """Validate an XLSX and return metadata without recording cell contents."""

    workbook = load_workbook(BytesIO(source), read_only=True, data_only=False)
    try:
        sheets = []
        total_rows = 0
        for worksheet in workbook.worksheets:
            rows = worksheet.max_row or 0
            columns = worksheet.max_column or 0
            total_rows += rows
            sheets.append(
                {
                    "name": worksheet.title,
                    "max_row": rows,
                    "max_column": columns,
                }
            )
        if total_rows > settings.max_data_rows:
            raise ValueError(f"workbook exceeds the {settings.max_data_rows} row limit")
        return {
            "format": "xlsx",
            "sheet_count": len(sheets),
            "total_rows": total_rows,
            "sheets": sheets,
        }
    finally:
        workbook.close()


def run_demo_pipeline(
    job_id: str,
    expected_revision: int,
    dynamo: DynamoStore,
    s3: S3Store,
) -> dict[str, Any]:
    """Run the synchronous demo pipeline and return the completed job item."""

    item = dynamo.get_job(job_id)
    if not item or item.get("status") != JobStatus.INSPECTING.value:
        raise ValueError("job is not ready for inspection")

    input_file = item.get("files", {}).get("input", {})
    if not input_file.get("uploaded") or not input_file.get("key"):
        raise ValueError("input workbook has not been uploaded")

    item = dynamo.update_job(
        job_id,
        expected_revision=expected_revision,
        updates={"status": JobStatus.APPLYING.value},
    )

    source = s3.get_bytes(input_file["key"])
    if len(source) > settings.max_workbook_mb * 1024 * 1024:
        raise ValueError(f"workbook exceeds the {settings.max_workbook_mb} MB limit")

    manifest = _inspect_workbook(source)
    input_hash = sha256(source).hexdigest()
    timestamp = datetime.now(UTC).isoformat()
    manifest.update(
        {
            "job_id": job_id,
            "source_key": input_file["key"],
            "input_sha256": input_hash,
            "created_at": timestamp,
        }
    )

    manifest_key = s3.artifact_key(job_id, "inspection", "manifest.json")
    output_key = s3.artifact_key(job_id, "output", "final.xlsx")
    s3.put_bytes(
        manifest_key,
        json.dumps(manifest, indent=2).encode("utf-8"),
        "application/json",
    )

    # Demo transformation: preserve the source bytes but write a new object.
    # This proves the output path without silently changing user data.
    s3.put_bytes(output_key, source, XLSX_CONTENT_TYPE)

    item = dynamo.update_job(
        job_id,
        expected_revision=item["revision"],
        updates={"status": JobStatus.VALIDATING_OUTPUT.value},
    )

    # Reopen the object that was actually written to S3, not only the input.
    output = s3.get_bytes(output_key)
    _inspect_workbook(output)
    output_hash = sha256(output).hexdigest()

    return dynamo.update_job(
        job_id,
        expected_revision=item["revision"],
        updates={
            "status": JobStatus.COMPLETED.value,
            "input_hash": input_hash,
            "output_hash": output_hash,
            "artifacts": {
                "output": {
                    "key": output_key,
                    "content_type": XLSX_CONTENT_TYPE,
                    "size_bytes": len(output),
                    "sha256": output_hash,
                },
                "inspection": {
                    "key": manifest_key,
                    "content_type": "application/json",
                    "size_bytes": len(json.dumps(manifest).encode("utf-8")),
                },
            },
        },
    )
