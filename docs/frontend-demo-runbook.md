# Frontend demonstration and acceptance runbook

Implementation and environment status lives in [SESSION_FRONTEND.md](../SESSION_FRONTEND.md).
This runbook distinguishes synthetic local checks from deployed acceptance.

## Deterministic local rehearsal

After installing the locked frontend dependencies, run from the repository root:

```powershell
npm.cmd --prefix frontend run demo:verify
```

This runs 41 React/controller/adapter assertions across 6 files with synthetic
external boundaries. It covers creation/configuration, review evidence and decisions,
complete pagination at one revision, bulk confirmation, final-gate polling, explicit
processing retry, result links, expiry and refresh. Production routes use the actual
backend review-report source; test fixtures are never injected into application routes.
This command does not log in to Cognito, call Bedrock or upload to real S3.

The backend integration suite runs real FastAPI routes and workbook workers with
synthetic AWS/Step Functions/Bedrock boundaries. It opens actual generated XLSX
outputs for all four modes, including confirmed header rows, two review gates,
standardization, updated/skipped matches, approved formulas, source preservation,
audit/summary downloads, stale revisions and recovery from continuation failure.

```powershell
python -m pytest backend/app/tests -q
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend test -- --reporter=dot
npm.cmd --prefix frontend run build
```

Use the project's Python environment with `backend[dev]` installed. The disposable
Python path recorded in the session log is an environment convenience, not a repository
dependency. The standalone frontend tests and backend tests do not certify real AWS.

## Local services

```powershell
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
npm.cmd --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Configure backend values privately in root `.env` and public frontend values in
`frontend/.env.local`, following the example files. Existing private files must not
be overwritten with examples. Do not put AWS credentials, passwords or JWTs in Vite.
Local fallback only permits loopback development; it is not a real Cognito login.
Without STATE_MACHINE_ARN, the backend's local Start path is copy mode and does not
run the full reviewed AI workflow. HTTP /health success does not prove AWS access.

## Deployed acceptance

Deploy the integrated backend using [deployment instructions](backend-deployment.md)
and approved AWS access. The SAM template now configures the OAuth code client,
Hosted UI domain and API auth. Match FrontendOrigin to the exact origin where the
browser is opened; it determines `/auth/callback` and `/login` URLs. Use a Linux
compatible SAM build for the cryptography dependency (for example SAM's container build).

Map actual stack outputs to public frontend configuration:

| Backend output / setting | Frontend setting |
| --- | --- |
| ApiUrl | VITE_API_BASE_URL |
| CognitoAuthority | VITE_COGNITO_AUTHORITY |
| CognitoHostedUi | VITE_COGNITO_DOMAIN |
| UserPoolClientId | VITE_COGNITO_CLIENT_ID |
| FrontendOrigin + /auth/callback | VITE_COGNITO_REDIRECT_URI |
| FrontendOrigin + /login | VITE_COGNITO_LOGOUT_URI |
| COGNITO_API_TOKEN_TYPE=access | VITE_COGNITO_API_TOKEN_TYPE=access |
| Actual bucket HTTPS origin | VITE_S3_UPLOAD_ORIGINS |

VITE_S3_DOWNLOAD_ORIGINS defaults to upload origins when blank. Set the exact artifact
bucket HTTPS origin separately if it differs. Restart Vite after configuration changes.
Use an existing approved test account for actual login. Do not place signed URLs or
tokens in screenshots or logs. No user accounts or cloud resources were created by
this local implementation session.

Run Neither, Standardize-only, Update-only and Both against actual services:

| Step | Required evidence |
| --- | --- |
| Login | Hosted UI callback restores intended route; expiry/refresh and logout work; unauthorized API access returns 401. |
| Create/upload | Main is required for Standardize/Update; browser uploads directly to S3; errors keep Start disabled. |
| Configure | Choose sheet, explicitly confirm/correct header row and choose keys; save and refresh; saved selections recover. |
| Start | Start once; actual status/revision load; refresh never replays Start. |
| Quality | Actual paginated report loads all required IDs at one revision. Inspect evidence, decide and submit with confirmation. |
| Persistence | Refresh the review; human decisions reload, including ignored-with-reason. A stale tab gets 409 and must reconcile. |
| Transformation | Wait for final TRANSFORMATION_REVIEW_PENDING. Inspect formula/reference syntax, mappings and six match badges. Ambiguous targets require explicit supplied-row selection. |
| Bulk | Verify exact filtered scope and threshold; existing drafts are preserved; ambiguous/duplicate/conflict/unmatched groups are excluded. Submission needs separate confirmation. |
| Continuation | Review acknowledgement and actual next-segment status are checked separately. A failed continuation records approval and permits processing retry without resubmitting it. |
| Result | Output, audit JSON, review summary Markdown and validation downloads match published keys. Open the actual XLSX, inspect changes/formulas and verify original uploads remain unchanged. |
| Counts | Compare updated/skipped row counts and rejected decision counts with the actual audit. No inserted rows for unmatched current records. Syntax verification is not calculation. |
| Failure/expiry | Exercise network errors, 401/403/404/409 and expired links. Generate new links explicitly; no automatic mutation retry. |

Formula edits require a future backend revalidation contract and remain disabled.
A formula whose references do not match the output workbook cannot be accepted.
Blank-column findings currently provide information only; no unsupported column
deletion is offered. Record any remaining worker-policy limitations from real rehearsal
before marking deployed acceptance complete.

## Visual and keyboard acceptance

Check desktop and a narrow mobile viewport using approved synthetic files. Capture
creation, progress, both reviews and result. Verify no horizontal clipping outside
scrollable tables; mobile menu Escape/focus, keyboard row navigation, errors, empty
reports, long values and every item in the windowed/paginated table are reachable.

Text beginning with `=`, `+`, `-`, `@` and HTML-looking text must remain text without
executing formulas or HTML. The frontend never rewrites the downloaded XLSX; backend
owns formula/data classification and export behavior.

Record date, environment, mode and observed evidence in the frontend session log.
Keep Cognito/AWS/browser checks pending until actually performed.
