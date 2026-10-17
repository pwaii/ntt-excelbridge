# Session log — Frontend Engineer (Days 1–2)

Updated: 2026-10-18 (Asia/Bangkok).
Branch: `feat/frontend-day1-day2-integration`.
Implementation commit: `2b3bba0`, based on `main` at `8552001`.

**Status:** Day 1 is complete. Day 2 application integration is implemented and
automated checks pass. Real AWS end-to-end verification and real Cognito login
remain unverified. Do not describe the full AI processing workflow as complete.

## Source of truth

- [Design](docs/design.md).
- [Accepted ADR 0001](docs/decisions/0001-design-grilling-decisions.md), which
  overrides conflicting older requirements.
- [Frontend plan](docs/frontend-plan.md).
- Backend FastAPI `/openapi.json` is authoritative for API contracts. Regenerate
  frontend API types; do not edit generated types manually.

## Day 1 — foundation, layout and job creation

- Reused the React/Vite application with strict TypeScript, React Router,
  Tailwind CSS, reusable UI components, Lucide, React Hook Form and Zod.
- Added shared responsive navigation/layout and routes for login, job creation,
  progress, quality review, transformation review, result and Not Found.
- Quality review, transformation review and result screens remain placeholders.
- Built current/main XLSX file selection, drag/drop, removal/replacement,
  validation, processing options, reset and output-policy guidance.
- The UI field is a multiline **Prompt**. The API field remains **`comment_name`**
  for compatibility. Output Column Header is a separate required field.
- Main File is required whenever Standardize or Update is selected.
- Added frontend view models, synthetic fixtures and automated tests.

## Day 2 — authentication and backend integration

### Authentication

- Cognito Hosted UI foundation uses `oidc-client-ts`, Authorization Code + PKCE,
  callback handling, protected job routes, logout and token/session handling.
- Token type is explicit configuration; ID and access tokens are not interchangeable.
- Real Cognito configuration/login has not been verified in this environment.
- User explicitly selected the isolated `local-development` fallback. It is
  restricted to Vite development and loopback frontend/backend URLs, labels local
  access, uses the backend's `local-user` convention and creates no fake JWT.
- Production builds must not enable the development authentication bypass.

See [Authentication configuration and lifecycle](#authentication-configuration-and-lifecycle).

### Connected flow

1. Validate selected files and configuration in the frontend.
2. Create a real backend Job; submit `comment_name`, output header and mode flags.
3. Transfer workbook bytes directly to S3 using the backend's presigned PUT URL.
   Workbook bytes do not go through the FastAPI API.
4. Confirm each required upload with Backend.
5. Load actual workbook metadata from Backend.
6. Select the sheet, explicitly confirm/correct the header row and select required keys.
7. Save configuration to Backend using its revision and workbook version.
8. Enable Start only after configuration is valid and backend-confirmed.
9. Start through the real endpoint and navigate to actual job status.
10. Poll with capped backoff; stop at terminal states, human gates or request errors.

The old local **Preview configuration** action was removed. Selecting a file in
the initial picker only selects browser-local bytes. **Create job and upload files**
performs the actual job creation and S3 transfer; it does not start processing.

Saved sheet/header/key selections recover on job-page refresh without fabricated
File objects. Unsaved browser file selections are not recoverable after refresh.
Edits invalidate saved readiness. Duplicate/uncertain mutation outcomes are guarded;
there is no blind automatic Create/Save/Start retry.

### API operations

| Operation | Purpose |
| --- | --- |
| `POST /v1/jobs` | Create job and obtain upload instructions |
| Existing upload-confirmation operations | Confirm required uploaded objects |
| `GET /v1/jobs/{id}/workbooks/{slot}/metadata` | Inspect confirmed workbook bytes |
| `PUT /v1/jobs/{id}/configuration` | Persist confirmed sheet/header/key selections |
| `POST /v1/jobs/{id}/start` | Start with saved configuration and revision checks |
| `GET /v1/jobs/{id}` | Recover saved configuration and read actual status |

### Minimal backend support added

The latest task explicitly authorized minimal repository-owned backend support
where metadata/configuration endpoints were missing. No AWS infrastructure was
provisioned by this work.

- Added workbook metadata/configuration models, OpenPyXL inspection service,
  metadata/configuration routes and backend tests.
- Added ownership checks, real byte-derived workbook versions, header/key
  validation, conditional revision writes and saved-configuration Start guards.
- Upload confirmation invalidates saved choices; upload mutations after Start
  are rejected. A losing concurrent Start does not mark the winning execution failed.
- Missing AWS profile returns safe HTTP 503 / `AWS_PROFILE_NOT_FOUND`.
- Updated the existing demo worker's output base and source-hash handling.

Contract details and compatibility implications:
[Day 2 workbook API contract](#day-2-workbook-api-contract).

## ADR behavior and demo boundary

| Requirement | Current behavior |
| --- | --- |
| D1 | Approximately 2,000 rows is demo guidance; 25 MiB / 50,000 data rows are hard ceilings. Actual metadata is used, never fabricated counts. |
| D2 | Neither/Standardize use a current-derived output. Update/Both use a new main-derived output; original uploads remain unchanged. |
| D5 | React text rendering, no browser formula evaluation. Backend owns authoritative formula/data classification and export escaping. |
| D7 | Update policy explains unmatched rows are skipped, not inserted. Actual matching/merging is not implemented by the demo worker. |
| D8 | Saved revisions and source versions guard stale writes and Start; conflicts require reconciliation. |
| D10 | Backend detects a candidate header; human confirmation is required before Start. Excel header rows are one-based, bounded to 1–20. |

**The connected worker is still a validation/copy demo.** It validates sources,
writes/reopens a real new workbook in S3 and updates status. It does not add the
requested column, apply AI quality fixes, standardize values or merge matched rows.
The full Both policy requires standardization before matching when that future
processing pipeline is integrated. AI modules arriving from `main` do not by
themselves prove the frontend's Start path invokes Bedrock.

The UI has Bedrock explanatory copy that should be reviewed against this boundary;
it is not evidence that an AI operation ran. Browser visual verification is pending.

## Latest verification

Checks rerun after pulling `main` at `8552001`, before implementation commit:

| Command | Result |
| --- | --- |
| `npm.cmd --prefix frontend run build` | Passed, includes TypeScript check |
| `npm.cmd --prefix frontend run lint` | Passed |
| `npm.cmd --prefix frontend test -- --reporter=dot` | 263 passed, 18 files |
| Backend environment Python: `-m pytest backend/app/tests -q` | 87 passed |
| `git diff --cached --check` before commit | Passed |

Backend Python used locally:
`frontend/node_modules/.cache/integration-tools/backend-env/Scripts/python.exe`.
This disposable ignored tooling environment is not part of the committed project.
The earlier completion run had 65 backend tests before the latest AI commits were pulled.

API types were generated from the live local FastAPI OpenAPI schema. Fixtures and
tests use simulated external boundaries; they are not successful AWS requests.
React Router future notices, Rollup dependency annotation notices and the backend
TestClient deprecation warning did not fail the checks.

## Environment blockers and handoff

- AWS preflight found no available local profiles/credentials. Configured
  `AWS_PROFILE=finpilot` raises `ProfileNotFound`; real S3/DynamoDB flow is unverified.
- S3 browser CORS, IAM permissions and real resource availability remain unverified.
- Cognito public settings/token-type agreement and real login/logout require the
  team's actual configuration.
- No browser surface was available to automation; mobile/desktop visual and actual
  browser-to-S3 smoke checks remain pending.
- Root `.env` emitted malformed-line warnings. Review formatting privately without
  exposing values or overwriting the file.
- `.env`, `.env.local`, credentials and disposable tool caches were excluded from Git.

### Ways to finish real-service verification

**Local Backend:** obtain the team's approved AWS access, configure/login to a
profile matching root `.env`, verify STS identity and scoped S3/DynamoDB access,
check bucket/API CORS, then restart Backend. Do not put AWS credentials in Vite.

**Shared deployed Backend:** obtain the real API URL and authentication configuration
from Backend. Frontend developers do not need a local AWS profile if Backend runs
with its own AWS role. Local-only authentication fallback is unsuitable for a
remote production backend; use the environment's approved authentication.

In either environment, verify Create → direct S3 Upload → Confirm → Metadata →
Sheet/Header/Key → Save → refresh recovery → Start → Status for all four modes.
Check errors, duplicate prevention and preservation of original files. Record
actual AWS/browser results separately from the automated mocked tests.

See [Real-service smoke checklist](#real-service-smoke-checklist) and
[Implementation map](#implementation-map) below.

## Git delivery

- `main` was fast-forwarded from `159eb82` to `8552001` without conflicts.
- Day 1–2 work was committed as `2b3bba0` and pushed to
  `origin/feat/frontend-day1-day2-integration`.
- No merge into `main` was performed. AWS setup remains a separate environment task.


## Documentation consolidation ? 2026-10-18

This file is the single frontend session/update record. It replaces the separate
Day 1/Day 2 audit, authentication, uploads, metadata/start, integration and completion
reports, and the standalone Day 2 workbook API note. Superseded blockers are recorded
as history below instead of being presented as current requirements.

The frontend and API READMEs remain short entry points to this document. Project
design, accepted ADRs and the frontend plan remain separate sources of truth.
Documentation consolidation changes no application or backend behavior. The test
results above are the latest implementation checks, not a new test run for this edit.

## Development setup and architecture

Requires Node.js 22.18+ and npm. From `frontend/`:

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --reporter=dot
npm.cmd run build
npm.cmd run preview
```

Vite reads `frontend/.env.local`; Backend reads root `.env`. Copy the corresponding
`.env.example` and fill public frontend settings without overwriting existing local
values. Private environment files are ignored. Restart the relevant server after edits.
Static hosting must rewrite SPA deep links, including `/auth/callback`, to `index.html`.

The design uses light surfaces, navy text and poster-inspired cyan/violet gradient
actions. Tailwind v4 uses `@tailwindcss/vite` and CSS theme variables. UI primitives
are locally owned, with Radix Slot/CVA utilities; the import alias `@/` resolves to
`src/`. Font stacks use local fallbacks and motion respects reduced-motion settings.

### Implementation map

| Location | Responsibility |
| --- | --- |
| `frontend/src/app`, `routes`, `pages` | App composition, protected routes and page-level screens |
| `frontend/src/components/layout`, `ui`, `job` | Shared navigation, primitives, form, upload, header and metadata UI |
| `frontend/src/auth` | Provider, Cognito SDK adapter, local fallback and route/session guards |
| `frontend/src/api` | JSON transport, runtime decoders, concrete Jobs API and create controller |
| `frontend/src/api/generated/backend.ts` | Generated authoritative wire types |
| `frontend/openapi/backend.json` | Pinned actual FastAPI schema |
| `frontend/src/uploads` | Direct XHR transfer, progress, cancellation and confirmation coordination |
| `frontend/src/metadata` | Backend metadata adapter, readiness, selection/save/Start state |
| `frontend/src/schemas`, `types`, `lib` | Form validation, UI models, limits, policies and safe display helpers |
| `frontend/src/mocks`, `tests` | Explicit synthetic fixtures and unit/component tests |
| `backend/app/api/workbooks.py` | Metadata and saved configuration endpoints |
| `backend/app/domain/workbooks.py` | Workbook metadata and selection contracts |
| `backend/app/services/workbook_metadata.py` | Bounded real XLSX inspection |
| `backend/app/api/jobs.py`, `uploads.py` | Start and upload mutation guards |
| `backend/app/domain/models.py`, `schemas.py` | Saved selections and additive configuration fields |
| `backend/app/main.py` | Router registration and missing-profile error |
| `backend/app/workers/demo_pipeline.py` | Policy base, hash checks and validation/copy execution |
| `backend/app/tests/test_workbook_configuration.py` | Backend route/configuration regressions |

Legacy handwritten API assumptions remain isolated in `legacy-types.ts`; existing
legacy client/upload code is preserved but does not define the connected flow.
Frontend `*ViewModel` types are presentation models, not authoritative API DTOs.
Synthetic review models include pattern-level rules, server-owned revisions,
proposed/human accepted/edited/rejected states, candidate matches and formula origin.
They do not implement future review screens or grant approval based on confidence.

## Authentication configuration and lifecycle

| Variable in `frontend/.env.local` | Value |
| --- | --- |
| `VITE_API_BASE_URL` | Actual API origin; loopback HTTP permitted only for development |
| `VITE_AUTH_MODE` | `cognito`, or explicitly enabled `local-development` for DEV + loopback only |
| `VITE_S3_UPLOAD_ORIGINS` | Comma-separated exact HTTPS origins for the real bucket; no wildcard/path |
| `VITE_COGNITO_AUTHORITY` | Full Cognito pool issuer URL |
| `VITE_COGNITO_DOMAIN` | HTTPS Hosted UI/custom domain origin, no path |
| `VITE_COGNITO_CLIENT_ID` | Public SPA client ID; `VITE_COGNITO_APP_CLIENT_ID` is an accepted alias |
| `VITE_COGNITO_REDIRECT_URI` | Exact same-origin `/auth/callback` URL registered with Cognito |
| `VITE_COGNITO_LOGOUT_URI` | Exact same-origin `/login` URL registered for logout |
| `VITE_COGNITO_SCOPES` | Defaults to `openid profile email`; use backend-approved API scopes if needed |
| `VITE_COGNITO_API_TOKEN_TYPE` | Backend-confirmed literal `access` or `id`; no inferred default |

Cognito requires a public SPA client without a client secret, code grant, allowed
identity providers/scopes and exact callback/logout allowlists. Production URLs
require HTTPS. Do not put AWS keys, client secrets, passwords or JWTs in Vite values.

`AuthProvider` exposes loading/authenticated/unauthenticated/error states, basic user
identity, login/logout and `getValidToken()`. The SDK owns PKCE and OAuth state
validation. Callback initialization is shared to avoid double code redemption in
StrictMode; it strips callback parameters and accepts only safe internal return paths.

SDK user/tokens live in memory. Only transient OAuth state/PKCE verifier uses
sessionStorage with the `xlsx.oidc.` prefix. Tokens do not survive full page reloads;
sign-in can reuse the still-valid Cognito login cookie. This is not backend revocation.
Near-expiry requests share refresh work; failed/missing refresh clears the SDK user
and requires reauthentication. No unsupported silent iframe renewal is assumed.
Logout immediately hides identity and blocks token retrieval, clears the SDK user,
and redirects to Cognito logout without a JWT in the URL. Late refresh cannot restore
a logged-out user. External IdP/global token revocation is not claimed.

Local fallback stores only a tab-local access marker, uses `X-User-Id: local-user`
and omits Authorization. It issues no JWT. Backend decides whether fallback is
permitted. Set auth mode back to `cognito` and configure real settings for real login.
Local Uvicorn's upstream-claims handling does not independently prove bearer JWT
verification; the deployed authorizer's issuer/audience/token type/scopes must be
confirmed by Backend/AWS. Frontend route protection is not a security boundary.

## OpenAPI generation and API transport

From `frontend/`, with Backend running on port 8000:

```powershell
npm.cmd run api:generate
npm.cmd run api:generate:offline
```

The first downloads actual `/openapi.json`; the second regenerates from the pinned
snapshot without a server. `OPENAPI_URL` can select an approved schema URL.
`openapi-typescript` writes `src/api/generated/backend.ts`; do not hand-edit it.
`scripts/export-contract-fixtures.py` uses real FastAPI TestClient routes with fake
storage to export JSON fixtures. These fixtures do not represent real AWS success.

`http-client.ts` accepts relative `/v1/` JSON requests with runtime response decoders,
cancellation and a default 30-second timeout including token retrieval. It rejects
byte bodies, external destinations and redirects. Tokens go only to the API;
endpoint adapters cannot override Authorization. Generated TypeScript does not
replace runtime Zod validation or backend authorization.

Safe errors distinguish validation/auth/forbidden/not-found/conflict/rate-limit/server,
network/timeout/cancellation/protocol/configuration failures. Request IDs and safe
codes are retained where available. Raw response bodies, SDK errors, workbook data,
tokens and signed URLs are not logged/displayed. There are no automatic mutation
retries, including on 401 or unknown POST outcomes; reconcile authoritative state first.

## Direct S3 transfer and recovery

- The generated-contract adapter validates job/slot/filename/object identity, exact
  allowed HTTPS S3 origins and expiry from request-start time plus `expires_in`.
- Backend signs PUT with the XLSX Content-Type. XHR sends the original `File` and
  exact required header using the unchanged URL, not FormData/JSON or a backend proxy.
- S3 transport receives no Cognito token, Cookie or custom credential headers;
  `withCredentials` is false. Progress comes only from real XHR upload events;
  unknown totals remain indeterminate. ETag is read only if exposed, never guessed.
- Files move through waiting/uploading/awaiting-confirmation/uploaded or failure/
  cancellation states. 100% transferred is not backend confirmation.
- All required transfers finish before confirmations. GET reconciles already
  confirmed slots; remaining per-slot confirmations are sequential because revisions
  advance per write. The real endpoint is `POST /v1/jobs/{id}/uploads/complete`.
- Successful transfers are preserved when another transfer or confirmation fails.
  Ordinary failed/cancelled transfers permit bounded explicit retry; expired/403/
  configuration failures do not blindly reuse unsafe instructions. A 403 does not
  prove expiry. No URL-renewal endpoint is invented.
- Leaving the page aborts active transfers. Files/instructions/receipts remain in
  memory. A session resume link retains only the created job identity, not prompt,
  workbook bytes, JWTs or signed URLs. Interrupted uploads after refresh need a
  supported reselection/fresh-instruction contract; saved metadata recovery is separate.

Bucket CORS must allow the exact frontend origin, PUT and required headers. Progress
listeners trigger browser preflight. API CORS must permit the actual auth headers.
XHR does not provide fetch-style redirect control: trust/validate initial regional
S3 origins rather than redirecting proxies. Deployed IAM/CORS is still unverified.

## Day 2 workbook API contract

Implemented 2026-10-17 in this repository after confirming the affected backend
files had no pending implementation changes. The task authorizes minimal backend
support. FastAPI `/openapi.json` is authoritative; frontend types are regenerated
from it. No external endpoint or metadata response was fabricated.

### Endpoints and compatibility

| Operation | Contract |
| --- | --- |
| `GET /v1/jobs/{id}/workbooks/{slot}/metadata` | Owned, confirmed-upload inspection. `slot` is `input` or `main`. Optional `sheet_name` and `header_row` query parameters obtain columns for a corrected header. |
| `PUT /v1/jobs/{id}/configuration` | Save human-confirmed choices using `expected_revision` and `selections` keyed by upload slot. Requires `UPLOADED`; conditional revision update returns the real JobResponse. |
| `POST /v1/jobs/{id}/start` | Existing bodyless operation. Now enforces ADR D10 saved configuration and revalidates workbook versions. Optional `expected_revision` query rejects stale clients. |
| `GET /v1/jobs/{id}` | Existing operation now includes `configuration_confirmed` and `workbook_selections` for refresh recovery. |

New fields are additive and default to unconfirmed for existing records. **Start
behavior is intentionally tightened:** old clients/jobs must save valid confirmed
choices before Start; they receive 422 otherwise. The request remains bodyless.
A completed job's duplicate Start remains idempotent. Losing concurrent conditional
writes return 409 without marking the winning execution failed.

No authentication changes were made to Backend. Existing owner checks and the
explicit frontend development-only `local-user` fallback are preserved. No new AWS
resource, storage subsystem, dependency, Step Functions wait or review screen exists.

### Metadata and selection semantics

- Metadata comes from actual S3 object bytes, inspected using existing OpenPyXL.
  Formula evaluation never occurs; no workbook data rows or presigned URLs are
  returned as previews. Header strings are plain text in React.
- `workbook_version` is the SHA-256 of those bytes, not a guessed row count, filename
  or fabricated version. Save and Start inspect again and reject changed sources.
- Excel row numbering is **one-based, 1–20**. Metadata includes bounds/index base,
  detected guess, selected header row, actual column labels and data-row counts.
  Detection is a deterministic bounded heuristic, always subject to human correction.
- Column IDs are physical Excel column letters (`A`, `B`, `AA`), so duplicate header
  labels remain distinguishable. Key columns must be in the inspected header.
  Update/Both require keys in current and main; other modes permit an optional key.
- A selection includes `sheet_name`, `header_row`, literal `header_confirmed: true`,
  optional `key_column`, and `workbook_version`. Required slots are exactly `input`,
  plus `main` whenever Standardize or Update is selected.
- Save updates existing JobConfig sheet/key fields and adds `input_header_row`,
  `main_header_row`, `main_key_column`. Prompt remains `comment_name`; flags and
  output header remain the create-time configuration.
- Missing uploads, unknown sheets/keys, empty header rows, invalid XLSX and missing
  confirmation return 422. Stale revision or changed source returns 409. Ownership
  failures return 404. No save occurs before validation succeeds.
- Reconfirmation of an upload invalidates saved selections. Upload/confirmation
  writes after Start are rejected, protecting the configuration baseline.
- Approximately 2,000 rows remains guidance; real metadata supports the 50,000
  data-row ceiling aggregated across sheets and 25 MiB byte ceiling. Bounded ZIP
  inspection also rejects expanded archives above 256 MiB to limit resource use.

### Existing demo worker boundary

Start still runs the existing synchronous **validation/copy demo**, not the future
AI/review pipeline. It writes and reopens an actual new S3 workbook and updates
actual status; success is not simulated. The output base now follows ADR D2:
current for Neither/Standardize, main for Update/Both. Original objects are preserved,
and source/input hashes remain distinct in the audit manifest.

**No quality fixes, new output column, standardization mappings or matched-row
updates are applied by this demo worker.** Flags/choices are persisted for the
future workflow. UI copy explicitly states this limitation. This task does not
claim completion of Day 3–7 transformation/review functionality.

### Frontend behavior

Create/Upload is the only primary action; the obsolete local Preview flow is removed.
After all required backend confirmations, metadata loads from the new endpoint.
The user chooses sheet, confirms/corrects header and selects required keys. A changed
header requires metadata reload for the corresponding columns; confirmation resets.

**Save and confirm configuration** persists choices without starting. Only a valid,
saved configuration enables Start. Edits invalidate saved readiness. A fresh
`/jobs/{id}` page restores confirmed choices from Backend without fake File objects.
Unsaved local file selections are not recoverable after refresh.

Start uses the saved server revision and guards duplicates/unknown outcomes.
Progress polls real GET status with 2/4/8/15-second capped backoff, stopping at
terminal statuses or human gates. Errors stop automatic polling and allow manual
Refresh. No automatic create/save/Start retry is performed.

## Historical audits and corrections

These are historical milestones, not current claims that integration is missing:

| Stage (2026-10-16?17) | Record |
| --- | --- |
| Day 1 Tasks 1?6 | Foundation/form/models audited against ADR; ready for Day 2 dependencies |
| Task 7 | Cognito foundation, 128 frontend tests; no real Cognito test |
| Task 8 | Independent JSON transport/create boundary, 159 tests; OpenAPI initially unavailable |
| Task 9 | Independent direct-upload coordinator/UI, 195 tests; real adapters initially blocked |
| Task 10 | Metadata/header/save/Start boundaries, 229 tests; initially not mounted |
| Task 11 QA | Logout race fixed; refresh/uncertain-outcome coverage, 233 tests; real flow not ready then |
| Subsequent integration | Schema conflict resolved with `comment_name`, OpenAPI generated, production wiring and explicit local fallback; 258 tests |
| Day 2 completion implementation | Metadata/save backend support, resume, Start and polling connected; 263 frontend / 65 backend tests |
| After latest main pull | 263 frontend / 87 backend tests passed before implementation commit |

Day 1 fixes included focus restoration after file removal, accessible replacement
error associations, narrow-screen action stacking, visible prompt keyboard focus,
rejecting blank version/sheet confirmation bindings, complete standardize policy
wording, ESLint configuration and lockfile synchronization. Required Output Header
follows the explicit task requirement over older optional wording.

Day 2 QA reproduced and fixed token retrieval while asynchronous logout cleanup was
pending: the adapter now blocks synchronously before consulting SDK storage. Tests
also verify fresh controllers cannot invent prior upload success or replay Start.
The old merge-conflict/OpenAPI/metadata-contract blockers are resolved in this branch.
Environment/Cognito/browser blockers above remain; prior lower totals are historical.

Additional ADR boundaries: D3 uses no frontend Step Functions calls/task tokens;
D4 models pattern-level rather than per-cell proposals; D6 candidate generation
remains backend-owned; D9 requires explicit human decisions, never confidence-based
automatic approval. D5 renders both data and approved-formula origins as plain React
text; backend review data must establish origin and final Excel escaping.

## Real-service smoke checklist

1. Choose approved AWS profile access for local Backend, or the team's deployed API
   and supported authentication. Verify real bucket/table access and API/S3 CORS.
2. Start updated Backend and Vite; inspect `/health` and `/openapi.json`. Health alone
   does not prove AWS access. Use local fallback only on supported loopback development.
3. Choose a small nonsensitive XLSX, enter Prompt/Output Header, choose a processing
   mode and provide Main File whenever either flag is selected.
4. Click Create job and upload files once. Verify actual S3 transfer and backend
   confirmation for every required slot; reconcile uncertain outcomes before retry.
5. Select a real sheet, inspect/correct the detected header, reload columns when
   corrected, explicitly confirm headers and select required keys for Update/Both.
6. Save configuration. Open the job link and refresh; verify persisted values restore
   and Start remains eligible without browser File objects.
7. Start once. Check actual status, terminal success/failure and polling termination.
   Inspect safe request IDs on errors; verify duplicate submissions do not replay work.
8. Repeat Neither, Standardize only, Update only and Both. Verify output base and
   unchanged originals, respecting the validation/copy limitation above.
9. With Cognito configured, separately test protected deep link ? Hosted UI ? callback
   ? intended route ? API-authorized token ? refresh/expiry ? logout ? denied route,
   plus full reload and invalid/cancelled callback recovery.
10. In a real browser check desktop/mobile layout, keyboard focus, disabled-action
    explanations, deep-link rewrites and honest AI copy. Record results, not assumptions.

## Documentation references

- [oidc-client-ts](https://authts.github.io/oidc-client-ts/)
- [OpenAPI TypeScript generator](https://openapi-ts.dev/node)
- [AWS presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [Cognito PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
- [Cognito logout](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)
