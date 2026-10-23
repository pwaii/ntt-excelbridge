# ntt-excelbridge

## Backend AWS storage foundation

The backend now includes reusable AWS adapters in `backend/app/storage/`:

- `S3Store` creates short-lived presigned PUT/GET URLs, verifies objects with
  `head_object`, and reads/writes private artifacts under
  `jobs/<job_id>/...`.
- `DynamoStore` uses the planned single-table shape
  `PK=JOB#<job_id>`, `SK=META`, supports TTL, and performs conditional
  revision updates for stale-review protection.
- `backend/app/settings.py` loads the repository `.env` reliably even when
  the Makefile starts Uvicorn from `backend/`.
- Local AWS access uses `AWS_PROFILE`; deployed Lambda uses its IAM role and
  leaves `AWS_PROFILE` empty.

Copy `.env.example` to `.env` for local development. Never commit `.env`,
access keys, session tokens, or API keys. The browser receives presigned URLs,
not AWS credentials.

```powershell
Copy-Item .env.example .env
\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port 8000
```

Keep the server terminal open. In a second terminal, verify it before calling
the API:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

The backend now includes the segmented workflow path. After an input upload is
confirmed, `POST /v1/jobs/{job_id}/start` starts segment 1, which creates the
inspection and quality artifacts and invokes Tool #1 plus Tool #2 when type
mismatches exist. A winning quality review starts segment 2 for formula,
standardization, and optional Tool #5 matching. A winning transformation review
starts segment 3, which applies accepted changes to a new output object and
validates it. The local no-`STATE_MACHINE_ARN` path remains a synchronous
deterministic fallback.

Artifact downloads use `GET /v1/jobs/{job_id}/artifacts/{artifact_type}` and
return short-lived URLs after ownership checks. Source workbooks are never
overwritten. Tool #5 skips unmatched rows in the demo, and OpenPyXL reports
formula syntax verification rather than calculated results.

For a simple local/frontend upload, send the workbook as multipart form data
after creating the job:

```powershell
curl.exe -X POST "http://127.0.0.1:8000/v1/jobs/$jobId/uploads/file/input" `
  -F "file=@.\finpilot_test_3_rows.xlsx"
```

The direct route at `/v1/jobs/{job_id}/uploads/file/{slot}` validates the
`.xlsx` extension, writes the file to S3, and
marks the DynamoDB job `UPLOADED`. It is intended for local development and a
small demo. Production clients should use the presigned `PUT` URL returned by
`POST /v1/jobs`, because the workbook then goes directly from the browser to
S3 instead of passing through FastAPI/API Gateway.

The frontend implements the presigned S3 flow at `/jobs/new`: it creates the
job, uploads the selected `.xlsx` to S3, confirms the object, and starts the
demo pipeline. If the frontend uses a different API address, create
`frontend/.env.local` with `VITE_API_BASE_URL=http://127.0.0.1:8000`. The
frontend never receives AWS credentials.

Start the frontend from a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/jobs/new`. The S3 bucket must include the CORS
configuration in `infra/template.yaml` (or an equivalent rule) for the
frontend origin; otherwise the browser will block the direct `PUT` request.

## Amazon Quick analytics

The QuickSight S3 integration for account `453995432289` was initialized from
the QuickSight console under **Admin → AWS resources**. The S3-backed quality
dataset is `qa-issues-s3-76bde119`; the S3 source manifest must point to
`quicksight/quality-issues.csv` in the application bucket and the stack must be
deployed in `ap-southeast-1` to address those Quick resources.

The SAM stack enables S3 EventBridge events and adds a buffered path:
quality-report object-created event → EventBridge → SQS → refresh Lambda. The
queue batches events for up to one minute; the Lambda scans all jobs, folds
quality reports and inspection manifests from every current-workbook slot into
stable CSVs, then requests SPICE ingestion. An active ingestion leaves the SQS
batch queued for retry so a later run refreshes the newest CSV. Repeated errors
move messages to the configured dead-letter queue for inspection and redrive.

The Lambda execution role is supplied from outside this template. Add least-
privilege permissions for `s3:ListBucket` on the app bucket, `s3:GetObject` on
`jobs/*`, `s3:PutObject` on `quicksight/*`, SQS receive/delete/attributes on the
refresh queue, and Quick `ListIngestions`/`CreateIngestion` on the configured
dataset ARNs. The existing Quick service role must retain read access to the
CSV object and manifest. The stack does not create or broaden IAM policies.

Before enabling refreshes, edit the existing quality dataset schema to include
the new `input_slot` column. In Quick, create a second S3-backed dataset using
[`scripts/qs-inspections-manifest.json`](scripts/qs-inspections-manifest.json)
for `quicksight/inspections.csv`, then deploy with
`QuickSightInspectionDatasetId` set to its dataset ID. The pipeline writes that
CSV even before the second dataset is configured. Build and publish dashboards
from the datasets: quality issues by kind/action/job/input slot, plus column
types and blank rates by job/input slot. Do not expose an anonymous embedded
dashboard until row-level security is mapped to the app's authenticated users;
the flattened reports currently aggregate all jobs in the whole bucket.

## Backend Days 1–7 progress

The backend includes deterministic workbook inspection and quality reporting,
server-side upload hashing, formula verification, safe copy-and-apply helpers,
canonical exact matching, review artifacts, and three short Step Functions
segments. Human reviews are execution boundaries: segment 1 ends at
`QUALITY_REVIEW_PENDING`, a winning review starts segment 2, and the
transformation review starts segment 3. There are no task tokens or paused
executions.

Completion decisions are recorded in
[`docs/decisions/0002-backend-days5-7-completion.md`](docs/decisions/0002-backend-days5-7-completion.md).

Deployment and verification steps are in
[`docs/backend-deployment.md`](docs/backend-deployment.md).
