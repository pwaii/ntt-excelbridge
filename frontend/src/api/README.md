# Backend contract boundary

**Current status:** the schema conflict is resolved; actual FastAPI OpenAPI is now
available and types are generated. `jobs-api.ts` connects create, confirmation and
GET status. The production creation page mounts the upload flow. See
[current integration status](../../INTEGRATION.md). Historical Task 8 notes below
describe the earlier blocked state, not the current contract availability.

## Naming decision — UI label only

The user confirmed that the existing Git field `comment_name` should be retained.
The form schema, inferred configuration types, and adapter inputs now use
`comment_name`; **Prompt** remains the visible label and accessible UI name.
The legacy API field is unchanged. Do not rename the backend field to `prompt`.
The historical handoff notes below do not override this naming decision; the
published OpenAPI and concrete endpoint integration are still outstanding.

Task 9's [upload service, progress UI and confirmation adapter](../../UPLOADS.md)
are prepared independently. No concrete upload/confirmation contract is claimed.
Task 10's [metadata and Start boundary](../../METADATA-AND-START.md) requires a
documented way to obtain metadata and persist final sheet/key/header selections.

## Task 8 status — OpenAPI blocked, independent foundation implemented

On 2026-10-16 the repository contains no published OpenAPI JSON/YAML or schema URL.
The read-only request to the existing default development endpoint
`http://127.0.0.1:8000/openapi.json` could not connect. No backend server was started
and no AWS service was invoked. The existing conflict in
`backend/app/domain/schemas.py` remains unresolved; frontend work does not alter it.
FastAPI source and the legacy handwritten types are inspection evidence, not a
published API contract to fabricate generation from.

**No API types have been generated, no generation script is claimed as working,
and POST /v1/jobs is not connected.** `generated/README.md` reserves the output
directory honestly. A generator dependency/script will be added when a real input
schema exists; no manually authored DTO was placed in that directory.

The existing form, local validation, output policies, preview, and Task 7 protection
continue unchanged. A valid form still enables only local preview. No job is created,
uploaded or started. New code is independently testable behind the boundaries below.

## Authenticated transport

`http-client.ts` exports `createApiClient({ baseUrl, getValidToken, development })`.
Pass `import.meta.env.VITE_API_BASE_URL`, the Task 7 `useAuth().getValidToken` method,
and `import.meta.env.DEV` from a future integration hook/adapter. There is no new token
store and no ID/access token substitution. Task 7 blocks token retrieval until BE
confirms `VITE_COGNITO_API_TOKEN_TYPE`. No request is issued on a token failure.

Each request accepts a relative `/v1/` backend path, JSON declarations, a mandatory
`unknown -> T` response decoder, optional cancellation signal, and timeout (30 seconds
by default, including token retrieval). The decoder is where a future endpoint
adapter validates real server data. Generated TypeScript alone will not validate
runtime JSON. No caller can override the Authorization header, and redirects are
rejected so the bearer token is not forwarded to a different destination. The API
base must be HTTPS; explicit development loopback HTTP is permitted. Files/Blob/
FormData/ArrayBuffer bodies are rejected; S3 upload transport must remain separate
and must never receive the Cognito Authorization header.

`errors.ts` provides safe static status messages for 400/422, 401, 403, 404, 409,
429, 5xx and other errors, plus distinct network/timeout/cancel/auth/protocol/config
failure kinds. No raw backend detail, HTML, SDK exception, token, request payload,
or URL is logged or displayed. Best-effort metadata extraction recognizes identifiers
from `x-request-id`, `x-amzn-requestid`, and several `request_id`/`code`/`error_code`
locations without assuming a universal response envelope. Exact envelopes still need
OpenAPI confirmation. Empty/HTML error bodies retain HTTP status/header diagnostics.
`ApiResponse<T>` is transport metadata, not a fabricated backend response shape.

There are **no automatic retries**, including on POST, 401 or timeout. A future UI
must initiate reauthentication on 401 and re-fetch authoritative state on review
revision conflicts, without replaying the mutation. Backend authorization remains
authoritative; caller authentication/configuration is not server verification.

## Create Job boundary and in-memory state

`create-job-types.ts` defines temporary frontend-only `CreateJobAdapter<T>` and
`CreateJobReceipt<T>` types. They are deliberately not request/response DTOs:
the adapter accepts the validated local configuration and a cancellation signal,
then maps a real BE response into a job identity, opaque upload instructions and
optional request ID. No presigned URL shape, HTTP field mapping, or upload slot
contract is invented. `T` becomes the generated/validated instruction model later.

`create-job-controller.ts` exposes synchronous state snapshots/subscriptions and:

1. `editing-configuration` → local Zod validation.
2. `creating-job` → a single adapter operation, guarded against duplicate clicks.
3. `job-created` → `upload-instructions-received` → explicit `prepareUpload()` →
   `ready-for-upload`. These are frontend states; none claims upload/start completion.
4. `create-error` → safe diagnostics. Network, timeout, cancellation, protocol and
   server-error outcomes block blind retry/reset because a POST may already have
   created a job. Server reconciliation is required before a fresh attempt.

Original `File` objects are retained by identity in memory, with the normalized
configuration and receipt. Nothing is persisted in localStorage or transmitted by
the controller itself. Without a contract-backed adapter, `create()` fails with
an explicit configuration error; it cannot manufacture a success. The local form
does not import the controller yet. This avoids converting Day 1 preview into a
fake create operation while integration is blocked.

## Exact backend handoff needed for Task 8

- Published/versioned OpenAPI covering `POST /v1/jobs`, request media type and exact
  required/optional fields, constraints, success statuses and response body.
- Resolution of the existing `prompt` vs `comment_name` conflict and whether the
  Output Header is server-required. Confirm input/main file declarations, names,
  content type/size declarations, both flags and when sheet/key/header selections
  are accepted. Do not send `File` objects or workbook bytes in the create payload.
- Exact job-ID location, presigned instruction shape, input/main slot identities,
  HTTP method/required upload headers, expiry and whether URL refresh is available.
- Error schemas, correlation ID location, CORS exposure of request-ID headers, and
  the behavior when job metadata exists but generating upload instructions fails.
- Deployed API base URL, Cognito issuer/client/scopes and confirmed JWT token type.
- Idempotency/reconciliation contract for interrupted create requests. No unapproved
  idempotency header or retry behavior is invented by the frontend.

After publication: pin the BE schema/version; install an appropriate OpenAPI TS
generator; add a reproducible package script targeting `src/api/generated/`; generate
without hand edits; implement the configuration encoder/response validator and
receipt adapter; inject it into the existing form; add schema-based integration
fixtures. Preserve D2/D7 policy text and the real Files for the later upload task.

Future endpoints from design §11 (upload completion, start, job list/status,
issues/proposals, reviews, cancel, artifacts) can reuse this transport only after
their generated contracts exist. No endpoint-specific methods or later-day screens
were implemented in Task 8. S3 uploads and workflow start are explicitly excluded.

## Verification scope

`api-transport.test.ts` uses a toy transport endpoint/decoder, not fabricated jobs
responses. It covers JWT attachment, 400/401/403/404/409/422/429/5xx, varied error
envelopes/non-JSON bodies, request IDs, token failure, decoder failure, network,
timeout/cancellation, no POST retries and rejection of byte bodies/external paths.
`create-job-controller.test.ts` tests local validation, missing-adapter behavior,
duplicate clicks, original File identity, opaque receipt handoff, cancellation,
diagnostics and unknown-outcome retry prevention. Its receipt uses a Symbol as
opaque instructions; it is not a simulated presigned response. Existing creation
component tests continue to assert no fetch on local preview/invalid input.

**Real POST /v1/jobs request/response tests, schema generation and backend end-to-end
verification remain blocked. No real job or presigned instruction was obtained.**

Executed checks for Task 8 (2026-10-16):

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed, zero warnings |
| `npm.cmd test -- --reporter=dot` | 159 passed, 0 failed, nine files |
| `npm.cmd run build` | Passed |
| `git diff --check -- frontend` | Passed with the existing line-ending notice |

New contract-independent tests: 22 transport cases and 9 controller cases. Existing
128 tests still pass. React Router future-flag/Zod annotation notices remain nonblocking.
No dependencies or package scripts were added, because no schema is available for
generation. Files added: `http-client.ts`, `errors.ts`, `create-job-types.ts`,
`create-job-controller.ts`, `generated/README.md`, and the two test files above.
Files updated: this README, `frontend/README.md`, and an explicit legacy-only comment
in `client.ts` (its behavior is unchanged). No form, auth, backend, upload or start
implementation was modified. Existing repository merge conflicts remain untouched;
there was no staging, commit or push.

## Existing compatibility boundary

Backend owns the API. No published OpenAPI JSON/YAML or schema URL was found in
the repository during Task 5. The FastAPI source exists, but the working tree has
an unresolved conflict in `backend/app/domain/schemas.py`; it is not a usable
published contract. No backend files were changed and no schema was guessed.

`legacy-types.ts` preserves the pre-existing client assumptions for compatibility.
It is **handwritten, temporary, not authoritative, and not generated**. Its legacy
`ReviewRevision` is a request-like shape; new UI code uses the distinct
`ReviewRevisionViewModel` for a server revision. The client remains unrouted and
its behavior/payloads are unchanged. `types/index.ts` retains compatibility exports.

New frontend models live under `types/`, use explicit `*ViewModel` names, and are
not serialized as API payloads. Existing underscore output-policy/review strings
are frontend vocabulary until verified against a published contract. Prompt is
the UI name for Comment Name; the old client's `comment_name` is unchanged.

When BE publishes OpenAPI: pin the schema/version, generate a separate
`src/api/generated/` module with an OpenAPI TypeScript generator, and map validated
responses into UI models through an adapter. Replace legacy assumptions only
after checking the published schema. Do not manually author a generated module.
No generator dependency was added without an input schema.

Questions for BE before integration:

- What is the published schema location/version and exact job/proposal/issue shape?
- Does configuration use `prompt` or `comment_name`? Is output header required by
  the server (the current frontend requires it)?
- What metadata identifies upload version, sheet, columns, detected header, and
  data-row count? How are a corrected header and key selection persisted before start?
- What are the exact review status/decision values, pattern-rule fields, confidence
  scale, match candidate identifiers, and approved-formula audit references?
- What is the revision token's wire type and the 409 error envelope? Which response
  supplies the authoritative revision/status after submission and browser reopening?
- What artifact metadata exposes the output base, availability, and download expiry?
- Is 25 MB decimal or binary, and how is top-issues-only mode reported?

The future adapter must react to HTTP 409 `REVIEW_REVISION_CONFLICT` by blocking
resubmission, refetching authoritative job/review state, and requiring the human
to reconcile the draft. Preserve the submitted revision; never increment it locally.
Only the backend starts the next execution segment after its conditional write.
