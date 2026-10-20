# ADR 0002: Backend completion for Days 5–7

## Status

Accepted for the demo implementation.

## Context

Days 1–4 established upload integrity, workbook inspection, deterministic quality
rules, review revisions, formula verification, standardization foundations, and
three short Step Functions execution segments. The remaining backend work was
Tool #2 workflow integration, Tool #5 update matching, output-policy-aware apply,
artifact downloads, auditability, and deployment verification.

## Decisions

### 1. Tool #2 runs before the first review gate

The deterministic quality worker identifies type mismatches. Tool #2 is invoked
only when that report contains type-mismatch issues. Its validated rules are
stored as a proposal and reviewed together with the deterministic issues and
Tool #1 semantic proposal. Tool #2 does not create an additional human gate.

### 2. Tool #5 receives bounded candidates only

The backend performs exact and normalized key matching first, then creates a
small recall-biased candidate set using key blocking and a simple similarity
score. At most `max_candidate_matches` candidates are sent to Bedrock. The model
may select only an ID from that set or return `unmatched`.

### 3. Review decisions are item-addressable

Tool #2 rules and Tool #5 matches receive stable item IDs derived from the
proposal ID and item index. A review can therefore accept or reject one rule or
one update match without implicitly approving every item in the proposal.

### 4. Output policy selects the immutable base workbook

The source objects are never modified. `standardize_only` and `neither` start
from the current/input workbook. `update_only` starts from the main workbook.
`both` first creates an in-memory standardized current workbook and then applies
approved updates to a new main-workbook copy. Unmatched current rows are skipped
for the demo; insertion is future work.

### 5. Artifacts are private and downloaded through short-lived URLs

The API verifies job ownership and returns a presigned S3 GET URL only for
allowlisted artifact types belonging to that job. Artifact contents are not
proxied through API Gateway.

### 6. Review persistence is durable before workflow restart

The review JSON is written to S3 before the conditional DynamoDB job update.
Only the winning conditional update starts the next Step Functions segment. A
stale review may leave an orphaned S3 object, which is recoverable by the
configured lifecycle policy; it must never leave a dangling DynamoDB pointer.

### 7. Audit output contains decision-level records

Every accepted, rejected, edited, or ignored review item is represented in the
change report with its decision, reason, proposal/issue ID, and resulting
mutation or skip status. A compact `EVENT#decision#...` record is also written
to the job partition for operational history. Raw model prompts and responses
remain outside DynamoDB and are not written to logs.

## Consequences

The backend can complete all four output policies without mutating uploaded
objects, and the frontend can render individual review items. Tool #5 remains a
bounded-assistance tool: it cannot invent row IDs or inspect the entire main
workbook. The demo deliberately skips unmatched inserts and does not calculate
Excel formulas; validation reports syntax verification only.
