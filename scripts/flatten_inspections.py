"""Flatten inspection manifests into a CSV for QuickSight (one row per column per job)."""
import boto3, csv, io, json, sys

BUCKET = "xlsx-workflow-demo-453995432289"
REGION = "ap-southeast-1"
OUT_KEY = "quicksight/inspections.csv"

s3 = boto3.client("s3", region_name=REGION)
paginator = s3.get_paginator("list_objects_v2")
rows = []
jobs_seen = 0

for page in paginator.paginate(Bucket=BUCKET, Prefix="jobs/"):
    for obj in page.get("Contents", []):
        key = obj["Key"]
        if not key.endswith("/inspection/manifest.json"):
            continue
        job_id = key.split("/")[1]
        jobs_seen += 1
        body = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
        manifest = json.loads(body)
        for sheet in manifest.get("sheets", []):
            sheet_name = sheet.get("name", "")
            total_rows = manifest.get("total_rows", 0)
            for col in sheet.get("columns", []):
                type_dist = col.get("type_distribution", {})
                dominant_type = max(type_dist, key=type_dist.get) if type_dist else "unknown"
                blank_count = col.get("blank_count", 0)
                rows.append({
                    "job_id": job_id,
                    "sheet": sheet_name,
                    "total_rows": total_rows,
                    "column_name": col.get("name", ""),
                    "column_index": col.get("index", ""),
                    "dominant_type": dominant_type,
                    "blank_count": blank_count,
                    "blank_rate": round(blank_count / total_rows, 3) if total_rows else 0,
                })

print(f"Processed {jobs_seen} jobs, {len(rows)} column records", file=sys.stderr)

buf = io.StringIO()
fields = ["job_id","sheet","total_rows","column_name","column_index","dominant_type","blank_count","blank_rate"]
writer = csv.DictWriter(buf, fieldnames=fields)
writer.writeheader()
writer.writerows(rows)

s3.put_object(Bucket=BUCKET, Key=OUT_KEY, Body=buf.getvalue().encode(), ContentType="text/csv")
print(f"s3://{BUCKET}/{OUT_KEY}")
