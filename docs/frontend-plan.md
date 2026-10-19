# Frontend Engineer — Plan

> Role-specific extract of `design.md`. That file is the source of truth; section numbers below (§) point into it for shared detail. Stack: **React + Vite + TypeScript**.
>
> **ADR 0001** (`docs/decisions/0001-design-grilling-decisions.md`): lines marked **⚠️ FIX — Dx** below are superseded. The original is kept so anyone who already built it can see what changed; the corrected version follows the marker.

## Responsibilities

- React/Vite application and route shell.
- Upload and job-configuration flow.
- Progress and the two review screens.
- API client and Cognito integration.
- Browser-level tests and demo polish.

## Pages (§12.1)

1. **Sign in** — Cognito-hosted or embedded Cognito form.
2. **Job creation** — upload current file, prompt, output header, standardize/update checkboxes, main file, sheet/key selectors.
3. **Job progress** — state timeline, counts, errors, refresh/polling.
4. **Quality review** — issue table with filters, row preview, proposal editor, bulk actions.
5. **Transformation review** — mappings, update matches, formula preview, conflict resolution.
6. **Result** — download links, summary counts, audit summary, job metadata.

## Non-negotiable UI safeguards (§12.2)

- Disable **Start** until all required uploads and fields are valid. A **main file is required** when standardize or update is selected — enforce before start (§5.1).
- Display the exact **output policy** (standardize only / update only / both / neither — §6 State 12) before starting.
- Never show an "AI accepted automatically" label. Every proposal renders as one of: `proposed`, `human accepted`, `human edited`, `human rejected` (§5.2, §12.2).
- Ambiguous matches are **never** shown as auto-applied; the user must explicitly accept/reject each ambiguous group or use a clearly-labeled bulk action (§5.3).
- Pagination + virtualized tables for issue/proposal lists.
- Escape cell values in previews; treat strings beginning with `=`, `+`, `-`, `@` as dangerous (formula-injection) when displayed/exported (§12.2, §14.4).
  > **⚠️ FIX — D5:** Char-based escaping is fine for **preview display only**. The final `.xlsx` escaping is **BE's**, driven by a server-side **formula-vs-data cell tag** so approved formulas stay live `=…` — FE must **not** char-escape the downloaded file.
- Poll job status with **exponential backoff** — do not call the API continuously.
- Server is authoritative; local review state is convenience only.

## Review screens — what each must show

**Quality review (§5.2):** summary counts by issue type; affected sheet/row/column/cell coordinates; sample before/after; severity + deterministic reason; LLM proposal + confidence where applicable; Accept / Reject / Edit / Ignore-with-reason actions. Every proposed mutation must carry a review status; nothing applies until the gate is submitted.
> **⚠️ ADD — D9:** Use `confidence` to **sort riskiest-first** and to power a **bulk-approve** of high-confidence items (that's what makes ~2,000 rows reviewable). A bulk action is still a human decision — log it as `human accepted`, never "AI accepted."

**Transformation review (§5.3):** Tool #4 standardization mappings; Tool #5 update matches with **exact / normalized / ambiguous / duplicate / conflict / unmatched** badges; generated formulas + their verification status ("syntax verified", not "calculated"); counts of inserted/updated/skipped/rejected; preview of final output rows.
> **⚠️ FIX — D7:** No **inserted** count for the demo — unmatched rows are **skipped**, not inserted (insert = future work). Show counts of updated / skipped / rejected; render unmatched rows with action "skipped."

**Result (§5.4):** final `.xlsx`, change-report `.json`, review-summary `.md` downloads; status of formula syntax checks.

## API client (§11)

All endpoints require the Cognito JWT; every response has `request_id`. BE publishes OpenAPI — consume it, don't hand-roll types. Endpoints you call:

| Method | Path | Use |
|---|---|---|
| `POST` | `/v1/jobs` | Create job + get presigned upload instructions |
| `POST` | `/v1/jobs/{id}/uploads/complete` | Confirm S3 upload, get file manifest |
| `POST` | `/v1/jobs/{id}/start` | Validate + start workflow |
| `GET` | `/v1/jobs` | List current user's jobs |
| `GET` | `/v1/jobs/{id}` | Status, counts, current gate, artifact links |
| `GET` | `/v1/jobs/{id}/issues` | Paginated quality issues |
| `GET` | `/v1/jobs/{id}/proposals` | Paginated AI proposals |
| `POST` | `/v1/jobs/{id}/reviews` | Submit review revision (accept/reject/edit) |
| `POST` | `/v1/jobs/{id}/cancel` | Cancel if state allows |
| `GET` | `/v1/jobs/{id}/artifacts/{type}` | Short-lived presigned download URL |

**Upload flow:** request presigned URLs from `POST /v1/jobs`, then PUT the file bytes **directly to S3** — never route workbook bytes through the API (§6 State 1).

**Optimistic concurrency:** review submissions include the expected `revision`. A stale browser gets `409 REVIEW_REVISION_CONFLICT` → show a reload prompt and refetch (§11, §6).

## Shared types to define (Day 1)

`Job`, `Issue`, `Proposal`, `ReviewRevision`, `Artifact`. Source these from BE's published schema/OpenAPI once available (handoff: BE Accountable, FE Responsible — §18).

## Day-by-day

- **Day 1** — Vite + React + TS app; route shell + layout; shared types; static job-creation form (current file, prompt, output header, standardize/update toggles, main file).
- **Day 2** — Cognito sign-in (or test-user config); wire form to `POST /v1/jobs`; presigned upload progress for both files; sheet selection after upload metadata returns.
  > **⚠️ ADD — D10:** On that same post-upload screen, add a **header-row confirm**: show the auto-detected header guess and let the user correct it before the job starts (a wrong guess poisons every downstream column/type/prompt).
- **Day 3** — Job-progress screen (state timeline + polling); quality-review table + filters; row/cell preview + Accept/Reject/Edit.
- **Day 4** — Formula review panel (text, referenced columns, syntax status); standardization mapping table + decision controls; loading/error/empty states.
- **Day 5** — Update match table (all six badges); bulk review actions with confirmation; final transformation review summary.
- **Day 6** — Result page + downloads; refresh/reconnect for in-progress jobs; browser validation for formula-injection-looking values; run E2E UI flow against deployed API.
- **Day 7** — Fix rehearsal usability issues; add clear explanations per issue type / review action; package demo runbook with screenshots or a deterministic script.

## Exit criteria to hit

- Config schema rejects missing main file when required (Day 1).
- User can upload → start → wait for inspection → view issues → submit first gate (Day 3).
- Formula proposals validated before display; both standardize + update paths reviewable (Days 4–5).
- Full login→download path works against deployed env (Day 6).

## Handoffs (§18)

- Shared API/domain types: **BE publishes OpenAPI, FE consumes.**
- Upload flow: BE provides presigned-URL contract.
- Review gates: FE renders proposal states; BE enforces transitions.


## Implementation status (2026-10-19)

Frontend screens and independently testable behavior through Day 7 are implemented.
Backend report/gate integration and real Cognito/AWS/browser/deployed E2E acceptance
are still pending; this does not close the backend-dependent exit criteria above.
See [frontend session log](../SESSION_FRONTEND.md) for per-day status and the
[demo runbook](frontend-demo-runbook.md) for deterministic and real-service rehearsal.
