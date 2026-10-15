# AI Engineer — Plan

> Role-specific extract of `xlsx-data-workflow-demo-plan.md`. That file is the source of truth; section numbers below (§) point into it. Stack: **Amazon Bedrock Runtime Converse API, Pydantic**.

## Responsibilities

- Bedrock model preflight + adapter.
- Five prompt/tool contracts (#1–#5).
- Pydantic response schemas and guardrails.
- Evaluation fixtures and confidence thresholds.
- AI cost controls and failure handling.

## Core stance

**Every AI result is an untrusted proposal.** The model never executes code and never mutates data. Each tool returns JSON validated against a Pydantic schema; unknown row IDs / headers / canonical values / unbounded formulas are rejected. Models may only **select** from candidate IDs supplied in the prompt — never invent them. Deterministic rules (§9) run first; AI supplements interpretation, it does not replace validation.

## Shared AI safety rules (§10.1)

- Bedrock Runtime **Converse API** from Python.
- Resolve + verify model ID / inference profile at **deploy time** (preflight) — do not hardcode an outdated ID. Prefer a **non-Marketplace Amazon model** available in the selected region.
- Set `maxTokens` explicitly on every call; low temperature for classification/mapping.
- Require JSON output matching a Pydantic schema; validate all enums, row IDs, column names, ranges, lengths.
- Reject outputs with unknown row IDs/headers, executable code, or unbounded formulas.
- Retry **only transient service errors** — never validation or access-denied.
- Log model ID, prompt version, input hash, output hash, latency, token counts — **never** raw sensitive cell contents.
- Use redacted samples + deterministic IDs in prompts.

## Prompt / data minimization (§14.3)

Prompt carries only the minimum evidence: headers + type summaries, bounded samples, stable row/cell IDs, candidate values for matching. **No complete workbook** unless explicitly required and approved. Mask/tokenize sensitive values where semantics can still be inferred. (The demo shows a visible warning that workbooks are sent to Bedrock.)

## The five tools (§10)

### Tool #1 — semantic verification (§10.2)
Input: `comment_name`, requested output header, current + normalized headers, main headers (when available), column type summaries, bounded sample values + evidence cell IDs, job config + prompt version.
Output: `meaning`, `existing_column_matches[]` (column_id, confidence, reason), `recommended_output_header`, `interpretation`, `confidence`, `status` (`confirmed|ambiguous|not_found`), `questions_for_human[]`.
**Cannot create values** — only verifies meaning + identifies candidate source columns. UI must show evidence.

### Tool #2 — mismatched-type normalization (§10.3)
Input: one flagged column, representative values, inferred type distribution, requested target type, preservation constraints.
Output: `column_id`, `target_type`, `proposals[]` each `{row_id, original, normalized, confidence, status: safe|ambiguous|reject, reason}`.
Backend **re-parses the normalized value with Python** before it can be accepted; original value always retained in audit. Any loss of precision / leading zeros / timezone / meaning → `manual_review` (the rule engine proposes the target type; Tool #2 decides safety — §9.4).

### Tool #3 — formula generation (§10.4) — optional
Only used when the user selects a formula-based new column.
Input: comment meaning, source headers, allowed functions, sample rows, expected output type.
Output: `formula_template`, `target_header`, `expected_type`, `referenced_headers[]`, `explanation`, `confidence`.
Verification (done by BE, but design to it): allowlist functions, validate references in-range, row expansion, lightweight test against fixture rows; **no** external links / macros / `WEBSERVICE` / `HYPERLINK` / `INDIRECT` / `OFFSET` / volatile. Labeled "syntax verified," never "calculated."

### Tool #4 — standardization mapping (§10.5)
Maps current headers/values → canonical main-file representation.
Constraints: candidate canonical values **supplied in the prompt**; model **cannot invent** a canonical value; many-to-one allowed only when user sees the collapse; one-to-many is always `ambiguous`; unmapped values stay unchanged unless the user picks a replacement.
Output: entries with source, target, evidence, confidence, action (one-to-one / many-to-one / unmapped; safe / ambiguous / rejected).

### Tool #5 — update matching (§10.6)
Receives only **unresolved candidate matches**, not the whole workbook. Each candidate main row has a stable `main_row_id` + bounded fields.
Output: `matches[]` each `{current_row_id, candidate_main_row_ids[], selected_main_row_id, match_type, confidence, reason, recommended_action}`.
Matching order (§6 State 10): exact on approved key → normalized exact → **LLM-assisted composite only for unresolved rows** → human review for duplicate/conflict/low-confidence. Apply phase **rejects any selected row ID not in the candidate list**. Duplicate current rows → same main row requires an explicit conflict policy (merge / latest wins / keep both / reject all).

## Model preflight (§7.1, §19)

Deploy-time check: selected Bedrock model/inference profile is available in the region; **not Marketplace-dependent** (fail deployment if model metadata isn't on the approved allowlist); account has invoke permission. Supply exact Bedrock permissions + model ID to BE for IAM scoping (§18).

## Budget — Bedrock inference ($140 cap, §15)

Low-cost non-Marketplace model; bounded samples; explicit `maxTokens`; **one call per tool** where possible; **cache by input hash**; no provisioned throughput. Honor the `COST_GUARD_REACHED` stop state. Retry budgets per tool. Caps on rows, samples/column, candidate matches, and tokens.

## Day-by-day

- **Day 1** — Select non-Marketplace model strategy + model preflight check; shared JSON response envelope + Pydantic schemas; draft prompt contracts for Tools #1–#5; redaction rules + bounded-sample policy.
- **Day 2** — Bedrock Converse client (adaptive retry, explicit token limits, model allowlist, structured-output parsing); Tool #1 adapter with fake-response tests; create sample current/main workbook fixtures.
- **Day 3** — Tool #2 normalization; response validation against known row IDs/headers/allowed target types; confidence bands + manual-review rules; token/cost measurements in structured logs.
- **Day 4** — Tool #3 formula generation (strict schema); Tool #4 standardization with candidate allowlist; prompt fixtures for many-to-one / one-to-many / unmapped; malformed-output, hallucinated-header, forbidden-formula tests.
- **Day 5** — Tool #5 unresolved-match prompt + schema validation; ensure model can only pick candidate main row IDs; evaluation set with exact / fuzzy / ambiguous / duplicate / no-match; tune thresholds so ambiguous → humans.
- **Day 6** — Full fixture evaluation against **real** Bedrock with capped samples; measure avg tokens + latency per tool; cache responses by input hash for repeat runs; confirm no Marketplace model/subscription required.
- **Day 7** — Validate prompt versions + response schemas are pinned; adversarial tests (invented row IDs, unsupported formulas, empty responses, contradictory mappings); short model-quality report with known limitations.

## E2E fixture you build (§16.3)

Sample current workbook must contain: two exact duplicate rows; one blank row; one blank column; a date column with two formatting variants + one invalid value; a Boolean-like column (`Y`/`Yes`/`N`/`No`/blank); an identifier column with leading zeros; one row matching main exactly; one requiring normalization; one ambiguous match; one current row duplicated against the same main row; one unmapped standardization value; one formula-based new-column example. Expected result → `sample-data/expected-result.xlsx`, compared by **semantic cell assertions**, not binary equality.

## Testing you own (§16.1)

Formula allowlist; Pydantic schema rejection of malformed AI outputs; (contribute to) type inference, row-key matching, mapping application, update conflict handling.

## Handoffs (§18)

- Tools #1–#5: **AI publishes versioned schemas + fixtures; BE owns the invocation boundary** (one tool per call, validate before apply).
- Inspection: AI consumes BE's bounded samples from the inspection manifest.
- Rule engine: BE owns deterministic findings; AI consulted on semantic/type fields only.
- Infra/IAM: AI supplies exact Bedrock permissions + model IDs to BE.
