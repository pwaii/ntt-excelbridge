# Day 1 quality audit — 2026-10-16

**Verdict: Ready with documented blockers.** The Day 1 frontend passes its automated
checks and is prepared for integration. This does not certify real authentication,
uploads, metadata inspection, job execution, or downloads.

Scope: Tasks 1–5 and the final Task 6 review. Sources: `docs/design.md`,
`docs/frontend-plan.md`, and Accepted ADR 0001 (2026-10-16), which takes precedence.
`xlsx-data-workflow-demo-plan.md` is not present. The explicit Tasks 3/4/6 requirement
for a required Output Header takes precedence over the older optional-header wording.

## 1. Day 1 requirements completed

- React/Vite, strict TypeScript, Tailwind, `@/` imports, and reusable components.
- Six requested routes plus root redirect and unknown-route handling. Client-side
  navigation, active states, page titles, main-content focus, and mobile navigation.
- Sign-in, progress, reviews, and results remain honest placeholders with no fake
  authentication, jobs, results, or downloads.
- Real local `File` selection, drag/drop, replace/remove, filename/size feedback,
  required Prompt (formerly Comment Name) and Output Header, both processing toggles,
  conditional main workbook, policy summary, reset, and frontend-only preview.
- RHF/Zod validation, accessible labels/error associations, disabled invalid actions,
  prepared loading presentation, and empty/pending metadata states.
- Temporary frontend view models and isolated deterministic mocks. No generated API
  contract is claimed and no review screens beyond placeholders were implemented.

## 2. ADR compliance by decision

| Decision | Day 1 result and evidence |
| --- | --- |
| D1 | Browser size ceiling is 25 × 1,024² = 26,214,400 bytes; exact boundary passes, above fails for either workbook. Approximately 2,000 rows is guidance; 2,001–50,000 warn only with supplied metadata; above 50,000 blocks readiness. No workbook parser or fabricated counts. Tests: validation and ADR components. |
| D2 | Neither/standardize output is current-derived; update/both produce a new main-derived workbook and preserve original uploads. Expected artifacts have no fake URLs. Tests: validation, creation, workflow models. |
| D3 | No task tokens or paused-execution assumption. Models/docs reserve status reconstruction and next-segment execution for BE. Future reload behavior is specified, not implemented. |
| D4 | Pattern rules contain examples/counts; mocks create one proposal per value pattern, not each affected cell. Tests: workflow models. |
| D5 | `CellContent` carries data/approved-formula origin. `CellText` renders React text for `=`, `+`, `-`, `@`, and HTML-looking strings. No prefix-based approval, HTML injection, browser evaluation, or frontend export. Tests: ADR components and creation. |
| D6 | Match models display backend candidates; no blocking/fuzzy/top-5 algorithm runs in FE. Static import/source audit confirms this remains an interface. |
| D7 | Update/both explicitly skip and report unmatched rows; no automatic insertion. Tests: policy semantics and match guidance. |
| D8 | Pending submission retains the authoritative server revision. Conflict UI requires reload for 409 `REVIEW_REVISION_CONFLICT`; no local increment or Step Functions calls. Tests: workflow models. Actual refetch awaits integration. |
| D9 | Only proposed/human accepted/human edited/human rejected states. High-confidence exact and ambiguous fixtures stay proposed. Confidence may support sorting and future explicit human bulk approval, never authorization. |
| D10 | Missing metadata is explicit. Header supports detection, correction, and confirmation within rows 1–20. Version, sheet, or detected-header changes invalidate confirmation. Real start requires reliable metadata, workbook/sheet identity, confirmed headers, and server prerequisites. Tests: validation, ADR components, workflow models. |

## 3. Bugs found and fixed

1. Removing a selected file removed the focused button. Restore focus to Browse
   for the relevant workbook after removal.
2. Rejected replacement errors were described by an untabbable input but not the
   keyboard-accessible Replace action. Associate hint/error text with Replace and Remove.
3. Narrow action rows risked crowding two nonwrapping buttons. Stack actions below
   the `sm` breakpoint; preserve the desktop row. This is a code-level improvement,
   with actual mobile overflow still awaiting browser verification.
4. The textarea suppressed its own outline and relied on a faint composer shadow.
   Add an explicit high-contrast composer outline for keyboard focus.
5. Real-start readiness could accept a confirmation bound to blank version/sheet
   values. Reject such confirmations and add a readiness blocker.
6. Standardize-only policy omitted the requested output column. Include it, subject
   to approval, in the existing description.
7. No ESLint setup existed. Add a minimal flat config and lint script. The initial
   lockfile also lacked dependencies already declared by Tasks 1–5; synchronize it.
   A clean-install dry run then exposed missing transitive AJV entries after installing
   lint tools. Regenerating the lockfile resolved that check.

## 4. Files modified or created in Task 6

- `package.json`, `package-lock.json`: lint tooling/script and synchronized lock.
- `eslint.config.mjs`: new recommended JavaScript/TypeScript rules.
- `src/components/job/workbook-file-picker.tsx`: focus restoration and error descriptions.
- `src/components/job/job-form-actions.tsx`: narrow-screen action stacking.
- `src/index.css`: explicit keyboard focus indicator for the prompt composer.
- `src/lib/workflow-readiness.ts`: reject missing workbook/sheet identity.
- `src/lib/output-policy.ts`: complete standardize-only policy description.
- `src/tests/create-job.test.tsx`, `validation.test.ts`, `routing.test.tsx`: regressions
  and stronger no-network/placeholder assertions.
- `README.md`: lint command and audit link.
- `DAY1-AUDIT.md`: this report.

New dev dependencies: ESLint 10.12.0, `@eslint/js` 10.0.1, and
`typescript-eslint` 8.71.2 (declared with compatible major ranges). No runtime
dependency was added; npm reconciled existing compatible transitive dependencies.

## 5. Tests added

Nine additional cases: seven creation regressions (focus for both file roles,
replacement error associations, forced submit after invalid replacement, multiple
dropped files, whitespace-only header, clearing conditional main errors, full reset)
and two readiness cases for blank workbook version/sheet identity. Existing routing
cases additionally assert no fetch and honest placeholders.

Existing coverage retains all four output modes, required main-file combinations,
size boundaries, invalid extensions, whitespace input, metadata/header invalidation,
formula/data text safety, pending/conflict states, and loading presentation.
Files are actual browser `File` objects in jsdom; boundary tests override only their
size property instead of allocating or parsing entire workbooks.

## 6. Test results

`npm.cmd test -- --reporter=dot`: **92 passed, 0 failed**, five files:

| Suite | Passed |
| --- | ---: |
| Creation | 23 |
| Validation/readiness/policies | 32 |
| ADR components | 12 |
| Routing/navigation | 13 |
| Workflow models/fixtures | 12 |

These are unit/component tests in jsdom, not browser E2E tests. The browser inventory
returned no apps/browsers, and no Playwright/E2E configuration exists. No visual
desktop/mobile inspection, real Tab traversal, screen-reader run, or browser smoke
test is claimed. Do a manual/browser pass when a browser is available.

## 7. Build, lint, and other verification

| Executed command/check | Result |
| --- | --- |
| `npm.cmd run typecheck` (also invoked by build) | Passed, strict TypeScript |
| `npm.cmd run lint` | Passed, ESLint 10, zero errors/warnings |
| `npm.cmd test -- --reporter=dot` | Passed, 92 tests |
| `npm.cmd run build` | Passed, Vite production build |
| `npm.cmd run dev -- --host 127.0.0.1 --port 5179 --strictPort` | Started successfully; HTTP request to `/jobs/new` returned 200; server stopped after checking |
| `npm.cmd ci --dry-run --offline --ignore-scripts --no-audit --no-fund --cache ./node_modules/.cache/npm --update-notifier=false` | Final attempt passed after lock regeneration; no fresh clean install was performed |
| Node local-import/source audit | 43 TS/TSX files, no circular local imports; application entry graph excludes mocks/legacy API/features, HTML injection, eval, task tokens, fake session storage, and fetch calls |
| `git diff --check -- .` from `frontend/` | Passed; Git emitted only an existing line-ending notice |

Initial installation attempts hit registry/cache permissions; installation succeeded
with network escalation and a cache inside ignored `node_modules/`. Initial ESLint 9
was replaced with supported ESLint 10, compatible with the installed TS ESLint and
Node 22.18. The final versions above passed lint. Initial clean-install dry-run
failure was corrected; offline lock regeneration lacked an optional package cache,
so online lock-only regeneration was used before the successful dry run.

Nonblocking diagnostics: existing React Router v7 future-flag notices in tests and
Zod/Rollup annotation notices during build. No failing assertions or build errors.

## 8. Remaining issues

- Git already has unresolved index entries for `src/app/App.tsx` and
  `../backend/app/domain/schemas.py`. App's working-tree file has no conflict markers
  and compiles using the Day 1 router; its index is still unmerged. Backend retains
  its original conflict markers. Root diff checking fails on that backend conflict.
  No staging, conflict resolution in backend, commit, or push was performed here.
- Browser-based responsive, overflow, keyboard, and screen-reader verification is
  outstanding. CSS/layout review and jsdom tests do not establish those results.
- Published OpenAPI is unavailable. New models are temporary UI models, and the
  older unrouted API client is not certified for Day 2 use. Its payloads remain unchanged.

## 9. Backend dependencies for Day 2

- Published/versioned OpenAPI, authenticated ownership rules, and confirmed
  `prompt` vs `comment_name`/required-header configuration semantics.
- Verified immutable uploads, file version/sheet/column metadata, reliable row
  counts/header detection, and persistence of user header/key/sheet choices.
- Agreement on MB units, 50k rejection, and top-issues-only metadata.
- Authoritative job start/status/reload contracts; revision token/error envelope
  and conditional review submission; server-owned next-execution startup.
- Validated pattern rules, candidate references, human-review statuses, cell-origin
  approval provenance, artifact bases/availability, and real download URL lifecycle.

See `src/api/README.md` for the detailed contract questions. No Day 2 APIs, Cognito,
S3 operations, AWS services, matching algorithms, exports, or review screens were added.

## 10. Final readiness verdict

**Ready with documented blockers.** Day 1 automated acceptance checks pass and the
frontend can proceed to Day 2 work. Before claiming a clean handoff, resolve the
existing Git index conflicts through the repository owner's normal merge process,
complete browser QA, and obtain BE contracts/metadata. Real Start remains unavailable;
a valid form enables only the explicitly labeled local preview.
