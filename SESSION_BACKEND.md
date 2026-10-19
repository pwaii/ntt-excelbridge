# Session Backend: AWS-backed XLSX workflow

This branch adds the backend foundation for sending an Excel workbook through
the AWS pipeline. The branch is `codex/backend-s3-dynamodb-pipeline` and is
based on the latest `main`, including the existing AI Day 1 work.

## What was implemented

The backend now supports this end-to-end demo flow:

1. Create a job in DynamoDB and receive short-lived S3 upload URLs.
2. Upload `.xlsx` files directly from the browser to a private S3 bucket.
3. Confirm each upload; the API verifies the S3 object and updates DynamoDB.
4. Start the job; the deployed path runs the first short workflow segment.
5. Inspect the workbook, run deterministic quality rules, and invoke Tool #1
   plus Tool #2 when type mismatches exist.
6. Submit a revision-checked quality review; the winning review starts segment 2.
7. Run formula, standardization, and bounded update matching proposals.
8. Submit the transformation review; the winning review starts segment 3.
9. Apply accepted changes to a new output object, write decision-level audit
   artifacts, reopen/validate the output, and mark the job `COMPLETED`.
10. Request short-lived download URLs for output, audit, summary, or input artifacts.

The local no-`STATE_MACHINE_ARN` path remains intentionally pass-through for
development. Deployed environments use the three short Step Functions
segments and the deterministic inspection/quality/apply/validate workers.

## Main files

- `backend/app/settings.py` loads `.env` from the repository root and defines
  AWS, upload, CORS, workbook-limit, and TTL settings.
- `backend/app/storage/aws_session.py` creates one reusable boto3 session and
  bounded AWS clients. Local development can use `AWS_PROFILE`; deployed code
  should use its IAM role and leave `AWS_PROFILE` empty.
- `backend/app/storage/s3_store.py` owns private workbook/artifact storage,
  object-key validation, and presigned PUT/GET URLs.
- `backend/app/storage/dynamo_store.py` owns job metadata. The single-table
  record uses `PK=JOB#<job_id>`, `SK=META`, revision numbers, status indexes,
  owner lookup, and TTL. Conditional revision updates prevent stale clients
  from overwriting newer state.
- `backend/app/api/jobs.py` creates, lists, reads, and starts jobs.
- `backend/app/api/uploads.py` verifies S3 uploads and records their size,
  ETag, content type, and optional SHA-256 hash. It also provides a multipart
  fallback at `/v1/jobs/{job_id}/uploads/file/{slot}` for local demos.
- `backend/app/workers/demo_pipeline.py` remains the local no-state-machine
  fallback for inspection and deterministic quality checks.
- `backend/app/workers/matching.py` creates bounded candidate sets before Tool
  #5; it never sends the entire main workbook to the model.
- `backend/app/workers/apply_changes.py` applies accepted quality,
  type-normalization, formula, standardization, and update decisions to a new
  workbook copy.
- `backend/app/api/artifacts.py` lists review artifacts and returns ownership-
  checked presigned download URLs, including full proposal artifacts.
- `frontend/src/features/job-create/index.tsx` demonstrates the browser flow:
  create job, PUT to S3, confirm upload, and start the job.
- `infra/template.yaml` records the intended S3/DynamoDB resources and CORS
  configuration. `infra/s3-cors.json` can be applied to an existing bucket.
- `.env.example` and `frontend/.env.example` document configuration without
  containing credentials.

## Local configuration

Copy `.env.example` to `.env` and fill in the existing team resources:

```text
AWS_REGION=ap-southeast-1
AWS_PROFILE=finpilot
APP_DATA_BUCKET=<private-bucket-name>
DYNAMO_TABLE=<table-name>
```

`.env` is ignored by Git. Do not put access keys, secret keys, session tokens,
or other credentials in the repository. The browser receives presigned URLs,
never AWS credentials.

Install and run the backend from the repository root:

```powershell
\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port 8000
```

Check the server in another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

The AWS profile must still be authenticated before a real AWS test. If SSO
credentials expire, run `aws sso login --profile finpilot` again. The DynamoDB
table, S3 bucket, region, and profile must all refer to the same AWS account
and region.

## Data ownership decision

- S3 stores large or binary objects: input workbooks, `final.xlsx`, and the
  inspection manifest. This keeps workbook bytes out of DynamoDB and allows
  direct browser transfer through presigned URLs.
- DynamoDB stores small searchable job metadata: owner, status, revision,
  timestamps, file keys, hashes, and artifact metadata. It is the workflow
  state source, not a file store.

The layout is private and namespaced by job:

```text
jobs/<job_id>/input/input/<filename>.xlsx
jobs/<job_id>/input/main/<filename>.xlsx
jobs/<job_id>/inspection/manifest.json
jobs/<job_id>/output/final.xlsx
```

## What is still a gap

- The local no-`STATE_MACHINE_ARN` path is intentionally synchronous; deployed
  environments use the segmented workflow.
- Tool #5 demo behavior skips unmatched rows rather than inserting new rows.
- Excel formulas are syntax-verified but are not calculated by OpenPyXL.
- Production Bedrock model evaluation, AWS deployment, alarms, budgets, and
  cost-guard enforcement still require an account-specific verification pass.
- The frontend remains responsible for the review screens and user-facing
  bulk-review interactions.
- Cognito/API Gateway is defined in `infra/template.yaml`; the local auth path
  remains suitable for development only until the stack is deployed.
- IAM policies, deployment packaging, CloudWatch monitoring, retries, and
  production error reporting still need deployment-specific configuration.
- The frontend is a working upload placeholder, not the completed product UI.

## Verification status

Static JSON/Python checks and focused deterministic tests should be run after
the local dependencies are available. Full pytest/Ruff execution and SAM
validation require the Python packages and SAM CLI; no AWS deployment is
claimed by this session. A repository scan must continue to exclude `.env`
files, AWS access keys, session tokens, and private keys.

The architectural decisions for this completion pass are recorded in
`docs/decisions/0002-backend-days5-7-completion.md` and the follow-up privacy
and correctness decisions are in
`docs/decisions/0003-backend-correctness-hardening.md`.
Runtime correctness and deployment-transform fixes are recorded in
`docs/decisions/0006-backend-runtime-correctness.md`. The command-by-command
verification sequence is in `docs/backend-smoke-test.md`.


## Frontend integration follow-up (2026-10-19)

The frontend integration branch merges this backend baseline and adds the typed,
revision-bound review-report API, concrete frontend consumers, complete gate decision
validation, durable stage review pointers and failed-continuation recovery. It also
adds direct Cognito JWT verification and Hosted UI/CORS wiring. Confirmed header/key
metadata now feeds matching/apply workers; approved output formulas and row deletion
ordering have integration coverage. DynamoDB numbers are normalized at the storage
boundary. See SESSION_FRONTEND.md for the current scope, checks and environment blockers.
No cloud deployment or real Cognito/Bedrock run was performed by this follow-up.
