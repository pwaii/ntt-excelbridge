# Session Backend: AWS-backed XLSX workflow

This branch adds the backend foundation for sending an Excel workbook through
the AWS pipeline. The branch is `codex/backend-s3-dynamodb-pipeline` and is
based on the latest `main`, including the existing AI Day 1 work.

## What was implemented

The backend now supports this end-to-end demo flow:

1. Create a job in DynamoDB and receive short-lived S3 upload URLs.
2. Upload `.xlsx` files directly from the browser to a private S3 bucket.
3. Confirm each upload; the API verifies the S3 object and updates DynamoDB.
4. Start the job; the demo worker reads the input workbook from S3.
5. Validate the workbook with OpenPyXL and write an inspection manifest.
6. Write a separate `final.xlsx` output object to S3.
7. Reopen and validate the output, then mark the job `COMPLETED` in DynamoDB.
8. Request a short-lived download URL for the output artifact.

The current worker is intentionally a pass-through. It proves the storage,
metadata, validation, and output path without changing the user's workbook.

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
- `backend/app/workers/demo_pipeline.py` performs the OpenPyXL inspection,
  manifest creation, pass-through output, output validation, and final status
  update.
- `backend/app/api/downloads.py` returns a presigned download URL for a
  completed artifact.
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

- The worker is synchronous and pass-through; it does not yet run the complete
  transformation chain or create Excel formulas from AI proposals.
- Step Functions or another durable job runner is not wired into `start` yet.
- Bedrock proposal generation and the review/approve loop are not connected to
  this storage path.
- Full OpenPyXL transformations, validation rules, audit events, and final
  `results.csv`/Excel output are still to be integrated.
- Cognito/API Gateway or another production authentication boundary is not
  deployed. The current local auth path is suitable for development only.
- IAM policies, deployment packaging, CloudWatch monitoring, retries, and
  production error reporting still need deployment-specific configuration.
- The frontend is a working upload placeholder, not the completed product UI.

## Verification completed

The branch was checked with the backend test suite and Ruff. At the time of
commit, the result was `17 passed`; Ruff also passed. A repository scan found
no committed `.env` files, AWS access keys, session tokens, or private keys.

The next backend milestone is to replace `run_demo_pipeline` with the durable
orchestrated workflow while preserving the existing S3/DynamoDB API contract.
