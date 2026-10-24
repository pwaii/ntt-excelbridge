# ntt-excelbridge (Pilotxl / ExcelBridge)

A human-gated XLSX workflow for financial teams. Users upload up to 8 input workbooks plus an optional reference workbook, describe a column to add, and step through two AI-assisted review gates (data quality, then transformation) before downloading a new output workbook with a full audit trail. Stack: React/Vite + FastAPI on Lambda, AWS Bedrock (Nova), Step Functions, S3, DynamoDB, Cognito.

## Quick start — backend

```powershell
Copy-Item .env.example .env   # fill in AWS_PROFILE, bucket, table names
.\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port 8000
```

Verify: `Invoke-RestMethod http://127.0.0.1:8000/health`

Run tests: `cd backend && python -m pytest`

## Quick start — frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/jobs/new`. Set `VITE_API_BASE_URL=http://127.0.0.1:8000` in `frontend/.env.local` if the backend is on a different address.

Run tests: `npm test`

## Amazon Quick analytics

The QuickSight S3 integration for account `453995432289` was initialized from
the QuickSight console under **Admin → AWS resources**. The S3-backed quality
dataset is `qa-issues-s3-76bde119`. The app stack and S3 bucket are in
`us-east-1`; Quick resources are in `ap-southeast-1`. Keep the stack in its
existing region and set `QuickSightRegion=ap-southeast-1` for the separate Quick
API client.

The SAM stack enables S3 EventBridge events and adds a buffered path:
quality-report object-created event → EventBridge → SQS → refresh Lambda. The
queue batches events for up to one minute; the Lambda scans all jobs, folds
quality reports and inspection manifests from every current-workbook slot into
stable CSVs, then requests SPICE ingestion. If Quick reports that an ingestion
is already active, the SQS batch stays queued for retry so a later run refreshes
the newest CSV. Repeated errors move messages to the configured dead-letter
queue for inspection and redrive.

The Lambda execution role is supplied from outside this template. Add least-
privilege permissions for `s3:ListBucket` on the app bucket, `s3:GetObject` on
`jobs/*`, `s3:PutObject` on `quicksight/*`, SQS receive/delete/attributes on the
refresh queue, and Quick `CreateIngestion` on each configured dataset's
`dataset/<id>/ingestion/*` ARN. QuickSight's `ListIngestions` action has no
resource-level scope, so the Lambda avoids that account-wide permission and
lets Quick return an in-use conflict for SQS retry. The existing Quick service
role must retain read access to the CSV object and manifest. The stack does not
create or broaden IAM policies.

The deployed quality dataset schema includes `input_slot`. The inspection
dataset `qa-inspections-s3-76bde119` reads
[`scripts/qs-inspections-manifest.json`](scripts/qs-inspections-manifest.json)
from `quicksight/inspections-manifest.json`; its initial CSV must exist before
SPICE ingestion. The worker publishes both CSVs on the first quality-report
event and starts ingestion on both datasets. New deployments default to these
dataset IDs; override `QuickSightInspectionDatasetId` when using another one.
Build and publish dashboards from the datasets: quality issues by
kind/action/job/input slot, plus column types and blank rates by job/input
slot. Do not expose an anonymous embedded dashboard until row-level security is
mapped to the app's authenticated users; the flattened reports currently
aggregate all jobs in the whole bucket.

## Backend Days 1–7 progress

## Architecture

Three cooperating layers in `backend/app/`:

- **API** (`api/`) — FastAPI on Lambda; job CRUD, presigned S3 URLs, review submission, artifact downloads. Never receives workbook bytes directly.
- **Workers** (`workers/`) — bounded, idempotent Lambdas: `inspect_workbook`, `quality_rules`, `apply_changes`, `validate_output`. OpenPyXL always writes to a new S3 object.
- **AI** (`ai/`) — Bedrock Converse API, Tools 1–5. All LLM output is validated against Pydantic schemas; the model only selects from candidate IDs supplied in the prompt.

State persists in a single DynamoDB table (`PK=JOB#<id>` / `SK=META|ISSUE#|PROPOSAL#|REVIEW#|EVENT#`) with conditional revision updates. Three short Step Functions segments run between human review gates — no task tokens or paused executions.

Local development uses the no-`STATE_MACHINE_ARN` in-process fallback. See `docs/backend-deployment.md` for AWS deployment and `docs/frontend-demo-runbook.md` for the demo validation checklist.
