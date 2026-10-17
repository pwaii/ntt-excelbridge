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
from typing import Any

from app.domain.enums import JobStatus
from app.settings import settings
from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store
from app.workers.inspect_workbook import inspect_bytes, manifest_json
from app.workers.quality_rules import run_quality_rules

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _inspect_workbook(source: bytes) -> dict[str, Any]:
    """Compatibility wrapper for callers of the original demo worker."""

    return inspect_bytes(source, max_rows=settings.max_data_rows)


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
    quality = run_quality_rules(source, manifest)
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
    quality_key = s3.artifact_key(job_id, "quality", "quality-report.json")
    output_key = s3.artifact_key(job_id, "output", "final.xlsx")
    s3.put_bytes(
        manifest_key,
        manifest_json(manifest),
        "application/json",
    )
    s3.put_bytes(quality_key, json.dumps(quality, indent=2).encode("utf-8"), "application/json")
    for issue in quality["issues"]:
        dynamo.put_child(
            job_id,
            f"ISSUE#{issue['issue_id']}",
            {"entity_type": "issue", "issue_id": issue["issue_id"], "kind": issue["kind"], "summary": issue["message"]},
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
                "quality": {
                    "key": quality_key,
                    "content_type": "application/json",
                    "size_bytes": len(json.dumps(quality).encode("utf-8")),
                    "issue_count": quality["issue_count"],
                },
            },
        },
    )
