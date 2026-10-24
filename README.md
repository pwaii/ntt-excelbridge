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

## Architecture

Three cooperating layers in `backend/app/`:

- **API** (`api/`) — FastAPI on Lambda; job CRUD, presigned S3 URLs, review submission, artifact downloads. Never receives workbook bytes directly.
- **Workers** (`workers/`) — bounded, idempotent Lambdas: `inspect_workbook`, `quality_rules`, `apply_changes`, `validate_output`. OpenPyXL always writes to a new S3 object.
- **AI** (`ai/`) — Bedrock Converse API, Tools 1–5. All LLM output is validated against Pydantic schemas; the model only selects from candidate IDs supplied in the prompt.

State persists in a single DynamoDB table (`PK=JOB#<id>` / `SK=META|ISSUE#|PROPOSAL#|REVIEW#|EVENT#`) with conditional revision updates. Three short Step Functions segments run between human review gates — no task tokens or paused executions.

Local development uses the no-`STATE_MACHINE_ARN` in-process fallback. See `docs/backend-deployment.md` for AWS deployment and `docs/frontend-demo-runbook.md` for the demo validation checklist.
