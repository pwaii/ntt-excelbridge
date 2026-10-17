# Session log — Frontend Engineer (Days 1–2)

Updated: 2026-10-17 (Asia/Bangkok).
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

See [authentication configuration](frontend/AUTHENTICATION.md).

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
[Day 2 workbook API](docs/day2-workbook-api.md).

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
The older report's 65 backend tests were before the latest AI commits were pulled.

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

For the detailed smoke checklist and implementation file groups, see
[Day 2 completion report](frontend/DAY2-COMPLETION.md).

## Git delivery

- `main` was fast-forwarded from `159eb82` to `8552001` without conflicts.
- Day 1–2 work was committed as `2b3bba0` and pushed to
  `origin/feat/frontend-day1-day2-integration`.
- No merge into `main` was performed. AWS setup remains a separate environment task.
