# Frontend foundation

Latest: [Day 2 completion implementation and remaining AWS verification](DAY2-COMPLETION.md)
now adds metadata/configuration/Start and polling, and removes Preview Configuration.
Earlier Task 8–11 notes below are historical snapshots.

Current integration status: [real OpenAPI generation, connected create/upload/confirm/status, and remaining blockers](INTEGRATION.md).
Local development currently uses the explicitly enabled backend fallback:
open `/login` and select **Continue in local development**. This is not Cognito
authentication and is disabled in production. See the integration document for
switching back to Cognito.
This supersedes the earlier Task 8–11 statements below about an unavailable schema
and unmounted upload flow. Real Cognito/AWS end-to-end verification is still pending.

Final Day 1 review: [audit results, ADR checks, and Day 2 blockers](DAY1-AUDIT.md).
Day 2 final QA: [integration status, verification results and readiness verdict](DAY2-AUDIT.md).

Terminology: **Prompt** is only the display label. The creation form, validation,
and adapter configuration use `comment_name`, matching the existing Git API field.
This naming alignment does not connect the pending API adapters or change backend code.

React 18, Vite, strict TypeScript, React Router, and React Query reuse the original scaffold.
Job creation supports local XLSX file selection, configuration, and an output-policy
preview. Task 7 adds Cognito Hosted UI authentication and protected job routes.
Server uploads, job APIs, and business workflows are not connected.
See [authentication configuration and blockers](AUTHENTICATION.md).
Task 8 adds a contract-independent authenticated transport and in-memory Create Job
boundary. [OpenAPI/create integration status](src/api/README.md): published schema
is unavailable, so the existing form still performs only local preview.
Task 9 prepares [raw XHR uploads, verification state and progress UI](UPLOADS.md)
behind the same contract boundary; real S3/confirmation integration remains blocked.
Task 10 prepares [metadata selections and safe workflow Start](METADATA-AND-START.md)
behind adapters; production Start remains blocked by metadata/persistence contracts.

## Development

Requires Node.js 22.18+ and npm. Run commands from `frontend/`:

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.
`npm test` uses Vitest with jsdom to check routes, navigation, file selection,
configuration, progressive disclosure, and local previews. `npm run lint` uses ESLint
with the recommended JavaScript/TypeScript rules, including unused variables and
explicit `any` checks. Generated output and dependencies are excluded.

## Structure

| Directory | Responsibility |
| --- | --- |
| `src/app` | Application composition |
| `src/components/layout` | Shared application layout |
| `src/components/ui` | Locally owned shadcn/ui-style primitives |
| `src/components/job` | Workbook selection, header confirmation, limits notices, form actions |
| `src/pages` | Route-level screens |
| `src/routes` | Route configuration |
| `src/schemas` | Zod workbook and job-configuration validation |
| `src/types` | Shared domain types from the existing scaffold |
| `src/lib` | Utilities, including `cn()` for merging classes |
| `src/mocks` | Future explicitly labeled fixtures |
| `src/features` | Preserved legacy upload feature; not routed by this local-only UI |
| `src/api` | Existing API client; not called by CreateJobPage |

Use `@/` to import from `src/`. Both Vite and TypeScript resolve this alias.
Vite configuration is included in TypeScript checks.

## Styling and UI

Tailwind CSS v4 uses `@tailwindcss/vite` and `@import "tailwindcss"` in
`src/index.css`; no v3 PostCSS or JavaScript Tailwind configuration is needed.
CSS variables define semantic theme tokens and `@theme inline` exposes Tailwind
utilities. The workspace palette is inspired by the supplied Digital Innovation
Challenge poster: navy text, cyan `#8DD3E7`, violet `#B7A0FF`, and warm review
accents on light off-white and white surfaces. Cyan-to-violet gradient actions and composer outlines emphasize the
centered creation form. The Segoe UI/Inter font stack uses local fallbacks;
no external font request is made. Transitions respect reduced-motion preferences.

`components.json` configures shadcn/ui aliases and Tailwind v4. The local Button
uses Radix Slot, CVA, and `cn()`; add other primitives only as features need them.
React Hook Form, Zod, and `@hookform/resolvers` validate the existing creation form.

Routes are `/login`, `/jobs/new`, `/jobs/:id`, `/jobs/:id/quality-review`,
`/jobs/:id/transformation-review`, and `/jobs/:id/result`. `/` redirects to `/login`.
Named page components live in `src/pages`. Job creation uses React Hook Form and reusable
components in `src/components/job`; `src/lib/output-policy.ts` contains the four policies
from design section 6 State 12. The field is named Prompt, following the project terminology.
Create workflow uses a centered form capped at 820px. The page has no static workflow
canvas or setup-step navigation. The duplicate desktop breadcrumb header is hidden only
on this route; the sidebar, sign-in access, and mobile navigation stay available.
Prompt example chips populate the real input and focus the composer. The output header
is now required and shown directly below the prompt. Disabled sheet/key selectors and
pending header confirmation remain under Advanced settings. A master file
appears only when processing needs one. The expandable Output policy row preserves all
four policies and the approval/source-preservation requirements. Actions stay in normal
document flow, without overlays. Empty prompts show a required message after blur;
example chips clear validation errors. Preview configuration shows only a local confirmation,
with no job creation, workbook analysis, or network requests. The actions component accepts
an `isLoading` prop for future integration; no simulated loading occurs.

A real workbook data preview is a future enhancement: this frontend has no XLSX parser,
connected metadata source, or actual row-preview data. No parser dependency, backend endpoint,
or fabricated sheets/rows were added. Execution timelines belong on Job Progress when real
workflow states are connected; that page is unchanged by this refinement.

## Task 5 / temporary view models and fixtures

Backend owns the API contract. No published OpenAPI file or schema URL was found;
the backend's existing schema merge conflict prevents treating its source as a
usable published schema. No API types were generated. See
[API ownership and contract questions](src/api/README.md) for the handoff checklist.

- `src/api/legacy-types.ts` isolates pre-existing handwritten client assumptions.
  The client imports them explicitly; `types/index.ts` retains compatibility exports.
- `src/types/review.ts` is the single source for existing display vocabulary and
  adds server-owned revision tokens, pending drafts, and conflict/reload states.
- `src/types/workflow.ts` defines temporary Job, Issue, Proposal, job configuration,
  workbook selection, pattern-rule, match, and Artifact view models. Configuration
  reuses the Zod-inferred form fields instead of redefining validation types.
- `src/types/workbook.ts` adds pending/detected/selected/confirmed header state;
  `src/types/cell-content.ts` retains origin-tagged content and exports `CellOrigin`.
- `src/types/workflow-readiness.ts` shares the existing local-vs-server readiness
  model. `src/lib/workflow-readiness.ts` uses it without changing the page's behavior.
- `src/lib/workflow-view-models.ts` derives header display state, expected artifact
  bases, and match guidance. These helpers do not detect headers, match rows, approve
  changes, write files, generate URLs, or start workflow executions.
- `src/mocks/workflow-fixtures.ts` holds a handful of explicitly synthetic examples:
  four review statuses, pattern rules with examples/counts, all six match labels,
  both cell origins, pending submission, and revision conflict. Fixtures are only
  imported by tests, never by routes or production application code.
- `src/tests/workflow-models.test.ts` checks the new state transitions and fixtures;
  the existing routing, file validation, and safe-text rendering tests are retained.

ADR safeguards: D1 limits are unchanged; D2 artifact bases are current-derived for
neither/standardize-only and main-derived for update/both; D3/D8 revision ownership
and next-execution startup remain server-side, with 409 requiring refetch/reload;
D4 rules are pattern-level, not per-cell; D5 never infers approval from `=` and
keeps Excel escaping backend-owned; D6 candidate generation stays backend-owned;
D7 unmatched rows are skipped/reported; D9 confidence cannot confer approval and
future bulk approval requires an explicit human action; D10 changes to the backend
header guess invalidate existing confirmation. No fake workbook metadata is passed
to application pages. A reopened browser must reconstruct status and revisions
from backend responses once integration exists, not from mock or optimistic state.

All new view models are provisional UI representations. Exact wire fields/enums,
metadata/confirmation persistence, revision token format/error envelope, and
artifact availability must be confirmed against BE OpenAPI. No additional
dependencies, backend edits, authentication, API calls, or review screens were added.

## Task 4 / ADR 0001

The accepted [ADR 0001](../docs/decisions/0001-design-grilling-decisions.md) overrides older
design wording. Prompt is the local UI name for the brief's Comment Name; existing API
payloads and the legacy client are unchanged.

- **D1:** `src/lib/workbook-limits.ts` centralizes the 25 MB browser ceiling as
  **25 × 1,024² = 26,214,400 bytes**, preserving the existing convention. ADR/design
  do not define MB units; align this with backend enforcement before integration.
  Real `File` objects, case-insensitive `.xlsx`, and this size limit are checked for
  both workbooks. Normal working size is approximately 2,000 data rows; 2,001–50,000
  are supported with a metadata-backed warning, not rejected. Above 50,000 is blocked
  by readiness checks. No row counts are inferred from bytes or filenames.
- **D2/D7:** standardize/neither are current-derived; update/both produce a **new**
  main-derived file. Both standardizes before matching. The original main remains
  unchanged; unmatched current rows are skipped and reported, never auto-inserted.
- **D10:** `HeaderRowConfirmation` supports detected rows, correction within the
  design's first 20 rows, and explicit confirmation. Confirmations bind to a backend
  workbook version, sheet, and metadata key; replacement/edit invalidates readiness.
  `getWorkflowReadiness` separates local preview validity from real-job readiness.
  Backend prerequisites and required header confirmations must all succeed first.
  Day 1 supplies no metadata and never enables a real workflow start.
- **D5:** `CellContent` distinguishes `data` from `approved-formula` with an approval
  reference. Only validated backend review data may supply approved origin. `CellText`
  renders either origin as React text, without HTML injection, evaluation, inference
  from `=`, or blanket escaping. Final XLSX escaping/writing stays backend-owned.

Rejected file replacements retain other valid inputs and the previous file, but disable
preview until the selection error is corrected. Removing a file revalidates immediately.
Schema parsing trims required text only; it does not interpret formula-looking input.

Day 2 dependencies: verified uploads; a validated metadata adapter bound to the selected
file version/sheet; actual row counts and header detection; confirmation persistence;
server-side checks and a start contract. `LargeFileWarning` and header-confirmation
components are prepared and tested; no sample metadata is wired into the page.

Desktop sidebar and collapsible mobile navigation share the same links. Job links
appear only when the current route contains a job ID; no sample job is invented.
Unknown URLs have a not-found page. Static hosting must
rewrite non-asset requests to `index.html` for BrowserRouter deep links.

Setup references: [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite)
and [shadcn/ui manual installation](https://ui.shadcn.com/docs/installation/manual).
