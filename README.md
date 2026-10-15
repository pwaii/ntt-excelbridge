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

The backend now includes a demo AWS round trip: after an input upload is
confirmed, `POST /v1/jobs/{job_id}/start` reads the workbook from S3, validates
it with OpenPyXL, writes `jobs/<job_id>/output/final.xlsx` and an inspection
manifest back to S3, updates DynamoDB to `COMPLETED`, and
`GET /v1/jobs/{job_id}/artifacts/output` returns a short-lived download URL.
This is a pass-through validation path; Step Functions, Bedrock proposals, and
the full transformation workers will replace it later.

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
