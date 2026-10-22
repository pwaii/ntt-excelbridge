"""Flatten all quality-report.json files into a single CSV for QuickSight."""
import boto3, csv, io, json, sys

BUCKET = "xlsx-workflow-demo-453995432289"
REGION = "ap-southeast-1"
OUT_KEY = "quicksight/quality-issues.csv"

s3 = boto3.client("s3", region_name=REGION)

paginator = s3.get_paginator("list_objects_v2")
rows = []
jobs_seen = 0

for page in paginator.paginate(Bucket=BUCKET, Prefix="jobs/"):
    for obj in page.get("Contents", []):
        key = obj["Key"]
        if not key.endswith("/quality/quality-report.json"):
            continue
        job_id = key.split("/")[1]
        jobs_seen += 1
        body = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
        report = json.loads(body)
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

print(f"Processed {jobs_seen} jobs, {len(rows)} issues", file=sys.stderr)

buf = io.StringIO()
writer = csv.DictWriter(buf, fieldnames=["job_id","issue_id","kind","sheet","column","recommended_action","row_count","message"])
writer.writeheader()
writer.writerows(rows)

s3.put_object(Bucket=BUCKET, Key=OUT_KEY, Body=buf.getvalue().encode(), ContentType="text/csv")
print(f"s3://{BUCKET}/{OUT_KEY}")
