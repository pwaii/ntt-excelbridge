# Day 2 workbook configuration contract

Implemented 2026-10-17 in this repository after confirming the affected backend
files had no pending implementation changes. The task authorizes minimal backend
support. FastAPI `/openapi.json` is authoritative; frontend types are regenerated
from it. No external endpoint or metadata response was fabricated.

## Endpoints and compatibility

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

## Metadata and selection semantics

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

## Existing demo worker boundary

Start still runs the existing synchronous **validation/copy demo**, not the future
AI/review pipeline. It writes and reopens an actual new S3 workbook and updates
actual status; success is not simulated. The output base now follows ADR D2:
current for Neither/Standardize, main for Update/Both. Original objects are preserved,
and source/input hashes remain distinct in the audit manifest.

**No quality fixes, new output column, standardization mappings or matched-row
updates are applied by this demo worker.** Flags/choices are persisted for the
future workflow. UI copy explicitly states this limitation. This task does not
claim completion of Day 3–7 transformation/review functionality.

## Frontend behavior

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
