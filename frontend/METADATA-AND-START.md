# Task 10 — Metadata selection and workflow start

Update: [the latest integration work](INTEGRATION.md) obtains actual OpenAPI and
mounts this panel after create/upload. GET supplies real job/file facts, but the
metadata/selection-save contracts remain absent and Start remains disabled.
The Task 10 account below is a historical snapshot.

## Status and backend blockers

The independent frontend flow is implemented. **Day 2 is not end-to-end ready.**
There is no published OpenAPI in the checkout; the default local
`http://127.0.0.1:8000/openapi.json` was unreachable on 2026-10-16. No backend or
AWS service was started, and no real metadata, selection save or Start was tested.

Read-only inspection found a bodyless `/start` handler in `backend/app/api/jobs.py`
that runs the pass-through pipeline. The available job/upload response models do
not publish pre-start sheet/column/header-detection metadata. JobConfig has sheet/key
fields but no confirmed-header fields, and still has the existing prompt/comment_name
merge conflict. No documented post-upload selection-persistence route was found.
The presence of `/start` alone does not satisfy ADR D10.

**Real Start is blocked:** no metadata/save endpoint, payload or successful response
was invented. Tasks 8–9 also still need schema-backed create/upload/confirmation
adapters. Existing source and handwritten types are evidence, not authoritative API
contracts. Backend files and existing index conflicts remain untouched.

## Models and adapter boundary

`src/metadata/types.ts` contains temporary UI models, not BE DTOs. It reuses
`WorkbookMetadata`, `HeaderConfirmation`, `JobFormValues` and `WorkbookRole`.
Shared metadata permits absent counts/guesses instead of requiring fabricated values;
optional columns, header binding and explicit bounds/indexing are adapter-supplied.

`MetadataAdapter.load` must use a documented backend metadata source and map verified
job/upload identities, versions, sizes, sheets/columns/counts, rules, warnings/errors
and authoritative revision/status. No endpoint is assumed and no XLSX is parsed.
After header correction it must obtain columns for that actual header from BE.

`persistSelections` must use a documented contract, save the complete final choices
and configuration, and validate an acknowledgement matching the local selection
fingerprint. It must establish server persistence, not merely echo a local key.
Its revision is server-provided; no local increment occurs. `FinalSelections` carries
local Files as context: do not serialize it directly. A future schema-backed encoder
projects only approved JSON declarations; workbook bytes stay out of API requests.

`start` must use Task 8's JWT transport/exact OpenAPI request and produce a validated,
unambiguous acceptance for the same job with an actual status/request ID. No concrete
HTTP adapter is supplied while contracts are missing. Task 7 configuration and
explicit BE-confirmed token type remain required.

## Selection, header and limit behavior

- No automatic sheet/key selection. Only backend options are accepted; missing,
  nonexistent or ambiguous choices cannot enable Start. Main metadata is required
  for standardize/update/both.
- Sheet change clears header/key. Header editing/correction clears the key and
  invalidates confirmation. Keys cannot use columns bound to another header row.
- Explicit reload passes current choices to the adapter. Reload retains only an
  available sheet name and clears all local header/key confirmations, including
  changed guesses, versions, bounds or columns. It never parses the workbook locally.
- Existing `HeaderRowConfirmation` now supports adapter-provided bounds and explicit
  zero-/one-based indices within design's first 20 rows (0–19 or 1–20). The old Day 1
  design defaults remain compatible, but the new flow blocks Start if BE bounds are
  missing/unsupported. Missing guesses stay missing; nothing is silently confirmed.
- Required/optional/not-applicable/unknown key rules come from BE. Unknown rules
  block Start; no composite key is guessed or auto-approved.
- Backend-confirmed byte size is required and checked against 25 × 1,024² bytes.
  Reliable row counts are required: approximately 2,000 is guidance, 2,001–50,000
  can proceed with warnings, above 50,000 blocks. Missing count is unavailable,
  never zero. Provided backend errors block; warnings/top-issues-only remain visible.

## Start state and UI

`controller.ts`/`readiness.ts` expose unavailable/loading/review/saving/starting/
started/error states. Readiness requires a real matching job/revision, not-started
server state, valid local form, confirmed required uploads/versions/sizes, valid sheets,
confirmed headers, required keys, no blocking BE errors, and persistence/start adapters.

Saving/starting lock edits and double clicks. Start is never called if persistence
fails or its acknowledgement mismatches. Unknown network/timeout/cancellation/protocol
outcomes, 409 and server errors require authoritative reload; no automatic retry.
Reload that proves an already-started job does not resubmit Start. Definitive
validation/auth rejection can be corrected/retried explicitly. Request IDs and safe
error codes are retained without displaying raw SDK/backend exceptions.

`PostUploadConfiguration` shows actual supplied selectors/metadata, honest loading/
empty/error states, header controls, warnings, readiness blockers and distinct stages:
Configure → Create/upload → Review metadata → Confirm headers → Start. It reuses the
existing D2/D7 output policy: current-derived for neither/standardize, NEW main-derived
for update/both; original unchanged, unmatched skipped, both standardizes before matching.
Only a validated Start or reconciled started status navigates to `/jobs/{encoded-id}`.
The existing Job Progress placeholder remains; no polling/timeline/review gate was added.

**The panel is not mounted into production CreateJobPage yet.** The authenticated
Day 1 local preview stays intact. Activating real Start without a verified Task 8/9
job/upload manifest and a documented selection-persistence contract would be false.
Synthetic metadata is confined to tests. No direct Step Functions calls, task tokens,
long-paused execution assumptions or Day 3 review screens were added.

## Exact Day 2 handoff

1. Published OpenAPI and configured environment for create, direct upload, confirmation
   and pre-start metadata (which approved endpoint supplies it?).
2. Exact worksheet/column identifiers, counts, header bounds/indexing, key rules,
   warnings/errors and header-dependent metadata refresh behavior.
3. Documented persistence of final sheet/key/header/configuration choices with a
   verifiable acknowledgement/revision before Start.
4. Exact Start body/response/authorization, acceptance/status mapping, and authoritative
   GET job reconciliation/idempotency after ambiguous Start outcomes.
5. Cognito issuer/client/token type, deployed API/S3/CORS and real upstream integration.

Only after these exist can the real login → create → upload → confirm → metadata →
save selections → Start flow be certified. No real backend verification is claimed.

## Files and tests

Added `src/metadata/{types,readiness,controller}.ts`,
`src/components/job/post-upload-configuration.tsx`,
`src/tests/metadata-fixtures.ts`, `metadata-flow.test.ts`, `post-upload-ui.test.tsx`,
and this document. Updated `types/workbook.ts`, `lib/workflow-readiness.ts`,
`lib/workflow-view-models.ts`, `header-row-confirmation.tsx`, and frontend/API READMEs.
No dependencies, backend changes, staging, commit or push.

Tests use synthetic normalized adapter models, not fabricated official API fixtures.
They cover loading/errors/missing metadata, valid/invalid sheet/key choices, header
guess/correction/reset, both workbooks, stale columns, bounds/indexing, limits and
readiness, persistence acknowledgement, duplicate Start, HTTP failures, timeout
reconciliation, ambiguous responses, policy reuse and Job Progress navigation.
Wire-level Start request tests remain blocked by missing OpenAPI.

Executed on 2026-10-16: `npm.cmd run typecheck` passed; `npm.cmd run lint` passed
with zero warnings; `npm.cmd test -- --reporter=dot` passed **229 tests in 14 files,
0 failed**; `npm.cmd run build` passed; scoped frontend `git diff --check` passed.
Task 10 adds 26 controller/readiness cases and 8 component/navigation cases. Existing
195 tests still pass. Existing Router future-flag/Zod annotation notices remain
nonblocking. These are jsdom/adapter tests, not browser or real-backend certification.
