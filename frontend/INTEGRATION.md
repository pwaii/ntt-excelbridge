# Current Day 2 integration status

Superseded by [the 2026-10-17 completion work](DAY2-COMPLETION.md): real backend
metadata/save/Start support is now implemented and Preview Configuration removed.
The remaining real-service blocker is the unavailable AWS profile; earlier missing
metadata-contract statements below describe the prior implementation.

Updated 2026-10-16 after resolving the local schema conflict. This supersedes
historical Task 8–11 statements about missing OpenAPI/unmounted upload panels.

## Current local access mode

The user subsequently authorized the backend fallback while Cognito is unavailable.
`frontend/.env.local` explicitly sets `VITE_AUTH_MODE=local-development`. Open
`/login` and choose **Continue in local development** to use backend fallback
`local-user`. The UI labels it as local development, not Cognito authentication.

This requires Vite DEV and loopback frontend/backend URLs. API requests use
`X-User-Id: local-user` and omit Authorization; no JWT is fabricated and the token
provider is not called. The backend still decides whether its fallback is enabled.
Production fails closed if configured for this mode. Set `VITE_AUTH_MODE=cognito`
and fill the real Cognito settings when ready.

Only a local access marker is stored for this tab; exiting clears it. This replaces
the earlier decision to wait for Cognito described below. Metadata/header persistence
is still absent, so Start remains disabled. Tests cover local entry/exit, refresh,
no token issuance, tokenless request headers, loopback restrictions and production
rejection. This change does not modify backend code or test real Cognito/AWS login.

Fallback verification: **258 frontend tests passed, 0 failed**; typecheck, lint and
production build passed. A TestClient GET through the actual backend auth/route
with fake storage confirmed `local-user` access without a JWT. The running local
API's CORS preflight for `content-type,x-user-id` returned HTTP 200. Neither check
created an AWS job or uploaded a workbook. Earlier totals below describe the
preceding integration run.

## Implemented and connected

1. The actual local FastAPI server now serves `/health`, `/docs`, `/openapi.json`.
   The downloaded contract is pinned at `openapi/backend.json`; generated types
   are at `src/api/generated/backend.ts`. No API DTOs were invented.
2. `jobs-api.ts` uses generated request/response types and runtime Zod decoders.
   Create sends JSON declarations with `config.comment_name`, never File bytes.
   The visible form still says **Prompt**. The published 200-character limit is
   checked locally. Required Output Header and Main File rules remain intact.
3. The production Create page mounts a separate explicit **Create job and upload
   files** action. Day 1's local-only Preview stays available before creation.
   Creation locks the configuration and prevents duplicate submissions. Unknown
   POST outcomes block blind retries, as before.
4. Real presigned instructions are mapped from `input`/`main` to UI roles. URLs
   must match configured HTTPS S3 origins, filenames and object identities.
   Backend `S3Store` signs PUT with the XLSX Content-Type; the adapter sends that
   exact header. Expiry uses request-start time plus `expires_in`, conservatively
   accounting for response delay. Native XHR sends each original File directly
   to S3 without a Cognito header or browser credentials.
5. Required transfers finish before confirmation. GET reconciles already-confirmed
   slots; remaining slot confirmations run sequentially because the backend
   advances revision per slot. Results must confirm the requested identity/slot.
   No automatic mutation retry, fabricated checksum or multipart API proxy is used.
6. The post-upload panel loads real job/file facts through GET. It does not pretend
   these are workbook inspection metadata. Start remains disabled for the missing
   contracts below. File cancellation/retry and distinct transfer/verification
   states remain visible. Navigating away cancels active file transfers.
7. `/jobs/:id` loads an authoritative status snapshot when Cognito/token settings
   are ready and provides explicit Refresh. No timeline, polling, review or downloads
   were added. Reloading a job route only GETs state; it never replays Start.
8. A successful created job ID is retained in sessionStorage for a resume link on
   `/jobs/new`. No token, prompt, workbook bytes or presigned URL is persisted.
   Browser Files are not recoverable after reload; completing interrupted uploads
   still needs reselection/fresh instructions through a documented backend contract.

## Public frontend configuration

The root `.env` is for Backend. Vite reads `frontend/.env.local`. This task prepared
that ignored file using only allowlisted public Vite values and public S3 origins
derived from the configured bucket/region. No AWS credentials were copied.
Existing frontend-local values were preserved when nonempty.

Required settings:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_S3_UPLOAD_ORIGINS=https://your-bucket.s3.your-region.amazonaws.com
VITE_COGNITO_AUTHORITY=https://cognito-idp.your-region.amazonaws.com/your-pool-id
VITE_COGNITO_DOMAIN=https://your-hosted-ui-domain
VITE_COGNITO_CLIENT_ID=your-public-spa-client-id
VITE_COGNITO_REDIRECT_URI=http://127.0.0.1:5173/auth/callback
VITE_COGNITO_LOGOUT_URI=http://127.0.0.1:5173/login
VITE_COGNITO_SCOPES=openid profile email
VITE_COGNITO_API_TOKEN_TYPE=backend-confirmed-access-or-id
```

These are explanatory placeholders, not usable credentials. CLIENT_ID may instead
use the existing APP_CLIENT_ID alias. API_TOKEN_TYPE must literally be `access` or
`id`, confirmed by Backend. Origins are comma-separated exact origins, not wildcard
hosts or full paths. Restart Vite after editing its environment.

Current missing values include Cognito AUTHORITY, DOMAIN and API_TOKEN_TYPE. The
root backend Cognito pool setting is also empty. Callback/logout allowlists, public
client configuration and deployed API authorization must be established by the
Backend/AWS owner. The user explicitly chose to wait for real Cognito rather than
enable a development test-user adapter. No bypass or fake JWT was added.

Important: local `backend/app/auth.py` reads trusted API Gateway event claims; it
does not independently verify a bearer JWT sent directly to Uvicorn. Its local
fallback is not evidence of verified Cognito authentication. Real auth certification
needs the deployed JWT authorizer or a separately approved backend local-auth design.

The backend dotenv loader reports malformed statements at lines 1, 2, 4, 7, 12,
23 and 29 of the current root environment file. The server still starts and serves
OpenAPI. The file was not rewritten; use `KEY=value` assignments and `#` comments
when reviewing it locally. No environment values were logged by this task.

## Start is still blocked by the actual backend contract

The published paths include create, GET job, per-slot upload completion and a
bodyless `/start`. They contain no pre-start workbook inspection or selection-save
operation. The existing Start implementation is a pass-through demo, not the full
ADR D2/D10 workflow. The frontend does not call it to bypass header confirmation.

Backend handoff still needed:

- A real pre-start metadata source: file version, sheets, columns, data-row counts,
  detected header, first-20-row bounds/indexing and key requirements.
- A documented way to refresh columns for a corrected header and persist the final
  sheet/header/key selections with a validated server acknowledgement/revision.
- Start acceptance and authoritative reconciliation semantics once those choices
  are saved; support the selected output policy without mutating the original file.
- Deployed API/S3 CORS, JWT token type, and URL renewal/reselection behavior for
  interrupted or expired uploads.

`createBackendMetadataAdapter` maps only the job/file fields the contract actually
provides; sheets remain empty and key rules unknown. No metadata, row counts,
confirmation or revision advancement is guessed. It deliberately supplies neither
`persistSelections` nor `start`. The already-tested richer panel can be connected
once the contract supports it without rebuilding Day 1.

## Reproducible generation and tests

From `frontend/`:

```powershell
npm.cmd run api:generate          # actual running /openapi.json on port 8000
npm.cmd run api:generate:offline  # deterministic regeneration from pinned snapshot
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --reporter=dot
npm.cmd run build
```

`OPENAPI_URL` can select an approved alternative contract URL. Generation uses
[openapi-typescript's supported API](https://openapi-ts.dev/node); do not hand-edit
the generated module. The only new frontend dev dependency is `openapi-typescript`.

`scripts/export-contract-fixtures.py` exports synthetic JSON through actual
FastAPI TestClient routes with fake Dynamo/S3 dependencies, using backend dev
dependencies. It changes no backend implementation and invokes no real AWS service.
Fixtures under `src/tests/fixtures/backend/` are used only in tests. New tests cover
wire payload names, identity/origin checks, sequential confirmation, already-confirmed
reconciliation, missing metadata contracts, production page wiring, duplicate create,
raw File upload, disabled Start, fresh status GET and missing auth configuration.

An isolated Python 3.12 backend development environment was installed in the ignored
workspace cache because the system MSYS Python had none of the backend dependencies.
The local server was started with:

```powershell
.\frontend\node_modules\.cache\integration-tools\backend-env\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

This cached tool environment is disposable (for example `npm ci` can remove it).
A normal project `.venv` using standard Windows Python 3.12+ can run the same command.
No application code depends on the cached tool path.

## Verification and remaining limits

- Actual HTTP: Backend health `ok`, OpenAPI downloaded/generated; frontend `/login`
  returned 200. Both development servers were left available on ports 8000/5173.
- Frontend: typecheck, ESLint and production build passed. Full suite: **248 passed,
  0 failed, 16 files** (15 new cases beyond the previous 233).
- Backend existing schema/API tests: **7 passed** using the isolated environment.
- Offline schema generation passed. Scoped diff checks passed. No backend source
  changes, staging, commit or push in this integration task.
- Computer-use inventory returned no apps/browsers, so no browser/mobile visual
  certification was possible. HTTP 200 and jsdom are not browser E2E evidence.
- Real Cognito login, authenticated deployed API mutations, S3 PUT/CORS and actual
  Start were **not executed**. Mocked contract tests are not real AWS certification.
- Nonblocking existing Router future-flag, Zod/Rollup annotation and backend
  TestClient deprecation notices remain. The production bundle is approximately
  522 kB (158 kB gzip), producing a nonblocking Vite 500 kB chunk-size advisory.
- `npm.cmd ci --dry-run --ignore-scripts --no-audit --no-fund` passed: package and
  lockfile remain synchronized. Environment files are confirmed Git-ignored.

## Changed files in this integration task

- Added `scripts/generate-api.mjs`, `scripts/export-contract-fixtures.py`,
  `openapi/backend.json`, and generated `src/api/generated/backend.ts`.
- Added `src/api/jobs-api.ts`, `job-services.ts`,
  `src/metadata/backend-adapter.ts`, and `src/lib/pending-job.ts`.
- Added `connected-create-flow.tsx` and `connected-job-status.tsx`; updated the
  existing Create Job and Job Progress pages to mount them.
- Updated the form schema's published Prompt length limit, environment example,
  package/lockfile, ESLint configuration and current/historical integration docs.
- Added `jobs-api.test.ts`, `connected-flow.test.tsx`, backend-exported synthetic
  fixture JSON, and one validation boundary case.
- Prepared ignored `frontend/.env.local` from existing public configuration.
  Private root `.env` and backend implementation were not changed.

Day 2 remains **Not ready** for complete E2E acceptance. Create/upload/confirm/status
are now connected in application code, rather than isolated foundations; real auth
configuration and missing metadata/persistence/Start contracts still block completion.
