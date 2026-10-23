"""Flatten all workbook-slot reports and start the configured Quick SPICE refreshes.

Run from the repository root in the Quick resource region (ap-southeast-1):
    $env:AWS_PROFILE = "ChallengerAccess-453995432289"
    python scripts/demo_quicksight_pipeline.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from time import time
from uuid import uuid4

import boto3

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.quicksight_pipeline import (  # noqa: E402
    INSPECTION_FIELDS,
    QUALITY_FIELDS,
    encode_csv,
    flatten_inspection_manifests,
    flatten_quality_reports,
    inspection_artifact_key,
    quality_artifact_key,
)

BUCKET = os.getenv("APP_DATA_BUCKET", "xlsx-workflow-demo-453995432289")
REGION = os.getenv("AWS_REGION", "ap-southeast-1")
ACCOUNT = os.getenv("QUICKSIGHT_ACCOUNT_ID", "453995432289")
DATASETS = {
    "quality": os.getenv("QUICKSIGHT_QUALITY_DATASET_ID", "qa-issues-s3-76bde119"),
    "inspection": os.getenv("QUICKSIGHT_INSPECTION_DATASET_ID", ""),
}


def main() -> int:
    s3 = boto3.client("s3", region_name=REGION)
    qs = boto3.client("quicksight", region_name=REGION)
    quality_reports = []
    manifests = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix="jobs/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not (quality_artifact_key(key) or inspection_artifact_key(key)):
                continue
            body = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
            payload = json.loads(body)
            if quality_artifact_key(key):
                quality_reports.append((key, payload))
            else:
                manifests.append((key, payload))

    quality_rows = flatten_quality_reports(quality_reports)
    inspection_rows = flatten_inspection_manifests(manifests)
    artifacts = (
        ("quality", "quicksight/quality-issues.csv", quality_rows, QUALITY_FIELDS),
        ("inspection", "quicksight/inspections.csv", inspection_rows, INSPECTION_FIELDS),
    )
    for label, key, rows, fields in artifacts:
        s3.put_object(Bucket=BUCKET, Key=key, Body=encode_csv(rows, fields), ContentType="text/csv; charset=utf-8")
        print(f"{label}: {len(rows)} rows across {len(quality_reports) if label == 'quality' else len(manifests)} artifacts -> s3://{BUCKET}/{key}")

    for label, dataset_id in DATASETS.items():
        if not dataset_id:
            print(f"{label}: dataset not configured; CSV was still published")
            continue
        ingestions = qs.list_ingestions(DataSetId=dataset_id, AwsAccountId=ACCOUNT).get("Ingestions", [])
        if any(row.get("IngestionStatus") in {"INITIALIZED", "QUEUED", "RUNNING"} for row in ingestions):
            print(f"{label}: ingestion already running; refresh skipped")
            continue
        ingestion_id = f"manual-{label}-{int(time())}-{uuid4().hex[:10]}"
        qs.create_ingestion(DataSetId=dataset_id, IngestionId=ingestion_id, AwsAccountId=ACCOUNT)
        print(f"{label}: ingestion started ({ingestion_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
