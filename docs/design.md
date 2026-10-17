# XLSX Data Design and Workflow

## 1. Document purpose

This document is the implementation brief for a real, end-to-end demonstration of an XLSX data-quality, semantic-column, standardization, and update workflow.

The demo accepts one current XLSX workbook and a natural-language prompt describing the column to add. The user may optionally select standardization, update, or both and upload a main/reference workbook from the database. The system detects data problems, asks an LLM to interpret column meaning and mappings, presents proposed changes to a human, generates and verifies Excel formulas where needed, and produces a downloadable final workbook plus an audit trail.

The plan treats “Vile” as **Vite**. The application stack remains React + Vite, FastAPI + Python, OpenPyXL, S3, and DynamoDB, with the additional AWS services required to run the workflow safely: API Gateway, Lambda, Step Functions, Amazon Bedrock, Cognito, CloudWatch, IAM, KMS, and optionally CloudFront.

**Target completion:** seven working days with three people:

1. Frontend Engineer
2. Backend Engineer
3. AI Engineer

**Cloud constraint:** AWS only, limited to `us-east-1`, `ap-southeast-1`, and `ap-southeast-7`.

**Budget constraint:** USD 350 maximum for the demonstration. No AWS Marketplace subscriptions or Marketplace-dependent foundation models.

---

## 2. Executive summary

The safest implementation is a human-gated, event-driven workflow:

```text
React/Vite UI
    |
    | Cognito JWT + presigned S3 upload
    v
API Gateway HTTP API -> FastAPI on Lambda
    |                         |
    | create job               | metadata and review decisions
    v                         v
Step Functions Standard  <-> DynamoDB
    |
    +--> S3/OpenPyXL inspection and deterministic rule engine
    |
    +--> Bedrock Tool #1: prompt/column semantic verification
    |
    +--> Human review gate #1: accept/fix data-quality proposals
    |
    +--> Bedrock Tool #2: mismatched-type interpretation
    |
    +--> Bedrock Tool #3: Excel formula generation + formula verification
    |
    +--> Bedrock Tool #4: current-to-standardized mapping
    |
    +--> Bedrock Tool #5: current-row-to-main-row matching for update
    |
    +--> Human review gate #2: accept standardization/update
    |
    +--> OpenPyXL apply changes, validate, and write final XLSX to S3
    |
    v
Download final workbook + review report + audit log
```

The system must never allow an LLM response to directly execute arbitrary Python or overwrite the source workbook. LLM responses are structured JSON proposals. The backend validates those proposals against strict Pydantic schemas, applies allowlists, and waits for explicit human approval before mutating data.

---

## 3. Requirement interpretation and assumptions

### 3.1 Meaning of “prompt”

For this demo, **prompt** is the natural-language description of the new column’s business meaning. Examples:

- `customer segment`
- `approved product category`
- `risk level derived from the customer profile`

The UI also asks for the exact output column header separately. If the user leaves the header empty, the system creates a safe header from the prompt, for example `customer_segment`.

This separation avoids confusing a human description with an Excel field name.

### 3.2 Meaning of the main file

The **main file** is the trusted reference workbook currently used as the database-like source of truth. It is required when:

- standardization is selected;
- update is selected; or
- both are selected.

For the demo, the reference workbook must contain one clearly identifiable data sheet and a header row. The user selects the sheet and, if necessary, the business key column used for matching. If no explicit key is provided, Tool #5 proposes a composite key and the user must approve it.

### 3.3 Supported workbook scope

To keep the seven-day demo reliable and within budget:

- `.xlsx` only; `.xls`, `.xlsm`, and password-protected files are rejected.
- One input workbook and, when needed, one main workbook per job.
- One selected input sheet and one selected main sheet per job.
- Header row is required and must be within the first 20 rows.
- Formula cells are read as values for detection; formulas are preserved only when OpenPyXL can safely retain them.
- Initial demo limit: 25 MB per workbook and 50,000 data rows per selected sheet.
- Files exceeding those limits are rejected with a clear message rather than timing out.
- A job is idempotent: the same uploaded object version and configuration produce the same job input hash and cannot silently create duplicate work.

### 3.4 Human review model

There are two mandatory review gates:

1. **Data-quality review:** review duplicates, blank rows/columns, type mismatches, Tool #1 semantic interpretation, and Tool #2 type-normalization proposals.
2. **Transformation review:** review standardization mappings, update matches, conflicts, proposed formulas, and the final change summary.

No automatic path is allowed to bypass a review gate in the demo, even when the model confidence is high.

---

## 4. Scope

### 4.1 In scope

- Upload current and optional main XLSX files through the browser.
- Select a worksheet, output column header, prompt, standardize flag, update flag, and optional key column.
- Validate that a main file is present when standardize or update is selected.
- Store original files immutably in S3.
- Detect duplicate lines, completely blank rows, completely blank columns, and mismatched value types.
- Generate a machine-readable quality report with row and column coordinates.
- Use Bedrock for five constrained tools:
  - semantic verification of the requested column meaning;
  - type mismatch interpretation and normalization proposal;
  - Excel formula generation and formula syntax verification;
  - mapping current values to standardized values;
  - matching input rows to main rows for updates.
- Show proposed changes in a browser review interface.
- Record accept/reject/edit decisions with user, timestamp, reason, and before/after values.
- Apply approved transformations with deterministic Python/OpenPyXL code.
- Generate a final XLSX file, a JSON audit report, and a human-readable review summary.
- Deploy the demo to AWS in one selected region.
- Provide local development mode with LocalStack optional but not required.

### 4.2 Explicitly out of scope for the seven-day demo

- Arbitrary Python execution generated by an LLM.
- Training or fine-tuning a model.
- A general-purpose data warehouse or lakehouse.
- Multi-workbook joins across more than one current and one main file.
- Real-time collaborative editing by multiple human reviewers.
- Full Excel recalculation engine. The demo verifies formula syntax and references, but formula values are recalculated by Excel/LibreOffice when the file is opened.
- Macros, VBA, external workbook links, pivot-table regeneration, charts, Power Query, or protected sheets.
- Automatic database writes outside the generated workbook.
- Production-grade tenant billing, SSO federation, private networking, or cross-region disaster recovery.

---

## 5. User journeys and acceptance criteria

### 5.1 New job

1. User signs in through Cognito.
2. User uploads the current workbook.
3. User enters the prompt and optional exact output header.
4. User chooses standardize, update, both, or neither.
5. If either option is selected, user uploads the main workbook.
6. User selects the relevant sheets and optional business key.
7. User starts the job.
8. The UI displays a job ID and live status.

**Acceptance criteria:** invalid combinations are rejected before the workflow starts; files are private; the user can refresh the page without losing job state.

### 5.2 Data-quality review

The user sees:

- summary counts by issue type;
- affected sheet, row, column, and cell coordinates;
- sample before/after values;
- severity and deterministic reason;
- LLM proposal and confidence where applicable;
- Accept, Reject, Edit, and Ignore-with-reason actions.

**Acceptance criteria:** every proposed mutation has a review status; no accepted change is applied until the user submits the review gate.

### 5.3 Transformation review

The user sees:

- Tool #4 standardization mappings;
- Tool #5 update matches, unmatched rows, duplicate matches, and conflicts;
- generated formulas and their verification results;
- counts of inserted, updated, skipped, and rejected rows;
- a preview of the final output rows.

**Acceptance criteria:** ambiguous matches are never auto-applied; the user must explicitly accept or reject each ambiguous group or use a clearly labeled bulk action.

### 5.4 Download

After approval, the UI provides:

- final `.xlsx` download;
- change report `.json` download;
- review summary `.md` download;
- a status showing whether formula syntax checks passed.

**Acceptance criteria:** final file is a new S3 object; source files remain unchanged; audit records contain all approved and rejected changes.

---

## 6. End-to-end workflow design

### State 0 — `DRAFT`

The user has not submitted a complete job. The frontend validates required fields locally, but the backend repeats all validation.

### State 1 — `UPLOADING`

The frontend requests presigned S3 upload URLs from FastAPI and uploads directly to S3. The API never receives workbook bytes through API Gateway.

### State 2 — `UPLOADED`

The backend verifies the S3 object exists, records size, ETag/version ID, SHA-256 hash, MIME type, and original filename, and rejects unsupported files.

### State 3 — `INSPECTING`

A worker downloads the workbook from S3 to ephemeral `/tmp`, loads it with OpenPyXL in read-only mode where possible, and creates a normalized inspection snapshot:

- sheet names and dimensions;
- header candidates;
- normalized header names;
- per-column inferred type distribution;
- row fingerprints;
- blank row and blank column counts;
- formula locations;
- sample values with sensitive-value redaction in logs.

### State 4 — `DETECTED`

Rule-based checks produce a quality report before any LLM call. The report is stored in S3 and summarized in DynamoDB.

### State 5 — `SEMANTIC_REVIEW_PENDING`

Tool #1 receives the prompt, selected headers, sample values, and schema metadata. It returns:

- whether the requested meaning is represented by an existing column;
- the candidate source column(s);
- a proposed new-column definition;
- semantic confidence;
- evidence cells;
- questions for the human when ambiguous.

The user reviews Tool #1’s interpretation.

### State 6 — `QUALITY_REVIEW_PENDING`

The UI presents duplicates, blank rows/columns, and type issues. The user may accept, reject, or edit proposed actions.

### State 7 — `NORMALIZATION_PENDING`

For mismatched types, Tool #2 proposes normalized values and a target type. Examples:

- `00123`, `123`, and `123.0` → text identifier `123` only if the user approves loss of leading-zero behavior;
- `2026/10/15`, `15-10-2026`, and Excel serial values → date;
- `Y`, `Yes`, `1`, and `true` → Boolean according to an explicitly displayed mapping.

The system must preserve the original value in the audit record.

### State 8 — `FORMULA_REVIEW_PENDING`

Tool #3 may produce an Excel formula only when the new column requires a formula. The tool returns formula text, target row range, referenced headers, and an explanation. The backend verifies:

- formula begins with `=`;
- function names and operators are on an allowlist;
- cell references remain inside the selected sheet/range;
- no external workbook links, macros, `WEBSERVICE`, `HYPERLINK`, `INDIRECT`, `OFFSET`, or volatile/untrusted functions are allowed in the demo;
- formula can be written by OpenPyXL without parse corruption;
- formula uses the correct output column and row-relative references.

The user approves the formula before it is applied.

### State 9 — `STANDARDIZATION_PENDING`

If standardize is selected, Tool #4 compares current values and current headers against the main workbook’s canonical values and headers. It returns a mapping proposal with:

- source field/value;
- canonical field/value;
- reason and evidence;
- confidence;
- one-to-one, many-to-one, or unmapped classification;
- whether the change is safe, ambiguous, or rejected.

The system never changes a value for which the tool returns `ambiguous` without human selection.

### State 10 — `UPDATE_PENDING`

If update is selected, Tool #5 matches current rows to rows in the main workbook. Matching order is:

1. deterministic exact match on the approved key;
2. deterministic normalized exact match on the approved key;
3. LLM-assisted composite match only for unresolved rows;
4. human review for duplicate, conflicting, or low-confidence matches.

The LLM is not allowed to invent a new main-row ID. It may only select from row IDs supplied in the prompt.

### State 11 — `TRANSFORMATION_REVIEW_PENDING`

The user reviews all standardization and update proposals, including duplicate-current-row cases and update conflicts.

### State 12 — `APPLYING`

The backend applies only accepted changes to a copy of the current workbook or a copy of the main workbook according to the selected output policy:

- **standardize only:** output is the current workbook with approved canonical mappings and the requested output column;
- **update only:** output is the main workbook with approved input values merged into matched rows;
- **both:** standardize the current data first, then update the main workbook using the approved standardized keys and values;
- **neither:** output is a reviewed copy with only accepted data-quality fixes and the requested column if approved.

The exact output policy is displayed before application and stored in the job configuration.

### State 13 — `VALIDATING_OUTPUT`

The system reopens the generated workbook with OpenPyXL and verifies:

- workbook opens successfully;
- expected sheets still exist;
- expected headers exist exactly once;
- row count and approved mutation counts reconcile;
- no source workbook was modified;
- formulas are present in expected cells;
- no forbidden external links were introduced;
- output hash is recorded.

### State 14 — `COMPLETED` or `FAILED`

Completed jobs expose downloads. Failed jobs expose a safe error code, human-readable explanation, retry action where idempotent, and correlation ID. Raw workbook contents and model prompts are never shown in an error message.

---

## 7. AWS architecture

### 7.1 Region strategy

Use one region per deployed demo environment. Default recommendation: `us-east-1`, because it is the easiest primary region for broad AWS and Bedrock availability. Support `ap-southeast-1` and `ap-southeast-7` through a deployment parameter, not by running all three regions simultaneously.

The region must be selected before deployment and recorded in the job metadata. The application must not replicate user files across regions for this demo. A region preflight script must verify:

- S3, DynamoDB, Lambda, API Gateway, Step Functions, Cognito, and CloudWatch are available;
- the selected Bedrock model or inference profile is available;
- the selected model does not require an AWS Marketplace subscription;
- the account has permission to invoke the model.

### 7.2 Service responsibilities

| Layer | AWS service | Responsibility |
|---|---|---|
| Frontend | S3 + CloudFront | Host the built React/Vite static site. Use a private S3 bucket with CloudFront Origin Access Control if CloudFront is enabled. |
| Authentication | Amazon Cognito User Pool | Demo user sign-in and JWTs. API Gateway validates the JWT. |
| HTTP API | API Gateway HTTP API | Low-cost API front door, CORS, JWT authorizer, throttling. |
| Application API | AWS Lambda running FastAPI | Job creation, presigned URLs, status, review decisions, download URLs. Use a Lambda-compatible FastAPI adapter. |
| Orchestration | Step Functions Standard | Durable multi-step workflow, retries, human approval callbacks/task tokens, and visible execution history. |
| Async execution | Lambda worker functions | XLSX inspection, rule checks, Bedrock calls, OpenPyXL transformations, output validation. |
| Object storage | Amazon S3 | Original workbooks, intermediate inspection JSON, reports, final workbooks, immutable audit snapshots. |
| Metadata | DynamoDB on-demand | Job state, configuration, review decisions, idempotency keys, counters, TTL for cleanup. |
| AI | Amazon Bedrock Runtime | Constrained JSON-only LLM calls for Tools #1–#5. |
| Monitoring | CloudWatch Logs and metrics | API, workflow, worker, model latency, token usage, failures, and budget signals. |
| Audit/security | IAM, KMS, CloudTrail | Least-privilege roles, encryption, API/model auditability. |

### 7.3 Why Step Functions Standard

The workflow has multiple human approval pauses, retries, branching, and a final reconciliation step. Step Functions Standard is the appropriate orchestration layer because it keeps state durably and supports task-token approval gates. Large workbook bytes never travel through the state machine; state contains S3 pointers, hashes, IDs, counts, and small review metadata only.

Do not put full row arrays, workbook contents, or model prompts into Step Functions state. Store those in S3 and pass an object key plus a short manifest.

### 7.4 Compute choice and file-size limitation

FastAPI and the workbook workers run on Lambda for the demo. The system uses direct S3 upload because API Gateway payload limits make binary workbook upload through the API inappropriate.

The demo deliberately rejects workbooks above the declared size/row limits. If larger workbooks become a requirement, move the OpenPyXL processing worker to ECS Fargate or AWS Batch in a later phase. Do not add a NAT Gateway just to support this demo; its fixed cost would threaten the USD 350 budget.

### 7.5 S3 bucket and prefix layout

Use separate buckets in production, or separate prefixes in a single demo bucket:

```text
s3://<app-data-bucket>/jobs/<job_id>/input/current.xlsx
s3://<app-data-bucket>/jobs/<job_id>/input/main.xlsx
s3://<app-data-bucket>/jobs/<job_id>/manifests/job.json
s3://<app-data-bucket>/jobs/<job_id>/inspection/inspection.json
s3://<app-data-bucket>/jobs/<job_id>/quality/quality-report.json
s3://<app-data-bucket>/jobs/<job_id>/proposals/tool-1.json
s3://<app-data-bucket>/jobs/<job_id>/proposals/tool-2.json
s3://<app-data-bucket>/jobs/<job_id>/proposals/tool-3.json
s3://<app-data-bucket>/jobs/<job_id>/proposals/tool-4.json
s3://<app-data-bucket>/jobs/<job_id>/proposals/tool-5.json
s3://<app-data-bucket>/jobs/<job_id>/reviews/review-<revision>.json
s3://<app-data-bucket>/jobs/<job_id>/output/final.xlsx
s3://<app-data-bucket>/jobs/<job_id>/output/change-report.json
s3://<app-data-bucket>/jobs/<job_id>/output/review-summary.md
```

S3 controls:

- block public access;
- server-side encryption with S3-managed encryption for the demo, or a customer-managed KMS key if required;
- bucket versioning enabled;
- lifecycle expiration for demo jobs after 14 days;
- object tags for `job_id`, `environment`, and `data_classification`;
- presigned URLs limited by method, key, content type, and short expiry;
- no logs containing raw cell values.

### 7.6 DynamoDB design

Use one on-demand table for the demo, with a single-table pattern.

**Table:** `xlsx-workflow`

| Attribute | Meaning |
|---|---|
| `PK` | `JOB#<job_id>` |
| `SK` | `META`, `ISSUE#<issue_id>`, `PROPOSAL#<proposal_id>`, `REVIEW#<revision>`, `EVENT#<timestamp>#<uuid>` |
| `entity_type` | `job`, `issue`, `proposal`, `review`, or `event` |
| `status` | Current job or review status |
| `owner_id` | Cognito subject ID |
| `input_hash` | Hash of current input plus configuration |
| `main_hash` | Hash of main workbook when present |
| `revision` | Monotonic review revision |
| `expires_at` | TTL timestamp for demo cleanup |

Recommended indexes:

- `GSI1PK = OWNER#<owner_id>`, `GSI1SK = <created_at>#<job_id>` for job listing.
- `GSI2PK = STATUS#<status>`, `GSI2SK = <updated_at>#<job_id>` for operations view.

DynamoDB stores metadata and decisions, not whole workbooks. Every state transition uses a conditional update so a stale browser cannot overwrite a newer review revision.

---

## 8. Repository and project structure

```text
xlsx-workflow/
├── README.md
├── .env.example
├── Makefile
├── infra/
│   ├── template.yaml                 # AWS SAM template
│   ├── statemachine.asl.json         # Step Functions Standard definition
│   ├── policies/
│   │   ├── api-lambda-policy.json
│   │   ├── worker-policy.json
│   │   └── bedrock-policy.json
│   └── scripts/
│       ├── preflight.ps1
│       ├── deploy.ps1
│       └── destroy-demo.ps1
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py
│   │   ├── settings.py
│   │   ├── auth.py
│   │   ├── api/
│   │   │   ├── jobs.py
│   │   │   ├── uploads.py
│   │   │   ├── reviews.py
│   │   │   └── downloads.py
│   │   ├── domain/
│   │   │   ├── models.py
│   │   │   ├── enums.py
│   │   │   ├── schemas.py
│   │   │   └── state_machine.py
│   │   ├── storage/
│   │   │   ├── s3_store.py
│   │   │   └── dynamo_store.py
│   │   ├── workers/
│   │   │   ├── inspect_workbook.py
│   │   │   ├── quality_rules.py
│   │   │   ├── apply_changes.py
│   │   │   └── validate_output.py
│   │   ├── ai/
│   │   │   ├── bedrock_client.py
│   │   │   ├── prompts.py
│   │   │   ├── tool1_semantics.py
│   │   │   ├── tool2_types.py
│   │   │   ├── tool3_formulas.py
│   │   │   ├── tool4_standardize.py
│   │   │   └── tool5_update.py
│   │   └── tests/
│   │       ├── fixtures/
│   │       ├── test_quality_rules.py
│   │       ├── test_schemas.py
│   │       ├── test_transforms.py
│   │       └── test_api.py
│   └── Dockerfile
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── app/
│       ├── components/
│       ├── features/
│       │   ├── job-create/
│       │   ├── quality-review/
│       │   └── transformation-review/
│       ├── api/
│       ├── types/
│       └── tests/
├── prompts/
│   ├── tool1-semantic.md
│   ├── tool2-type-normalization.md
│   ├── tool3-formula.md
│   ├── tool4-standardization.md
│   └── tool5-update-match.md
├── sample-data/
│   ├── current.xlsx
│   ├── main.xlsx
│   └── expected-result.xlsx
└── docs/
    ├── api-contract.md
    ├── review-playbook.md
    └── demo-runbook.md
```

---

## 9. Rule-based data-quality engine

The rule engine is the source of truth for detectable structural errors. LLM calls supplement interpretation; they do not replace deterministic validation.

### 9.1 Duplicate line detection

Create a stable row fingerprint from non-empty cell values after safe normalization:

- trim surrounding whitespace;
- normalize Unicode whitespace;
- preserve original case unless the configured comparison is case-insensitive;
- represent empty values consistently;
- exclude the generated output column from the fingerprint;
- include sheet name and header order in the fingerprint version.

Report:

- duplicate group ID;
- all row numbers in the group;
- exact duplicated values;
- recommended action: keep first, keep last, merge, or manual review.

Default proposal: keep the first row and mark later exact duplicates as candidates for deletion. The user must approve.

### 9.2 Missing value in the entire row

A row is blank when every relevant cell is empty after normalization. The engine ignores formatting-only cells and formulas that evaluate to an empty string.

Default proposal: delete the row from the output copy. The UI shows the row number and nearby rows before approval.

### 9.3 Missing value in the entire column

A column is blank when every data-row value is empty. The engine excludes the new output column from this check and distinguishes:

- an intentionally blank column;
- a column that is the requested prompt/output field;
- a structural artifact caused by formatting.

Default proposal: exclude the blank column from the transformation input, but never delete it without human approval. The UI offers “count as prompt/output column” or “remove from output.”

### 9.4 Mismatched value types

Infer a type distribution per column from non-empty values:

- text;
- integer;
- decimal;
- Boolean;
- date/datetime;
- percentage;
- identifier-like text;
- formula;
- unknown.

Flag a column when the dominant type is below the configured confidence threshold, or when incompatible values exceed the allowed minority threshold. Examples:

- dates mixed with free text;
- numeric values mixed with currency strings;
- Boolean-like values mixed with unrelated text;
- identifiers with leading zeros mixed with numeric coercions.

The rule engine proposes a target type but Tool #2 determines whether a semantic conversion is safe. Any conversion that may lose precision, leading zeros, timezone information, or original meaning is marked `manual_review`.

---

## 10. Bedrock tool contracts

### 10.1 Shared AI safety rules

- Use Amazon Bedrock Runtime Converse API from Python.
- Resolve and verify the model ID or inference profile during deployment; do not hardcode an outdated model ID.
- Prefer a non-Marketplace Amazon model available in the selected region.
- Set `maxTokens` explicitly on every invocation.
- Use low temperature for classification and mapping.
- Require JSON output matching a Pydantic schema.
- Validate all enum values, row IDs, column names, ranges, and lengths.
- Reject outputs containing unknown row IDs, unknown headers, executable code, or unbounded formulas.
- Retry only transient service errors; do not retry validation or access-denied errors.
- Log model ID, prompt version, input hash, output hash, latency, and token counts, but not raw sensitive cell contents.
- Use redacted samples and deterministic IDs in prompts wherever possible.

### 10.2 Tool #1 — semantic verification of the requested column

**Input:**

- `prompt`;
- requested output header;
- current headers and normalized headers;
- main headers when available;
- column type summaries;
- limited sample values and evidence cell IDs;
- job configuration and prompt version.

**Output schema:**

```json
{
  "meaning": "customer segment",
  "existing_column_matches": [
    {"column_id": "current:C", "confidence": 0.91, "reason": "..."}
  ],
  "recommended_output_header": "customer_segment",
  "interpretation": "...",
  "confidence": 0.91,
  "status": "confirmed|ambiguous|not_found",
  "questions_for_human": []
}
```

The UI must show evidence for the recommendation. Tool #1 cannot create values; it only verifies meaning and identifies candidate source columns.

### 10.3 Tool #2 — mismatched-type normalization

**Input:** a single flagged column, representative values, inferred type distribution, requested target type, and preservation constraints.

**Output:** one proposal per affected cell or value class:

```json
{
  "column_id": "current:D",
  "target_type": "date",
  "proposals": [
    {
      "row_id": "r-12",
      "original": "15/10/2026",
      "normalized": "2026-10-15",
      "confidence": 0.98,
      "status": "safe|ambiguous|reject",
      "reason": "day/month interpretation based on column context"
    }
  ]
}
```

The backend re-parses the normalized value with Python before it can be accepted. The original value is always retained in the audit report.

### 10.4 Tool #3 — Excel formula generation and verification

Tool #3 is optional. It is used only when the user selects a formula-based new column.

**Input:** prompt meaning, source headers, allowed functions, sample rows, and expected output type.

**Output:**

```json
{
  "formula_template": "=IF([@[status]]=""Active"",""Y"",""N"")",
  "target_header": "is_active",
  "expected_type": "text",
  "referenced_headers": ["status"],
  "explanation": "...",
  "confidence": 0.94
}
```

Verification must include formula allowlisting, reference validation, row expansion, and a lightweight test against fixture rows. The app must label the result as “syntax verified,” not “calculated,” because OpenPyXL does not calculate formulas.

### 10.5 Tool #4 — standardization mapping

Tool #4 maps current headers and values to the canonical main-file representation.

**Required constraints:**

- candidate canonical values are supplied in the prompt;
- the model cannot invent a canonical value;
- many-to-one mappings are allowed only when the user sees the collapse;
- one-to-many mappings are always ambiguous;
- unmapped values remain unchanged unless the user explicitly chooses a replacement.

**Output:** mapping entries with source, target, evidence, confidence, and action.

### 10.6 Tool #5 — update matching

Tool #5 receives only unresolved candidate matches, not the whole workbook. Each candidate main row has a stable `main_row_id` and a bounded set of fields.

**Output:**

```json
{
  "matches": [
    {
      "current_row_id": "current-r-18",
      "candidate_main_row_ids": ["main-r-4", "main-r-11"],
      "selected_main_row_id": null,
      "match_type": "ambiguous",
      "confidence": 0.62,
      "reason": "same name but different email",
      "recommended_action": "human_review"
    }
  ]
}
```

The apply phase rejects any selected row ID not present in the candidate list. If multiple current rows map to the same main row, the UI requires an explicit conflict policy: merge, latest wins, keep both as new rows, or reject all.

---

## 11. API contract

All endpoints require a Cognito JWT. Every response includes `request_id`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/jobs` | Create a job configuration and return presigned upload instructions. |
| `POST` | `/v1/jobs/{job_id}/uploads/complete` | Confirm S3 upload and return file manifest. |
| `POST` | `/v1/jobs/{job_id}/start` | Validate configuration and start Step Functions execution. |
| `GET` | `/v1/jobs` | List current user’s jobs. |
| `GET` | `/v1/jobs/{job_id}` | Get status, counts, current review gate, and artifact links. |
| `GET` | `/v1/jobs/{job_id}/issues` | Paginated quality issues. |
| `GET` | `/v1/jobs/{job_id}/proposals` | Paginated AI proposals. |
| `POST` | `/v1/jobs/{job_id}/reviews` | Submit a review revision with accept/reject/edit decisions. |
| `POST` | `/v1/jobs/{job_id}/cancel` | Cancel a running job if the current state allows it. |
| `GET` | `/v1/jobs/{job_id}/artifacts/{artifact_type}` | Return a short-lived presigned download URL. |
| `GET` | `/health` | Liveness endpoint without sensitive details. |

### Review submission requirements

The review request includes:

- `job_id`;
- expected `revision`;
- decisions keyed by proposal/issue ID;
- optional edited values;
- explicit `approved_by` from the authenticated subject;
- optional reason for rejection or manual override.

The backend uses a conditional DynamoDB update on `revision`. A stale browser receives `409 REVIEW_REVISION_CONFLICT` and must reload.

---

## 12. Frontend specification

### 12.1 Pages

1. **Sign in** — Cognito-hosted or embedded Cognito form.
2. **Job creation** — upload current file, prompt, output header, standardize/update checkboxes, main file, sheet/key selectors.
3. **Job progress** — state timeline, counts, errors, refresh/polling.
4. **Quality review** — issue table with filters, row preview, proposal editor, bulk actions.
5. **Transformation review** — mappings, update matches, formula preview, conflict resolution.
6. **Result** — download links, summary counts, audit summary, job metadata.

### 12.2 Frontend safeguards

- Disable Start until all required uploads and fields are valid.
- Display the exact output policy before starting.
- Never show an “AI accepted automatically” label; show `proposed`, `human accepted`, `human edited`, or `human rejected`.
- Use pagination and virtualized tables for issue lists.
- Escape cell values to prevent spreadsheet-like formula injection in the browser preview.
- Treat CSV-like strings beginning with `=`, `+`, `-`, or `@` as dangerous when displayed/exported.
- Poll job status with exponential backoff; do not call the API continuously.
- Preserve review state locally only as a convenience; the server is authoritative.

---

## 13. Backend implementation specification

### 13.1 FastAPI responsibilities

- authenticate the Cognito subject from API Gateway claims;
- validate job configuration;
- create S3 presigned upload URLs;
- create and read DynamoDB metadata;
- start and cancel Step Functions executions;
- accept review decisions with optimistic concurrency;
- return short-lived download URLs;
- never perform long workbook processing synchronously in an HTTP request.

### 13.2 Worker responsibilities

Each worker should have one clear responsibility and a bounded timeout:

- `inspect_worker`: download and inspect workbook;
- `quality_worker`: run deterministic checks;
- `bedrock_worker`: dispatch one approved tool contract at a time;
- `apply_worker`: apply only approved changes;
- `validate_worker`: reopen and reconcile output;
- `artifact_worker`: generate summary documents if needed.

All workers must be idempotent. Before writing an artifact, check whether the expected object already exists with the same input hash and prompt/rule version.

### 13.3 OpenPyXL rules

- Use `read_only=True` for inspection where compatible.
- Use `data_only=False` when preserving formulas.
- Write to a new output path, never over the input path.
- Preserve sheet names and header order unless a reviewed proposal changes them.
- Use explicit cell coordinates in audit events.
- Reopen output after saving.
- Treat formulas as formulas, not as trusted executable code.
- Strip or reject external links and unsupported workbook features during validation.

---

## 14. Security, privacy, and operational constraints

### 14.1 Identity and access

- Cognito JWT authorizer on API Gateway.
- Job ownership checked on every read, write, and artifact URL request.
- Separate IAM roles for API, inspection workers, transformation workers, Step Functions, and deployment.
- Bedrock permissions scoped to the selected model/inference profile, not `bedrock:*`.
- S3 access scoped to `jobs/<job_id>/*` through application-generated policies where practical.
- No long-lived AWS access keys in the frontend.

### 14.2 Encryption and logging

- TLS for all network calls.
- S3 server-side encryption.
- DynamoDB encryption at rest.
- CloudWatch log retention set to 7–14 days for the demo.
- Do not log raw rows, workbook content, prompts containing sensitive values, or full model responses.
- Log hashes, IDs, counts, schema summaries, and redacted samples only.
- CloudTrail enabled for data-plane audit where available and affordable.

### 14.3 Prompt/data minimization

The AI prompt should contain only the minimum evidence needed:

- headers and type summaries;
- bounded samples;
- stable row/cell IDs;
- candidate values for matching;
- no complete workbook unless explicitly required and approved.

Sensitive values should be masked or tokenized where semantics can still be inferred. The demo must include a visible warning that uploaded workbooks are sent to Amazon Bedrock for the enabled AI steps.

### 14.4 Formula and content security

Never write user/model-provided strings into a cell as a formula unless the user explicitly approved the formula proposal. For ordinary text values, prefix dangerous leading characters when the output policy requires formula-injection protection, and record that escaping in the audit report.

---

## 15. Budget plan — USD 350 cap

The budget is a hard operational guardrail, not a promise of a specific AWS invoice. Exact Bedrock cost depends on model, tokens, and workbook size, so the demo must measure usage and stop or warn before the cap.

| Category | Planning cap | Controls |
|---|---:|---|
| Bedrock inference | $140 | Low-cost non-Marketplace model; bounded samples; explicit `maxTokens`; one call per tool where possible; cache by input hash; no provisioned throughput. |
| Lambda, API Gateway, Step Functions | $35 | On-demand only; short timeouts; no idle servers; Standard workflow only for active jobs. |
| S3, DynamoDB, CloudWatch | $25 | On-demand DynamoDB; lifecycle cleanup; short log retention; small manifests in DynamoDB. |
| Cognito, CloudFront, KMS, data transfer | $20 | One demo environment; CloudFront only if needed; no NAT Gateway; no cross-region replication. |
| Safety reserve | $130 | Unexpected inference, retries, testing, and deployment costs. |
| **Total** | **$350** | Hard cap enforced through usage policy and AWS Budgets. |

Required budget controls:

- AWS Budget alerts at $175, $280, and $330.
- Application-level maximum jobs per day for the demo.
- Maximum workbook rows, samples per column, candidate matches, and model tokens.
- Bedrock model allowlist excluding Marketplace-dependent models.
- Retry budgets per tool.
- A `COST_GUARD_REACHED` status that stops new AI calls and asks the user to retry after budget review.
- Destroy-demo script to remove S3 objects, DynamoDB table, CloudWatch log groups, Step Functions executions, and other non-retained resources.

Do not provision RDS, OpenSearch, NAT Gateway, ECS always-on services, provisioned DynamoDB capacity, provisioned Bedrock throughput, or Marketplace models in this demo.

---

## 16. Testing and verification plan

### 16.1 Unit tests

- header normalization;
- row fingerprinting;
- duplicate detection;
- blank row/column detection;
- type inference;
- formula allowlist;
- row-key matching;
- mapping application;
- update conflict handling;
- DynamoDB conditional revision updates;
- Pydantic schema rejection of malformed AI outputs.

### 16.2 Integration tests

- presigned upload and ownership checks;
- Step Functions start and callback gates;
- S3 artifact creation;
- Bedrock adapter with a recorded fake response;
- OpenPyXL save/reopen validation;
- retry and failure state transitions;
- stale review revision returns HTTP 409;
- duplicate job start does not create a second execution.

### 16.3 End-to-end fixture

The sample current workbook must contain at least:

- two exact duplicate rows;
- one completely blank row;
- one blank column;
- a date column with two formatting variants and one invalid value;
- a Boolean-like column with `Y`, `Yes`, `N`, `No`, and blank;
- an identifier column with leading zeros;
- one row that matches the main workbook exactly;
- one row requiring normalization;
- one ambiguous match;
- one current row duplicated against the same main row;
- one unmapped standardization value;
- one formula-based new-column example.

The expected result workbook must be checked into `sample-data/expected-result.xlsx` and compared by semantic cell assertions rather than raw binary equality.

### 16.4 Demo acceptance checklist

- [ ] User can sign in.
- [ ] User can upload current XLSX through the browser.
- [ ] Main file requirement is enforced.
- [ ] Job starts and shows progress.
- [ ] Structural errors are detected without an LLM.
- [ ] Tool #1 produces a semantic interpretation.
- [ ] Human can accept/edit/reject quality proposals.
- [ ] Tool #2 proposes type normalization.
- [ ] Tool #3 formula is syntax-checked before approval.
- [ ] Tool #4 displays standardization mappings.
- [ ] Tool #5 displays exact, ambiguous, duplicate, and unmatched row cases.
- [ ] Human can approve or reject standardize/update.
- [ ] Final workbook opens successfully.
- [ ] Source workbooks remain unchanged.
- [ ] Audit report reconciles all changes.
- [ ] Failed jobs are understandable and retryable where safe.
- [ ] Budget alerts and cleanup script exist.

---

## 17. Seven-day delivery plan for three people

### Roles

**Frontend Engineer (FE)**

- React/Vite application;
- upload and job configuration flow;
- progress and review screens;
- API client and Cognito integration;
- browser-level tests and demo polish.

**Backend Engineer (BE)**

- FastAPI API;
- S3/DynamoDB integration;
- Step Functions state machine;
- Lambda packaging and OpenPyXL pipeline;
- infrastructure, IAM, deployment, observability, and integration tests.

**AI Engineer (AI)**

- Bedrock model preflight and adapter;
- five prompt/tool contracts;
- Pydantic response schemas and guardrails;
- evaluation fixtures and confidence thresholds;
- AI cost controls and failure handling.

### Day 1 — Contract, repository, and cloud skeleton

**FE**

- Create Vite + React + TypeScript app.
- Build route shell and basic layout.
- Define shared frontend types for `Job`, `Issue`, `Proposal`, `ReviewRevision`, and `Artifact`.
- Build static job-creation form with current file, prompt, output header, standardize/update toggles, and main file.

**BE**

- Create Python project and FastAPI skeleton.
- Define domain enums, job configuration schema, state transitions, and error codes.
- Create SAM template for S3, DynamoDB, Lambda, API Gateway, Step Functions, and Cognito placeholders.
- Create S3 prefix and DynamoDB key design.
- Write region preflight script and deployment README.

**AI**

- Select a non-Marketplace Bedrock model strategy and create model preflight check.
- Define shared JSON response envelope and Pydantic schemas.
- Draft prompt contracts for Tools #1–#5.
- Create redaction rules and bounded-sample policy.

**End-of-day exit criteria**

- Repository builds locally.
- Configuration schema rejects missing main file when required.
- AWS service names and region parameter are fixed.
- Every tool has an input/output contract, even if implementation is stubbed.

### Day 2 — Uploads, metadata, deterministic inspection

**FE**

- Implement Cognito sign-in path or test-user sign-in configuration.
- Connect job creation form to `POST /v1/jobs`.
- Implement presigned upload progress for current and main files.
- Add sheet selection after upload metadata is returned.

**BE**

- Implement authenticated FastAPI routes for job creation and presigned S3 uploads.
- Implement upload completion verification, file hashing, size/type checks, and DynamoDB job records.
- Implement OpenPyXL inspection worker and inspection manifest.
- Add duplicate, blank-row, blank-column, and type-distribution rules.
- Add S3 and DynamoDB unit tests.

**AI**

- Implement Bedrock Runtime client with adaptive retry, explicit token limits, model allowlist, and structured-output parsing.
- Implement Tool #1 adapter with fake-response tests.
- Create the sample current/main workbook fixtures.

**End-of-day exit criteria**

- An uploaded workbook produces an inspection manifest and deterministic quality report.
- The backend never sends workbook bytes through API Gateway.
- Tool #1 can run against fixture data using a fake model response.

### Day 3 — Orchestration and first human review gate

**FE**

- Implement job-progress screen with state timeline and polling.
- Implement quality-review table and issue filters.
- Add row/cell preview and Accept/Reject/Edit controls.

**BE**

- Implement Step Functions Standard workflow through `QUALITY_REVIEW_PENDING`.
- Add callback/task-token mechanism for the first human gate.
- Implement review revision endpoint with optimistic concurrency.
- Persist issues and proposals as paginated DynamoDB/S3 artifacts.
- Add retry, timeout, cancellation, and failure states.

**AI**

- Implement Tool #2 type normalization.
- Implement response validation against known row IDs, headers, and allowed target types.
- Add confidence bands and manual-review rules.
- Add token/cost measurements to structured logs.

**End-of-day exit criteria**

- A user can upload, start, wait for inspection, view detected issues, and submit the first review gate.
- The workflow resumes only after a valid review revision.
- Tool #2 proposals preserve original values.

### Day 4 — Formula tool and transformation proposal engine

**FE**

- Implement formula review panel with formula text, referenced columns, and syntax-check status.
- Implement standardization mapping table and mapping decision controls.
- Improve loading/error/empty states.

**BE**

- Implement formula allowlist and verifier.
- Implement OpenPyXL copy-and-apply layer for accepted quality/type changes.
- Implement canonical main-file loader and deterministic exact matching.
- Wire Tool #3 and Tool #4 states into Step Functions.

**AI**

- Implement Tool #3 formula generation with strict output schema.
- Implement Tool #4 standardization mapping with candidate allowlist.
- Build prompt fixtures for many-to-one, one-to-many, and unmapped values.
- Add malformed-output, hallucinated-header, and forbidden-formula tests.

**End-of-day exit criteria**

- Formula proposals are validated before display.
- Standardization proposals cannot invent canonical values.
- Accepted quality changes can be applied to a copy and reopened successfully.

### Day 5 — Update matching and second human review gate

**FE**

- Implement update match table with exact, normalized, ambiguous, duplicate, conflict, and unmatched badges.
- Implement bulk review actions with confirmation.
- Implement final transformation review summary.

**BE**

- Implement Tool #5 candidate generation and update apply logic.
- Add duplicate-main-row protection and conflict policies.
- Implement second Step Functions approval gate.
- Implement output artifact generation and presigned download links.
- Add audit event persistence for every decision.

**AI**

- Implement Tool #5 unresolved-match prompt and schema validation.
- Ensure model can only choose from candidate main row IDs.
- Add evaluation set with exact, fuzzy, ambiguous, duplicate, and no-match cases.
- Tune thresholds so ambiguous cases are routed to humans.

**End-of-day exit criteria**

- Both standardization and update paths can be reviewed.
- Duplicate current rows targeting one main row are blocked until a conflict policy is selected.
- Every human decision is auditable.

### Day 6 — Full integration, security, and budget controls

**FE**

- Complete result page and downloads.
- Add refresh/reconnect behavior for in-progress jobs.
- Add browser validation for formula-injection-looking values.
- Run end-to-end UI flow against the deployed API.

**BE**

- Deploy to the selected AWS region.
- Add API throttling, S3 lifecycle, DynamoDB TTL, CloudWatch alarms, and log retention.
- Verify IAM least privilege and private S3 access.
- Add output reopen/reconciliation validation.
- Add AWS Budgets instructions and cost guardrail configuration.

**AI**

- Run full fixture evaluation against real Bedrock calls with capped samples.
- Measure average tokens and latency per tool.
- Add cached responses by input hash for repeat demo runs.
- Confirm no Marketplace model or subscription is required.

**End-of-day exit criteria**

- Full path works in the deployed environment from login through download.
- Cost controls are visible and tested.
- Security review has no open critical issue.

### Day 7 — Hardening, rehearsal, and handoff

**FE**

- Fix usability issues found in the rehearsal.
- Add clear explanations for each issue type and review action.
- Package the demo runbook with screenshots or a short deterministic script.

**BE**

- Run failure/retry/cancel/stale-review tests.
- Verify source files are unchanged after all output modes.
- Verify cleanup script and redeploy instructions.
- Freeze API contract and tag the demo release.

**AI**

- Validate prompt versions and response schemas are pinned.
- Run adversarial tests for invented row IDs, unsupported formulas, empty responses, and contradictory mappings.
- Produce a short model-quality report with known limitations.

**Joint final demo**

- Demonstrate neither, standardize only, update only, and both selected.
- Demonstrate at least one accepted, rejected, edited, ambiguous, and failed case.
- Show final XLSX, JSON audit, review summary, CloudWatch logs, and cost guardrails.

**Day-7 definition of done**

- All acceptance checklist items in Section 16 are checked.
- A new developer can deploy the demo from the README.
- A reviewer can trace any final cell change back to a rule, AI proposal, and human decision.

---

## 18. Work ownership and handoff matrix

| Deliverable | FE | BE | AI | Required handoff |
|---|---|---|---|---|
| Shared API/domain types | R | A | C | BE publishes OpenAPI/schema; FE consumes it. |
| Upload flow | R | A | I | BE provides presigned URL contract. |
| Workbook inspection | I | A/R | C | BE publishes inspection manifest shape; AI uses bounded samples. |
| Rule engine | I | A/R | C | AI reviews semantic/type fields but BE owns deterministic findings. |
| Tool #1–#5 | I | C | A/R | AI publishes versioned schemas and fixtures; BE owns invocation boundary. |
| Review gates | R | A/R | C | FE renders proposal states; BE enforces state transitions. |
| OpenPyXL transformation | I | A/R | C | AI defines proposal meaning; BE applies only accepted actions. |
| Infrastructure/IAM | I | A/R | C | AI supplies exact Bedrock permissions/model IDs. |
| E2E demo | R | R | R | All three sign off. |

R = Responsible, A = Accountable, C = Consulted, I = Informed.

---

## 19. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bedrock model unavailable in selected region | Workflow cannot call AI | Region preflight, model allowlist, deploy parameter, clear fallback/error. |
| Model requires Marketplace subscription | Violates constraint and may incur charges | Allowlist only models verified as non-Marketplace; fail deployment if model metadata is not approved. |
| LLM invents headers, row IDs, or values | Incorrect workbook | Candidate allowlists, Pydantic validation, deterministic IDs, human approval. |
| Formula injection or unsafe formula | Security/data-integrity issue | Formula allowlist, external-link rejection, human review, output validation. |
| Large workbook times out | Failed demo | Hard size/row limit, preflight rejection, Fargate as later scale path. |
| Duplicate update matches same main row | Data corruption | Conflict state, explicit user-selected policy, no silent overwrite. |
| Stale browser review | Lost decisions | DynamoDB revision condition and HTTP 409 reload flow. |
| Bedrock cost exceeds budget | Budget breach | Token caps, sample caps, caching, daily job limit, budget alarms, cost guard state. |
| OpenPyXL changes unsupported workbook features | Output corruption | Restrict file types/features, copy to new object, reopen and validate, show limitations. |
| Sensitive data appears in logs/prompts | Privacy exposure | Redaction, bounded samples, short log retention, no raw payload logging. |
| Human reviewer misunderstands proposal | Wrong approval | Show evidence, before/after values, reason, confidence, and explicit action labels. |

---

## 20. Final implementation decisions

1. Use a single selected AWS region per environment; default to `us-east-1`.
2. Use Amazon S3 for all workbook and artifact storage.
3. Use DynamoDB on-demand for job metadata, review revisions, and audit pointers.
4. Use FastAPI on Lambda behind API Gateway HTTP API.
5. Use Step Functions Standard for orchestration and human approval pauses.
6. Use Amazon Bedrock Runtime Converse API for Tools #1–#5.
7. Use only a verified non-Marketplace model and resolve the exact model/inference-profile ID during deployment.
8. Use OpenPyXL for deterministic workbook inspection, transformation, and output validation.
9. Run deterministic rules before LLM interpretation.
10. Treat every AI result as an untrusted proposal.
11. Require two explicit human review gates.
12. Never modify source workbooks in place.
13. Enforce size, row, token, retry, and daily-job limits to remain under USD 350.
14. Deliver the final workbook and audit artifacts only after successful reopen/reconciliation validation.

