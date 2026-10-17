# Task 11 — Day 2 integration verification

Historical QA snapshot. Subsequent work resolves the schema conflict, obtains
actual OpenAPI, generates types and connects create/upload/confirm/status. See
[current integration status](INTEGRATION.md) for the latest remaining blockers.

Audit date: 2026-10-16. Sources: `docs/design.md` (notably 5.1, State 12,
12.1–12.2), accepted ADR 0001, and `docs/frontend-plan.md`. ADR overrides
conflicting older design wording. This is a frontend audit, not AWS certification.

## 1. Completed requirements and full-flow audit

The existing React/Vite/strict TypeScript foundation and Day 1 behavior are preserved.
The application entry graph mounts authentication, protected routes and the local
creation form. Independent Day 2 controllers and panels exist, but their presence
does not mean the application runs the integrated workflow.

| User-flow steps | Current implementation and verification |
| --- | --- |
| 1–2: open app, redirect unauthenticated users | Route/provider component tests pass; local `/login` HTTP response is 200. HTTP success alone does not verify rendered UI. |
| 3: Cognito authentication | Hosted UI adapter exists; provider/SDK-boundary mocks pass. Real authentication is unverified and configuration is missing. |
| 4–10: configuration | File selection, Prompt, required Output Header, independent flags, conditional required Main File and all four output policies are implemented and component-tested under a mocked authenticated context. |
| 11–12: create job and receive instructions | Local controller and authenticated JSON transport are tested independently. No schema-backed adapter, generated types or production form connection exists. |
| 13: direct S3 upload | Raw File/XHR uploader and progress panel are tested at mocked boundaries; not mounted into the application flow. |
| 14: backend confirmation | Coordinator distinguishes transfer completion from backend verification. Concrete confirmation adapter remains missing. |
| 15–18: metadata, sheets, headers, keys | Prepared controller/panel support backend-supplied metadata and explicit confirmation; synthetic adapter tests pass. No real metadata source or production connection exists. |
| 19–20: Start and navigation | Independent tests verify persistence before Start, acceptance validation, duplicate prevention and navigation. No concrete Start adapter or application connection exists. |
| 21: read actual job status | Not implemented; JobProgressPage remains an honest placeholder. A minimal authoritative status/reconciliation connection is still needed; full timeline/polling belongs to Day 3. |

The visible valid-form action remains **Preview configuration**. It explicitly
does not create, upload or start a job. No fake authenticated session or successful
backend response was added to make the flow appear complete.

## 2. Files changed in Task 11

- `src/auth/cognito-adapter.ts`: reject token retrieval immediately after logout begins.
- `src/tests/cognito-adapter.test.ts`: logout-cleanup race regression and fresh-session reauthentication coverage.
- `src/tests/upload-workflow.test.ts`: recreated controllers cannot claim previous upload/confirmation success.
- `src/tests/metadata-flow.test.ts`: fresh controllers reconcile an already-started job without replaying Start.
- `DAY2-AUDIT.md`: this report.
- `README.md`: link to this report.

No new dependencies, backend changes, redesign, staging, commit or push.
Pre-existing changes and Git index conflicts were preserved.

## 3. Authentication status and bug fixed

The existing `oidc-client-ts` adapter uses Authorization Code + PKCE, SDK state
validation, in-memory user/token storage, and sessionStorage for transient OAuth
state. Protected job routes require resolved authentication. Login/callback/loading/
failure/expiry/logout behavior is covered by mocks; no production bypass exists.
API token retrieval requires an explicitly configured backend token type, not an
assumption that access and ID tokens are interchangeable.

QA reproduced a race: while asynchronous `removeUser()` was pending during logout,
calling the adapter directly could still return the old token. AuthProvider already
guarded its own callers, but the adapter did not. The regression test failed before
the fix and now passes: the adapter's synchronous signed-out flag rejects retrieval
before accessing SDK storage. Existing in-flight generation guards remain intact.

Real Cognito login/refresh/logout has **not** been tested. Only `.env.example` was
found in the frontend; no VITE variables were present in the executing shell.
Required public configuration is `VITE_API_BASE_URL`, `VITE_COGNITO_AUTHORITY`,
`VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID` (existing APP_CLIENT_ID alias supported),
`VITE_COGNITO_REDIRECT_URI`, `VITE_COGNITO_LOGOUT_URI`, and a backend-confirmed
`VITE_COGNITO_API_TOKEN_TYPE` (`access` or `id`). Scopes default to `openid profile email`.
Callback/logout URLs must be allowlisted on a public Cognito SPA client with no secret.

The infrastructure template still lists Cognito/HttpApi JWT authorizer as TODO.
`backend/app/auth.py` consumes upstream authorizer claims but does not establish
which token type a deployed authorizer requires. Deployment configuration must
resolve that question; no credentials or JWTs were invented.

## 4. OpenAPI generation status

**Blocked, not generated.** No published OpenAPI JSON/YAML was found in the checkout.
The read-only probe of `http://127.0.0.1:8000/openapi.json` could not connect.
No backend was started. The existing `backend/app/domain/schemas.py` conflict
contains competing `comment_name`/`prompt` definitions and remains untouched.
Its source cannot substitute for an available authoritative published schema.

`src/api/generated/` contains documentation only. Legacy handwritten types and
new normalized UI/adapter models are clearly provisional, not generated API DTOs.
Tests use toy transport responses and synthetic internal adapter models; they are
**not contract-accurate endpoint integration fixtures**. Generation and wire-level
endpoint tests remain outstanding until Backend publishes a versioned contract.

## 5. Create Job integration status

The local controller validates configuration, retains original Files, prevents
duplicate creation, and blocks blind retry after ambiguous POST outcomes. JSON
transport covers authentication, safe diagnostics, timeouts, cancellation and
decoder validation. Production `POST /v1/jobs` is **not connected or verified**.
Required work after contract publication: generate types, map approved JSON fields,
validate actual responses, provide the concrete adapter and connect the existing form.

## 6. Direct S3 upload status

The independent uploader sends raw File bytes to an explicitly approved HTTPS
origin using the supplied PUT URL/headers. It rejects backend destinations and
Authorization/Cookie headers, sets `withCredentials=false`, and reports native XHR
progress. No workbook bytes are sent through the new JSON API transport. Tests
cover rejection, known expiry, timeout, cancellation, progress and bounded retries.

Real upload, bucket policy, URL signature and browser preflight are **unverified**.
The template declares PUT/GET/HEAD CORS and exposes ETag, but deployed configuration
is unknown. Browser network errors cannot conclusively distinguish CORS from other
network failures. XHR redirect limitations are documented in `UPLOADS.md`; correctly
scoped regional upload URLs remain a backend/deployment requirement.

## 7. Upload confirmation status

Transfer success remains `awaiting-confirmation` until a validated adapter result.
Partial success survives an ordinary retry in memory. Failed confirmation does
not recreate jobs or re-upload successful files. Duplicate and unsafe retries are
blocked. Concrete backend confirmation/manifest validation remains **unconnected**.

## 8. Metadata and header confirmation status

The prepared panel accepts supplied metadata only; it never inspects XLSX locally
or invents sheets/counts/keys. Start requires verified upload identities, sizes,
row counts, valid sheet/key choices, header bounds and explicit confirmation.
Changing sheet/header or reloading metadata invalidates dependent confirmations.

No documented metadata endpoint/response or final header-selection persistence
contract is available. Header-dependent column refresh and confirmed-header fields
must be supplied by Backend before the panel can be integrated.

## 9. Start status and refresh behavior

The adapter-level controller saves final selections before requesting Start, uses
the returned server revision, and requires validated acceptance for the same job.
Ambiguous failures/409 require authoritative reload; no automatic Start replay.
A fresh controller can reconcile an already-started job through its adapter without
starting again. These are synthetic boundary tests, not endpoint verification.

Read-only inspection found a bodyless `/start` pass-through handler, but no contract
for persisting the confirmed headers before it. No real Start request was sent.

Tokens and Files intentionally live in memory. Page reload requires reauthentication
and loses unsent local file selections. Browser File objects cannot be reconstructed
from a job ID. Production server-state resume/reconciliation is not wired, so design
5.1's refresh-without-losing-job-state acceptance criterion is **not yet met**.
The new recreation tests prove fail-closed behavior, not complete page-refresh recovery.

## 10. Tests and UI/security review

Executed from `frontend/` on 2026-10-16:

| Command/check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed; zero warnings |
| `npm.cmd test -- --reporter=dot` | 233 passed, 0 failed; 14 files |
| `npm.cmd run build` | Passed; includes another TypeScript check |
| `git diff --check -- frontend` | Passed; pre-existing line-ending notice |
| HTTP GET `http://127.0.0.1:5173/login` | 200; existing dev server left running |
| GET default local Backend OpenAPI | Unavailable; no usable schema returned |
| Browser smoke / mobile visual QA | Not run: computer-use inventory returned no apps or browsers |
| Deployed AWS integration | Not run: no configured target/authentication |

The deliberately failing logout regression was observed before the fix; final
suite has no failures. Four tests were added (previous total: 229).
Nonblocking React Router future-flag and Zod/Rollup annotation notices remain.

| Requested error case | Automated evidence / remaining limit |
| --- | --- |
| Failed Cognito login; auth expiry; missing JWT | Provider and SDK-boundary tests; transport does not fetch without a valid token. No real Cognito verification. |
| Create validation; backend unavailable | Local validation/controller and generic transport HTTP/network tests. Exact create wire contract unavailable. |
| S3 rejection/CORS/timeout/cancel/URL expiry | Mock XHR/coordinator tests cover rejection, network event, timeout, cancellation and explicit expiry. Actual CORS requires a real browser/bucket. |
| Upload confirmation failure | Coordinator tests preserve successful transfers and block unsafe retries. No real confirmation endpoint test. |
| Missing metadata; invalid sheet/header/key | Readiness/controller/component tests with synthetic normalized metadata. |
| Start validation, duplicate clicks, timeout | Controller tests cover 422, in-flight guards and mandatory reconciliation. No wire-level Start test. |
| Page refresh | Fresh auth/upload/metadata controller tests; production resume is still missing, as described above. |

Code/component review retains labeled controls, keyboard-operable actions, visible
loading/error states, mobile stacking and overflow-conscious containers. Existing
jsdom tests check labels, focus/navigation and state behavior. Actual desktop/mobile
layout, browser focus behavior and deployed deep links are **not visually certified**.
No unrelated visual changes were made.

Scoped source inspection found no new token logging, hardcoded credentials, dynamic
formula evaluation or unsafe HTML preview rendering. Tokens are confined to the
backend transport; S3 transport rejects credential headers. This is source/test
evidence, not an infrastructure security audit. Legacy unrouted code was preserved.

## ADR compliance matrix

| Decision | Frontend finding | Integration qualification |
| --- | --- | --- |
| D1 | Compliant local limits/guidance: ~2,000 rows, 50,000 hard ceiling, no invented counts; file ceiling uses existing 25 × 1,024² bytes. | Backend must confirm MB units and supply trustworthy metadata/counts. |
| D2 | All four policies tested; Update/Both produce NEW main-derived output; original stays unchanged. | Actual output generation is backend-owned and unverified. |
| D3 | No direct Step Functions calls, task tokens or paused-execution dependency. | Backend execution segmentation is outside this frontend audit. |
| D5 | React text previews; no formula evaluation or browser Excel export escaping. | Formula/data tagging and final export escaping remain backend-owned. |
| D7 | Update/Both explain unmatched rows are skipped, not inserted. | Actual backend apply behavior unverified. |
| D8 | No local revision increment; adapter-level conditional-state handoff and conflict reconciliation. | Actual server conditional write cannot be verified; full review concurrency remains later-day work. |
| D9 | No automatic AI acceptance or active review implementation. | Human review/bulk acceptance remains later-day scope. |
| D10 | Explicit header confirmation gates prepared Start flow; changes invalidate stale choices. | Missing backend metadata/persistence and production wiring prevent real-flow certification. |

## 11. Real integration result

**No real Cognito → API → S3 → confirmation → metadata → Start → status flow was
executed.** No authenticated backend mutation, S3 object or workflow execution was
created by Task 11. A passing mocked suite is not evidence of real E2E success.

## 12. Remaining blockers

1. Backend schema merge conflict and unavailable published OpenAPI.
2. Confirmed Cognito issuer/client/domain/callback/logout/scopes and required JWT type;
   a reachable API deployment and JWT authorizer configuration.
3. Exact create/upload/confirmation schemas, signed headers/expiry/slot mapping,
   deployed S3/API CORS and safe reconciliation semantics.
4. Pre-start metadata and header-dependent column contract, final selection persistence,
   authoritative revision and unambiguous Start/status responses.
5. Frontend work after those handoffs: generation, concrete adapters, production
   orchestration/panel wiring and minimal status/refresh reconciliation. Environment
   variables alone will not activate these missing connections.
6. An available browser and configured test environment for real responsive/E2E QA.

## 13. Day 3 prerequisites

Publish/resolve the above contracts and environment; finish the remaining Day 2
frontend connections; then run one small non-sensitive real XLSX flow through
confirmed Start and authoritative status. Verify refresh and failure recovery,
both required workbooks, deployed CORS and deep-link rewrites. Only then accept the
Day 2 integration milestone. Review screens, polling timelines, formulas, matching
and downloads were not implemented or expanded in this audit.

## 14. Final readiness verdict

**Not ready.** The isolated frontend foundations and tests are healthy, but the
running application cannot complete the required Day 2 flow. External contracts/
configuration block integration, and concrete frontend wiring/status recovery also
remain. This verdict does not classify the missing connections as completed work.
