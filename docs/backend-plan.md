# Backend Engineer — Plan

> Role-specific extract of `xlsx-data-workflow-demo-plan.md`. That file is the source of truth; section numbers below (§) point into it. Stack: **FastAPI on Lambda, OpenPyXL, Step Functions Standard, S3, DynamoDB, SAM**.

## Responsibilities

- FastAPI API.
- S3 / DynamoDB integration.
- Step Functions state machine.
- Lambda packaging and the OpenPyXL pipeline.
- Infrastructure, IAM, deployment, observability, integration tests.

## Workflow spine — Step Functions Standard (§6, §7.3)

Durable state machine walking a job through: `DRAFT → UPLOADING → UPLOADED → INSPECTING → DETECTED → SEMANTIC_REVIEW_PENDING → QUALITY_REVIEW_PENDING → NORMALIZATION_PENDING → FORMULA_REVIEW_PENDING → STANDARDIZATION_PENDING → UPDATE_PENDING → TRANSFORMATION_REVIEW_PENDING → APPLYING → VALIDATING_OUTPUT → COMPLETED | FAILED`.

- Human gates (#1 quality, #2 transformation) pause via **task tokens**; resume only on a valid review revision.
- State holds **S3 pointers, hashes, IDs, counts, small review metadata only** — never row arrays, workbook bytes, or prompts. Those go to S3; pass an object key + short manifest.
- Failed jobs expose a safe error code, human-readable explanation, retry (where idempotent), and correlation ID. Never leak raw workbook contents or prompts in errors (§6 State 14).

## API contract (§11)

All endpoints require Cognito JWT (API Gateway authorizer validates); every response includes `request_id`. Publish OpenAPI so FE can consume types. Endpoints in §11 table. FastAPI responsibilities (§13.1):

- Authenticate Cognito subject from API Gateway claims; validate job config.
- Create S3 presigned upload URLs; create/read DynamoDB metadata.
- Start/cancel Step Functions executions.
- Accept review decisions with **optimistic concurrency**.
- Return short-lived download URLs.
- **Never** process workbooks synchronously in an HTTP request.

**Review submission (§11):** includes `job_id`, expected `revision`, decisions keyed by proposal/issue ID, optional edits, `approved_by` from authenticated subject, optional reason. Use a **conditional DynamoDB update on `revision`** → stale browser gets `409 REVIEW_REVISION_CONFLICT`.

## Rule-based quality engine (§9) — you own this

Source of truth for structural errors; runs **before any LLM call**. Report stored in S3, summarized in DynamoDB.

- **Duplicate lines (§9.1):** stable row fingerprint after normalization (trim, normalize Unicode whitespace, consistent empties, exclude generated output column, version by sheet name + header order). Report group ID, all row numbers, duplicated values, recommended action. Default: keep first, mark later exact dups as deletion candidates — user approves.
- **Blank row (§9.2):** every relevant cell empty after normalization (ignore formatting-only cells, formulas → empty string). Default: delete from output copy.
- **Blank column (§9.3):** every data-row value empty. Exclude the new output column; distinguish intentional-blank vs comment/output field vs formatting artifact. Default: exclude from transformation input, never delete without approval.
- **Type mismatch (§9.4):** infer per-column type distribution (text/int/decimal/bool/date/percentage/identifier-like/formula/unknown). Flag when dominant type below threshold or incompatible minority exceeds threshold. Rule engine proposes a target type; **Tool #2 decides whether conversion is safe.** Any loss of precision / leading zeros / timezone / meaning → `manual_review`.

## Workers (§13.2) — one responsibility, bounded timeout, idempotent

- `inspect_worker` — download + inspect workbook (§6 State 3): sheet names/dims, header candidates, normalized headers, per-column type distribution, row fingerprints, blank counts, formula locations, redacted samples.
- `quality_worker` — deterministic checks (§9).
- `bedrock_worker` — dispatch **one** approved tool contract at a time.
- `apply_worker` — apply **only accepted** changes.
- `validate_worker` — reopen + reconcile output.
- `artifact_worker` — summary documents.

**Idempotency:** before writing an artifact, check whether an object already exists with the same input hash + prompt/rule version.

## OpenPyXL rules (§13.3)

- `read_only=True` for inspection where compatible; `data_only=False` when preserving formulas.
- **Write to a new output path, never over the input.**
- Preserve sheet names + header order unless a reviewed proposal changes them.
- Explicit cell coordinates in audit events; reopen output after saving.
- Treat formulas as formulas, not trusted code; strip/reject external links and unsupported features in validation.

## Apply + validate (§6 States 12–13)

Output policy drives the apply: **standardize only** (current workbook + canonical mappings + output column), **update only** (main workbook + merged input values), **both** (standardize current first, then update main using approved standardized keys), **neither** (reviewed copy + accepted quality fixes + approved column). Policy displayed before apply and stored in job config.

Validation reopens the generated workbook and checks: opens OK; expected sheets exist; expected headers exist exactly once; row + mutation counts reconcile; **no source workbook modified**; formulas present in expected cells; no forbidden external links; output hash recorded.

## Formula verification (§6 State 8, §10.4)

When Tool #3 proposes a formula, the backend verifies: begins with `=`; functions/operators on allowlist; references inside selected sheet/range; **no** external links, macros, `WEBSERVICE`, `HYPERLINK`, `INDIRECT`, `OFFSET`, or volatile functions; OpenPyXL can write it without corruption; correct output column + row-relative references. Label "syntax verified," not "calculated."

## AWS architecture (§7)

- **Region (§7.1):** one region per environment; default `us-east-1`; `ap-southeast-1`/`ap-southeast-7` via deploy param (not all three at once). Run a **preflight** verifying S3/DynamoDB/Lambda/API Gateway/Step Functions/Cognito/CloudWatch availability, Bedrock model availability + non-Marketplace + invoke permission. (AI supplies exact model ID.)
- **Compute (§7.4):** FastAPI + workers on Lambda; direct S3 upload (API Gateway payload limits make binary upload inappropriate). Reject oversize workbooks rather than time out. **No NAT Gateway** (budget).
- **S3 layout (§7.5):** `jobs/<job_id>/{input,manifests,inspection,quality,proposals,reviews,output}/...`. Controls: block public access; SSE (S3-managed, or CMK if required); versioning on; 14-day lifecycle expiration; object tags `job_id`/`environment`/`data_classification`; presigned URLs scoped by method/key/content-type + short expiry; no raw cell values in logs.
- **DynamoDB (§7.6):** one on-demand single-table `xlsx-workflow`. `PK=JOB#<job_id>`; `SK ∈ {META, ISSUE#, PROPOSAL#, REVIEW#<revision>, EVENT#<ts>#<uuid>}`; attrs `entity_type`, `status`, `owner_id`, `input_hash`, `main_hash`, `revision`, `expires_at` (TTL). GSI1 `OWNER#<id>`/`<created_at>#<job_id>` for listing; GSI2 `STATUS#<status>`/`<updated_at>#<job_id>` for ops. **Every state transition is a conditional update on `revision`.**

## Security & ops (§14)

- Cognito JWT authorizer; job ownership checked on every read/write/artifact-URL request.
- Separate IAM roles for API / inspection workers / transformation workers / Step Functions / deployment; least privilege. Bedrock scoped to the selected model, not `bedrock:*`. S3 scoped to `jobs/<job_id>/*` where practical. No long-lived keys in frontend.
- TLS everywhere; S3 + DynamoDB encryption at rest; CloudWatch retention 7–14 days; CloudTrail where affordable.
- **Log hashes/IDs/counts/schema summaries/redacted samples only** — never raw rows, workbook content, sensitive prompts, or full model responses.

## Budget controls you own (§15)

AWS Budget alerts at $175 / $280 / $330; S3 lifecycle; DynamoDB TTL; short log retention; API throttling; max jobs/day; `COST_GUARD_REACHED` status that halts new AI calls; **destroy-demo script** (S3 objects, DynamoDB table, log groups, SFN executions). Do **not** provision RDS, OpenSearch, NAT Gateway, always-on ECS, provisioned DynamoDB/Bedrock throughput, or Marketplace models.

## Day-by-day

- **Day 1** — Python project + FastAPI skeleton; domain enums, job-config schema, state transitions, error codes; SAM template (S3, DynamoDB, Lambda, API Gateway, Step Functions, Cognito placeholders); S3 prefix + DynamoDB key design; region preflight script + deploy README.
- **Day 2** — Authenticated job-create + presigned-upload routes; upload-complete verification (hash, size/type checks) + DynamoDB job records; OpenPyXL inspection worker + manifest; duplicate/blank/type-distribution rules; S3 + DynamoDB unit tests.
- **Day 3** — Step Functions through `QUALITY_REVIEW_PENDING`; task-token mechanism for gate #1; review-revision endpoint with optimistic concurrency; persist issues/proposals as paginated DynamoDB/S3 artifacts; retry/timeout/cancel/failure states.
- **Day 4** — Formula allowlist + verifier; OpenPyXL copy-and-apply for accepted quality/type changes; canonical main-file loader + deterministic exact matching; wire Tool #3 + Tool #4 states.
- **Day 5** — Tool #5 candidate generation + update apply; duplicate-main-row protection + conflict policies; second approval gate; output artifact generation + presigned download links; audit event per decision.
- **Day 6** — Deploy to selected region; API throttling, S3 lifecycle, DynamoDB TTL, CloudWatch alarms, log retention; verify IAM least privilege + private S3; output reopen/reconciliation; AWS Budgets + cost guardrails.
- **Day 7** — Failure/retry/cancel/stale-review tests; verify sources unchanged across all output modes; verify cleanup + redeploy; freeze API contract + tag release.

## Testing you own (§16)

Unit (§16.1): header normalization, fingerprinting, duplicate/blank detection, type inference, formula allowlist, row-key matching, mapping application, update conflict handling, DynamoDB conditional revision updates. Integration (§16.2): presigned upload + ownership, SFN start + callback gates, S3 artifact creation, OpenPyXL save/reopen, retry/failure transitions, stale review → 409, duplicate start → no second execution.

## Handoffs (§18)

- Shared types: **BE publishes OpenAPI; FE consumes.**
- Inspection: BE publishes manifest shape; AI uses bounded samples from it.
- Rule engine: BE owns deterministic findings; AI consulted on semantic/type fields.
- Tools #1–#5: AI owns schemas/fixtures; **BE owns the invocation boundary** (`bedrock_worker`, one tool at a time, validate before apply).
- Infra/IAM: AI supplies exact Bedrock permissions + model IDs.
