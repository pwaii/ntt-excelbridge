"""
Demo: flatten quality reports -> S3 -> QuickSight SPICE refresh.
Run: AWS_PROFILE=ChallengerAccess-453995432289 python scripts/demo_quicksight_pipeline.py
"""
import csv, io, json, sys, time
import boto3

BUCKET          = "xlsx-workflow-demo-453995432289"
REGION          = "ap-southeast-1"
ACCOUNT         = "453995432289"
CSV_KEY         = "quicksight/quality-issues.csv"
DATASET_ID = "qa-issues-s3-76bde119"  # S3 manifest dataset (data source: qa-s3-7f32316e)

s3 = boto3.client("s3", region_name=REGION)
qs = boto3.client("quicksight", region_name=REGION)

# Step 1: flatten all quality reports to CSV in S3
print("1. Flattening quality reports...")
rows = []
for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix="jobs/"):
    for obj in page.get("Contents", []):
        key = obj["Key"]
        if not key.endswith("/quality/quality-report.json"):
            continue
        job_id = key.split("/")[1]
        report = json.loads(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())
        for issue in report.get("issues", []):
            rows.append({
                "job_id": job_id,
                "issue_id": issue.get("issue_id", ""),
                "kind": issue.get("kind", ""),
                "sheet": issue.get("sheet", ""),
                "column": issue.get("column", ""),
                "recommended_action": issue.get("recommended_action", ""),
                "row_count": len(issue.get("row_numbers", [])),
                "message": issue.get("message", ""),
            })

buf = io.StringIO()
writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
writer.writeheader()
writer.writerows(rows)
s3.put_object(Bucket=BUCKET, Key=CSV_KEY, Body=buf.getvalue().encode(), ContentType="text/csv")
print(f"   {len(rows)} issues from {len(set(r['job_id'] for r in rows))} jobs")

# Step 2: refresh SPICE (skip if already running)
print("2. Refreshing SPICE...")
ingestions = qs.list_ingestions(DataSetId=DATASET_ID, AwsAccountId=ACCOUNT).get("Ingestions", [])
if any(i["IngestionStatus"] in ("INITIALIZED", "QUEUED", "RUNNING") for i in ingestions):
    print("   ingestion already running -- skipped")
    sys.exit(0)

ingestion_id = f"refresh-{int(time.time())}"
qs.create_ingestion(DataSetId=DATASET_ID, IngestionId=ingestion_id, AwsAccountId=ACCOUNT)
for _ in range(12):
    time.sleep(5)
    info = qs.describe_ingestion(DataSetId=DATASET_ID, IngestionId=ingestion_id,
                                  AwsAccountId=ACCOUNT)["Ingestion"]
    status = info["IngestionStatus"]
    print(f"   {status}")
    if status in ("COMPLETED", "FAILED", "CANCELLED"):
        break

if status == "COMPLETED":
    rows_ingested = info.get("RowInfo", {}).get("RowsIngested", "?")
    print(f"   OK -- {rows_ingested} rows in SPICE")
else:
    print(f"   FAILED: {info.get('ErrorInfo', {})}")
    sys.exit(1)
