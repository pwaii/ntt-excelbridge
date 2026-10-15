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
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

This is the storage foundation. The API routes, Step Functions orchestration,
authentication, and worker workflow still need to call these adapters.
