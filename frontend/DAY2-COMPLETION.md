# Day 2 completion work — 2026-10-17

## Result

The application code now connects Create → direct S3 transfer → confirmation →
real backend metadata → sheet/header/key → Save → Start → status/polling. The
obsolete Preview Configuration flow is removed. **Real AWS end-to-end acceptance
is not complete:** AWS preflight fails with `ProfileNotFound` for the configured
`AWS_PROFILE`. No real S3 upload or AWS job mutation was performed in this task.

The previous "missing backend metadata contract" blocker is resolved by minimal
repository-owned support explicitly authorized in the attached task. See the
[implemented contract and compatibility change](../docs/day2-workbook-api.md).
The existing worker remains an explicitly labeled validation/copy demo; no AI
transformation or approval is fabricated.

## Files changed

- Backend added: `app/domain/workbooks.py`, `app/services/workbook_metadata.py`,
  services package initializer, `app/api/workbooks.py`,
  `app/tests/test_workbook_configuration.py`.
- Backend updated: existing schemas/models, router registration, Start guard,
  upload immutability/invalidation, demo output-base/hash/row-limit handling.
- Frontend updated: Create page/actions/upload hint, connected create flow,
  Jobs API/JSON query transport, metadata adapter/models/readiness/controller,
  header editor, save/Start panel, status/polling/resume page.
- Generated: pinned actual OpenAPI snapshot and TypeScript module, never hand-edited.
- Tests/fixtures updated: creation, metadata, saved configuration, connected flow,
  real backend-exported JSON fixtures; added polling success/failure tests.
- Docs: this report and the shared API contract; current README/integration links.

All earlier unrelated working-tree changes were preserved. No new dependencies,
AWS resources, commit, push or Git staging were introduced by this task.

## Verification categories

| Category | Evidence |
| --- | --- |
| Implemented and locally verified | Live backend serves the new OpenAPI endpoints. Real OpenPyXL inspection, selection validation/persistence, ownership, source versions and conditional writes pass backend route tests using storage doubles. |
| Implemented with mocked external boundaries | Production Create page flow sends real-contract JSON, passes browser File objects to mocked XHR, confirms required slots, loads metadata, saves and starts exactly once. Resume loads persisted choices without Files; polling stops on success/failure. |
| Blocked by backend | No remaining metadata/save/Start integration blocker in this checkout. Deployment of the new backend contract must occur before using a remote environment. Future AI transformations remain outside this demo. |
| Blocked by environment | Configured AWS profile is unavailable (`ProfileNotFound`); no usable AWS credentials were found in the process or workspace AWS config. Computer-use has no apps/browsers, so visual/browser smoke is also unverified. |

## Commands and results

Commands run from the repository root unless shown with `frontend/` cwd:

- `npm.cmd --prefix frontend run api:generate`: passed against the real local
  FastAPI schema, after restarting the owned backend server with the new routes.
- `npm.cmd --prefix frontend run api:generate:offline`: passed from pinned schema.
- Frontend `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`: passed.
- Frontend full unit/component suite and backend test totals are recorded in the
  final verification below; synthetic fixtures are not real AWS test responses.
- Final frontend result: **263 passed, 0 failed, 18 files**. Typecheck/ESLint and
  the final production build passed (approximately 457 kB JS / 142 kB gzip).
- Isolated backend Python `-m ruff check` on the new backend modules/tests: passed.
- Isolated backend Python `-m pytest backend/app/tests -q`: **65 passed**.
- Read-only AWS STS preflight: **blocked, ProfileNotFound**, before any job creation.
- A live Create attempt hit the same missing-profile dependency before writing
  a job. The backend now returns safe HTTP 503 / `AWS_PROFILE_NOT_FOUND` instead
  of an unhandled 500 for this condition; its handler is tested. A fresh live GET
  confirmed that diagnostic after restarting the server without Windows auto-reload.
- Live OpenAPI confirms metadata/configuration paths. Browser inventory: none.
- Scoped `git diff --check`: passed, with existing line-ending notices.

The isolated Python executable used is
`frontend/node_modules/.cache/integration-tools/backend-env/Scripts/python.exe`.
It is a disposable tool environment; a standard backend `.venv` with project dev
dependencies can run the same commands. Root `.env` still emits the previously
reported malformed-line warnings; its values were not printed or rewritten.

## Exact remaining manual smoke steps

1. Ensure the AWS profile named by root `.env`'s `AWS_PROFILE` exists in the Windows
   environment running Backend. Sign in through your organization's approved AWS
   credentials/SSO process. Verify it can access the configured S3 bucket and DynamoDB
   table. Do not paste credentials into frontend environment variables.
   For an IAM Identity Center profile, use the organization's start URL/region
   with `aws configure sso --profile <profile-name>`, then
   `aws sso login --profile <profile-name>` and verify
   `aws sts get-caller-identity --profile <profile-name>`. See the
   [official AWS CLI SSO setup](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html).
2. Confirm the bucket allows direct PUT from `http://127.0.0.1:5173` (or the exact
   frontend origin) and exposes ETag. Confirm API CORS allows that origin/headers.
3. Run updated Backend on port 8000 and Vite on 5173. Open `/login` and choose
   **Continue in local development**. Production requires real Cognito instead.
4. Select a small nonsensitive XLSX, enter Prompt and Output Header, select a mode.
   Supply Main File for Standardize, Update or Both. Click **Create job and upload
   files** once; verify S3 progress and backend-confirmed uploads.
5. Choose worksheets. Inspect the actual detected header, correct/reload if needed,
   explicitly confirm each header, and select required keys for Update/Both.
6. Click **Save and confirm configuration**. Open the job link and refresh the page;
   verify the saved sheet/header/key values are restored and Start is eligible.
7. Click **Start workflow** once. Verify actual backend status, terminal success or
   failure, and that automatic polling stops. Inspect server logs and request IDs on
   errors; do not retry an uncertain mutation blindly.
8. Repeat all four processing modes. The current worker copies the policy's base
   workbook to a new object; verify original uploads remain unchanged. It does not
   apply AI transformations, add columns or merge matched rows yet.

Day 2 is **implemented for the current demo backend, pending real AWS/browser
verification**. Do not report real E2E or the future AI workflow as complete.
