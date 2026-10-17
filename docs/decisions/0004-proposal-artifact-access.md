# ADR 0004: Authenticated access to full proposal artifacts

## Status

Accepted for the backend demo.

## Decision

Proposal summaries remain in DynamoDB, while full Tool #1–#5 proposal payloads
remain in private S3. The API now exposes an ownership-checked route:

```text
GET /v1/jobs/{job_id}/proposals/{proposal_id}/artifact
```

The route resolves the exact proposal child record, verifies the S3 key remains
inside the job prefix, checks object existence, and returns a short-lived
presigned GET URL. This lets review clients display model evidence without
placing workbook values or raw model responses in DynamoDB.

Review reasons are also copied into the decision-level audit artifact and event
metadata so the audit trail explains why a user accepted, rejected, edited, or
ignored an item.
