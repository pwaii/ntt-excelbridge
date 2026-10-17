# Task 9 — Direct-to-S3 upload foundation

Update: [the latest integration work](INTEGRATION.md) now mounts this flow and
connects generated-type create/confirmation adapters. The backend signs PUT with
the exact XLSX Content-Type, which the adapter supplies. Real Cognito/S3 verification
remains pending. The Task 9 account below describes the earlier blocked state.

## Status and contract boundary

Independent upload transport, workflow state and presentation are implemented.
**Production integration is still blocked by Task 8's missing published OpenAPI
and configured environment.** No real S3 PUT, backend confirmation, job creation,
workbook inspection or AWS operation was performed. The default local
`http://127.0.0.1:8000/openapi.json` remains unreachable. Existing backend schema
merge conflicts were not changed and no backend server was started.

Read-only source inspection found:

- `backend/app/storage/s3_store.py` signs S3 `put_object` with `HttpMethod="PUT"`
  and an XLSX Content-Type. This is evidence of intended signing behavior, not a
  replacement for published upload instructions.
- `backend/app/api/uploads.py` currently verifies **individual slots** using S3 HEAD
  and returns an updated server manifest. The exact request/response must be
  generated/validated from BE OpenAPI before wiring this route.
- A separate multipart upload proxy exists in backend source. **It is not used**;
  workbook bytes must bypass FastAPI for this workflow.

The response types previously inspected expose a URL/expiry but do not explicitly
publish a method/signed-header map. FE does not derive headers from `File.type`,
guess URL expiry, fabricate checksums, or treat legacy handwritten types as an
agreed contract. `PresignedPutInstruction` is a **temporary internal adapter model**,
not a DTO. It requires the exact backend-approved PUT method, raw URL and headers;
optional absolute expiry must be supplied reliably by a future schema-backed adapter.
Unsupported presigned methods are blocked, not silently converted to PUT.

## Upload architecture

`src/uploads/presigned-put.ts` accepts a real browser `File` and a normalized
instruction. It reuses the existing XLSX/25 MiB validator, checks HTTPS and an
explicit allowed S3 origin list, rejects the backend origin, and uses XHR
`send(file)` with the unchanged URL. It never wraps the file in FormData or JSON.
Only supplied signed headers are set; Authorization/Cookie and browser-forbidden
headers are rejected. No auth context/token provider is imported and
`withCredentials` is false. The normal browser-managed Origin/Host/etc. headers
remain browser-owned. There is no URL/response-body logging or persistent URL store.

Native `xhr.upload` events are the sole source of loaded/total progress. Unknown
totals stay indeterminate. No timer simulates progress. XHR timeout, AbortSignal,
S3 rejection, network interruption and cancellation settle explicitly and remove
listeners. A WeakSet blocks simultaneous transfer of the same File object.
Actual ETag is read only when exposed by CORS; absent ETag is null, not guessed.

The integration adapter must provide verified regional S3 origins/configuration.
Use final regional presigned URLs, not redirecting proxy endpoints: XHR does not
offer Fetch's redirect control. A different final response origin is treated as an
error, but this is not a substitute for trusting/validating the initial S3 destination.
No production allowlist or fake bucket setting was invented here.

## Workflow, retry and confirmation states

`src/uploads/workflow.ts` takes an existing job identity, original File objects,
instructions, uploader and optional `UploadConfirmationAdapter<T>`.
Required files follow the existing toggles: current only for neither, current plus
main for standardize/update/both. Unneeded main files/instructions are not uploaded.
No new job is created and no workflow start occurs in this coordinator.

Each file moves through waiting → uploading → awaiting-confirmation → uploaded.
Failed/cancelled transfers have separate states. All required transfers must succeed
before **any** confirmation adapter call. Successful transfers are retained when
another fails or backend verification fails; they are not uploaded again.
Progress reaching 100% only means transferred bytes, not backend-confirmed success.

Ordinary failed/cancelled transfers allow at most **one explicit manual retry**.
Known-expired/403/configuration failures cannot retry the same instructions.
403 is not asserted to mean expiry: it can also mean signed-header/permission
problems. No fresh-URL request is issued because no refresh contract is published.
There are no automatic retries, endless loops or job recreation.

`UploadConfirmationAdapter<T>` owns exact field/slot mapping, JWT attachment through
Task 8's authenticated API transport, individual-vs-combined request sequencing and
runtime validation that **all required files** are server-verified. It receives actual
transfer receipts, never fabricated ETags/checksums. No concrete endpoint adapter is
implemented without OpenAPI. A missing adapter produces an honest confirmation
failure, never uploaded/verified state. Confirmation calls are guarded against
duplicates. A failed confirmation preserves transfer state and requires server
reconciliation. At most one explicit confirmation retry is permitted only if the
adapter sets `retrySafe` based on the published contract; default is no resubmission.

Successful confirmation retains the opaque backend manifest and request IDs for
Task 10. Failed confirmations retain safe `ApiError` request ID/code where available.
No worksheet/header/column/row-count/key metadata is invented or parsed locally.
All Files, instructions, receipts and returned manifests remain in memory.

## UI and preserved Day 1 behavior

`UploadProgressPanel` displays filename/size, waiting/uploading/awaiting-confirmation/
uploaded/failed/cancelled states, accessible native progress, explicit Cancel/Retry,
and distinct confirmation failure. It renders filenames as text and never renders
presigned URLs, object keys or raw server messages. A verified success label requires
the coordinator's server-confirmed state.

**The panel is not mounted into CreateJobPage yet.** That page still has only the
local preview preserved from Day 1, behind Task 7 authentication. Mounting real upload
actions requires a real Task 8 receipt and validated BE instruction/confirmation
adapters. No mock network flow or simulated progress is shown to application users.
Existing output policies and ADR D1/D2/D5/D7/D10 behavior are unchanged.

## Exact handoff and CORS blockers

1. Published OpenAPI for create-job and upload completion; exact per-file/combined
   request/response, input/main slot mapping and authoritative manifest/metadata.
2. Explicit HTTP method and full signed header map (including Content-Type and any
   checksum/encryption requirements). Confirm expiry semantics, required checksums,
   URL refresh support, overwrite/retry safety and reconciliation/idempotency.
3. Real job receipt and verified S3 origin allowlist; correct AWS region/signing
   credentials lifetime. The frontend does not generate URLs or AWS signatures.
4. Deployed bucket CORS allowing the exact app origin, PUT, and all signed headers.
   Progress listeners cause a browser preflight. Expose ETag only if FE needs it;
   server HEAD verification stays authoritative. Source infra allows localhost and
   127.0.0.1:5173, PUT/GET/HEAD, wildcard headers and ETag, but deployment is unverified.
5. Task 7 Cognito configuration, explicit BE-confirmed JWT token type, API CORS and
   correlation-header exposure for backend confirmation. JWTs go only to the API,
   never to S3.

After those are available, implement the generated-schema adapters and connect
Create Job receipt → upload coordinator/panel → verified manifest handoff to Task 10.
Do not start a workflow before metadata/sheet/header confirmation requirements hold.

## Files and verification scope

Added `src/uploads/{types,presigned-put,workflow}.ts`,
`src/components/job/upload-progress-panel.tsx`,
`src/tests/{presigned-put,upload-workflow}.test.ts`, and
`src/tests/upload-progress.test.tsx`. Added this document and linked it from the
frontend/API READMEs. No dependencies were added. Existing backend and production
form logic were not modified. No staging/commit/push was performed.

Tests use deterministic XHR/adapter mocks and explicitly synthetic normalized
instructions/opaque manifests. They do not claim a published BE shape, actual
AWS signatures, deployed CORS validation or real S3 success. A configured browser
end-to-end upload/confirmation test remains blocked.

Executed on 2026-10-16: `npm.cmd run typecheck` passed; `npm.cmd run lint` passed
with zero warnings; `npm.cmd test -- --reporter=dot` passed **195 tests in 12 files,
0 failed**; `npm.cmd run build` passed; scoped frontend `git diff --check` passed.
New coverage: 17 XHR transport cases, 13 workflow/confirmation cases and 6 UI cases.
Existing Router future-flag/Zod annotation notices remain nonblocking. The existing
unmerged App/backend schema index entries remain, and no real S3/browser integration
test was executed.

References: [AWS presigned uploads and signed Content-Type](https://docs.aws.amazon.com/en_es/AmazonS3/latest/userguide/PresignedUrlUploadObject.html),
[AWS presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
