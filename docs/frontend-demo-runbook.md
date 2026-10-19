# Frontend demonstration runbook

Use the existing React/Vite frontend. Implementation and verification status lives
in [SESSION_FRONTEND.md](../SESSION_FRONTEND.md). This runbook covers rehearsal;
it does not certify the deployed backend, AWS, Cognito, or AI workflow.

## Deterministic local rehearsal

From the repository root, after installing the locked frontend dependencies:

```powershell
npm.cmd --prefix frontend run demo:verify
```

This command runs the real React components and controllers under Vitest/jsdom,
with explicitly synthetic backend responses, authentication, S3 and review reports.
It does not upload files, create AWS jobs, call Bedrock or log in to Cognito.
Test-only review sources are injected directly into component tests; production
routes never use those sources. No browser screenshot is produced by this command.

The verbose output walks through these assertions:

1. Create/upload: current and main workbooks are validated, uploads are confirmed,
   backend sheet/header/key metadata is selected, configuration is saved and Start
   is sent once. Refresh recovers saved configuration.
2. Quality: inspect before/after evidence as text, filter and page findings, draft
   accept/reject/edit/ignore decisions, and explicitly confirm submission.
3. Transformation: inspect formula text, referenced columns and backend syntax
   status; inspect all six match badges. Unmatched rows are skipped. Bulk acceptance
   requires scope confirmation, covers filtered pages, preserves existing drafts,
   excludes ambiguous/duplicate/conflict/unmatched groups, and requires separate
   confirmation before submission.
4. Result: published artifacts require an explicit download-link request. Links
   expire, can be regenerated, and are removed on result refresh. No links appear
   for jobs that have not completed or artifacts the backend has not published.
5. Progress: polling backs off and stops at human gates, terminal states or errors.

For all frontend checks:

```powershell
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend test -- --reporter=dot
npm.cmd --prefix frontend run build
```

## Browser rehearsal with the actual backend

Use `frontend/.env.example` to configure public frontend settings privately in
`frontend/.env.local`. Never place AWS secrets in Vite. Local authentication is
restricted to loopback development and must not be enabled for production. Real
Cognito login needs the team's issuer, client, callback and API token-type agreement.

`VITE_S3_DOWNLOAD_ORIGINS` accepts comma-separated exact HTTPS origins and defaults
to `VITE_S3_UPLOAD_ORIGINS` when blank. Add the actual artifact bucket origin if it
differs from the upload origin. Signed URLs and tokens must not be pasted into logs
or screenshots.

```powershell
npm.cmd --prefix frontend run dev -- --host 127.0.0.1
```

Open the printed loopback URL in a browser. Use approved synthetic `.xlsx` files,
including main-file data for Standardize/Update, and run all four mode combinations.

| Step | Expected observation |
| --- | --- |
| Sign in | Real Hosted UI callback restores the intended route; logout removes access. |
| Create | Prompt and output header are required. Main file is required for Standardize/Update. Review output policy. |
| Upload | Create uploads directly to S3. Missing CORS/IAM or upload errors remain visible; Start stays disabled. |
| Configure | Select the sheet, explicitly confirm/correct header row, and select required keys. Save, refresh, verify recovery. |
| Start | Start once. Progress uses the actual returned status/revision. Refresh never replays Start. |
| Quality | Currently shows a report-unavailable message until Backend publishes its report contract. No synthetic rows appear. |
| Transformation | Currently shows a report-unavailable message until Backend publishes its report contract. No synthetic formulas/matches appear. |
| Result | For the current validation/copy demo, COMPLETED exposes only published output/manifest/report artifact types. Generate a fresh link, download, reopen the workbook, verify original uploads remain unchanged. |
| Expiry/error | Let a link expire and regenerate it. Exercise 401/403/404, network loss and 409 on a review-enabled backend. No mutation auto-retry. |

Once Backend publishes and implements report/gate support, regenerate API types,
implement the concrete normalized report source and inject it in the review routes.
Then verify review persistence/reload, wrong/stale gate rejection, the next short
execution segment, standardization before update matching, and final output evidence.
Formula edits remain unavailable until Backend offers syntax revalidation for edits.

The current job/download contracts do not supply authoritative applied-row counts,
formula syntax results, change-report JSON or review-summary Markdown artifacts.
Do not label the current copy worker as the full AI workflow.

## Visual and keyboard pass

Check desktop and a narrow mobile viewport. Capture screenshots of creation,
progress, both reviews and results using approved synthetic data after the report
source is connected. Check keyboard navigation, visible focus, Escape on the mobile
menu, error messages, empty reports and long workbook/cell values. Page navigation
and the details panel must reach every item in the windowed table.

Check text beginning with `=`, `+`, `-`, `@` and HTML-looking text: it must stay text
without executing a formula or HTML. The browser never escapes or rewrites the
downloaded XLSX. Backend owns formula/data classification and export escaping.

Record real environment results in the frontend session log with date, environment,
mode and observed evidence. Leave unrun checks explicitly pending.
