# Session log — AI Engineer (Days 1–7)

Branch: `ai`. Stack: Bedrock Runtime Converse API + Pydantic. Every tool output is an
untrusted proposal validated at a trust boundary; the model never executes code.

**Status:** Days 1–7 complete. Backend suite green (73 passed). Tools #1–#5 tested against real Bedrock and passing 5/5 on a fresh run ($0.0024); cache, preflight, eval harness, pin-guard + adversarial tests in place.

## Day 1 — contracts & guardrails
- Shared response envelope: `ToolResult[T]` + Python-computed `AuditMeta` (`schemas.py`).
- Pydantic schemas for all five tool outputs.
- Five v1 draft prompt contracts under `app/prompts/` + versioned `get_prompt` loader.
- AI-safety policy (`policy.py`): sample caps, `safe_log` allowlist, shape-preserving `redact_sample`.
- Model strategy: Nova Lite (`bedrock_model_id`) for Tools #1/#2, Nova Pro (`..._heavy`) for #3/#4, both pinned in `settings` and enforced by `MODEL_ALLOWLIST`.
  - Deferred: the deploy-time preflight *script* (region availability / non-Marketplace check) — allowlist guard is in place, script not yet written.

## Day 2 — Bedrock client + Tool #1
- `BedrockClient.converse_json` (`bedrock_client.py`): explicit `maxTokens`, low temp, adaptive-retry transient only, model-allowlist guard, JSON extracted from fenced/prose output. Returns `(parsed, raw, usage, latency_ms)`.
- Tool #1 semantic-verification adapter (`run_tool1`), tested with a fake Bedrock client.
- §16.3 sample current/main workbooks + manifest (`scripts/`).

## Day 3 — Tool #2 normalization
- `run_tool2`: render → call → schema-validate → reject off-allowlist target type → demote-only confidence floor → cost log.
- Per-call `estimate_cost_usd` helper + structured token/cost log line.
- (Originally per-cell `proposals[row_id]` — superseded Day 4 by ADR D4.)

## Day 4 — ADR D4 rework + Tools #3/#4
Spec: `docs/superpowers/specs/2026-10-16-ai-day4-design.md` · Plan: `docs/superpowers/plans/2026-10-16-ai-day4.md`
- **Shared `adapter.py`** — extracted the duplicated `render_prompt`/`sha256_hex` (rule-of-three); Tools #1/#2 refactored onto it. `CONFIDENCE_FLOOR` moved to `policy.py` (one source of truth for #2 and #4).
- **Tool #2 rework (ADR D4):** `proposals[row_id]` → `rules[pattern]` — one rule per distinct value-pattern, not per cell (per-cell blew `maxTokens` / $140 cap / review UI). BE applies each rule to every matching cell and re-parses in Python. The unknown-row_id check is gone; only the target-type allowlist remains. Log key `rule_count`.
- **Tool #3 formula adapter (`run_tool3`):** thin reject-whole guardrail — formula must start `=`, `referenced_headers ⊆ source_headers`, no forbidden function (`INDIRECT`/`OFFSET`/`WEBSERVICE`/`HYPERLINK`/volatile), matched as `TOKEN(` so a header like `Snowfall` doesn't trip `NOW`. Authoritative allowlist + range check stay on BE.
- **Tool #4 standardization adapter (`run_tool4`):** reject-whole if a `canonical_value` isn't in the supplied candidate allowlist (unmapped must be blank); demote one-to-many (same source → multiple canonicals) and `safe`-below-floor to `ambiguous`.

## Day 5 — Tool #5 unresolved-match adapter
Spec: `docs/superpowers/specs/2026-10-16-ai-day5-design.md` · Plan: `docs/superpowers/plans/2026-10-16-ai-day5.md`
- **Tool #5 adapter (`run_tool5`):** mirrors `run_tool4` — render → call → schema-validate → reject-whole → demote-only → cost log. Model is Nova Lite (`bedrock_model_id`): selecting among ~5 bounded candidates is structured, not heavy-reasoning work like formulas (#3/#4).
- **Reject-whole (invariant #1):** a `selected_main_row_id` outside that match's own `candidate_main_row_ids` → reject; a `match_type: unmatched` that still carries a selection → reject (contradiction). The model may only *select* a supplied candidate, never invent one.
- **Demote-only:** `ambiguous`/`duplicate`/`conflict` match types, or any match below `CONFIDENCE_FLOOR` (0.80), forced to `recommended_action: human_review`. Threshold *tuning* against real confidences is Day 6.
- **No schema/prompt/policy change:** `Tool5Match`/`Tool5Output` and `tool5_update.v1.md` existed from Day 1; `rule_count` already in `SAFE_LOG_FIELDS`.
- **Fake-Bedrock unit tests** (`test_ai_day5.py`, 8 cases): valid match, prompt render, malformed payload, un-offered selection, unmatched-with-selection, ambiguous demote, below-floor demote, cost log (`rule_count`, no raw field values).

## Day 6 — real-Bedrock eval, cache, preflight
Spec: `docs/superpowers/specs/2026-10-16-ai-day6-design.md` · Plan: `docs/superpowers/plans/2026-10-16-ai-day6.md`
- **`CachingBedrockClient` (`cache.py`):** drop-in wrapper over `converse_json`, disk-memoized by `sha256(model_id+prompt)` under `backend/.cache/bedrock/` (gitignored). Repeat eval/demo runs are free. Safe — a human reviews every result (ADR residual note). Offline hit/miss unit test.
- **`scripts/preflight.py`:** one minimal real `converse` per allowlisted model — proves invocable + entitled + non-Marketplace + SCP-clear. `list-foundation-models` is NOT authoritative in this account. This is the §7.1/§19 preflight BE needs for IAM scoping.
- **`scripts/eval_tools.py`:** runs all 5 tools against capped fixtures with the caching client; light invariant checks on real output (schema parsed, enums valid, demote applied, no off-candidate id); per-tool tokens/latency + Nova on-demand cost, **printed as a markdown table** (this log is the record — no separate docs file).
- **Measurements** (us-east-1, 1 case/tool, tool5 = 3 rows; total $0.0025, cached reruns free):

  | tool | model | in tok | out tok | latency ms | est $ | checks |
  |---|---|---:|---:|---:|---:|---|
  | tool1_semantics | nova-lite | 347 | 173 | 1533 | 0.000062 | 3 ✅ |
  | tool3_formulas | nova-pro | 243 | 245 | 2073 | 0.000978 | 3 ✅ |
  | tool4_standardize | nova-pro | 255 | 379 | 2026 | 0.001417 | 3 ✅ |

- **Findings (3/5 clean):** `tool2_types` SCHEMA FAIL (`rules[1].normalized_form` returned `null`; schema requires `str`); `tool5_update` PARSE FAIL (model emitted malformed JSON). Both are the guardrails working — bad output rejected at the trust boundary, never passed downstream. Not code bugs; Day-7 prompt-tuning targets.
- **Environment finding:** the Day-1 model config (bare `amazon.nova-lite-v1:0` / `-pro-v1:0`, us-east-1) is correct and unchanged. Cross-region inference-profile ids (`us.`/`apac.`) are poison here — they fan out to an SCP-denied region (`us-west-2`/`ap-southeast-2`). Run via `AWS_PROFILE=ChallengerAccess-453995432289 AWS_REGION=us-east-1`. Legacy `claude-3-*` are Marketplace-gated (forbidden). See `memory/bedrock-access-us-east-1-bare-ids.md`.
- **Still open for Day 7:** adversarial/accuracy scoring + `CONFIDENCE_FLOOR` tuning; fix tool2/tool5 prompts for the null-field and malformed-JSON findings; folding per-model cost into `estimate_cost_usd`. **BE:** no worker calls `run_toolN` yet — integration is BE Day 6.

## Open items / handoff to BE
- **Log schema:** Tools #2/#4 now emit `rule_count` (not `row_count`) — confirm BE log consumers.
- **Placeholders (flagged in-code):** `CONFIDENCE_FLOOR = 0.80`; `PRICE_PER_1K_*_USD = 0.0` (cost logs read $0.00 until real Nova pricing lands); Tool #3 `FORBIDDEN_TOKENS` volatile set.
- **AI-side guards are caution-only.** BE owns the real checks: Python re-parse of every normalized cell (§10.3) and the authoritative formula allowlist + in-range verifier (§10.4).
- **Tool #5 candidate generation (ADR D6):** the key-blocking + fuzzy top-~5 recall-biased step before the AI is plain-Python and **BE-owned** — `run_tool5` only consumes the supplied candidates. Per-match `candidate_main_row_ids` check is a caution guard; BE re-rejects off-candidate IDs at apply-time and owns the duplicate/conflict resolution policy. Unmatched current rows are **skipped** for the demo (ADR D7; insert is future work).
- **End-to-end integration gap:** no backend worker calls `run_toolN` yet — the adapters are a standalone, fake-Bedrock-tested library. Wiring them into a worker + the review gates is a BE task, not in the AI day plan.
- **Not done here:** ADR D1 (size caps for ~2,000-row working set) — a `settings`/`policy` value change, BE-owned.

## Verification completed
Full backend suite `python -m pytest` → **61 passed** (2 new offline cache tests). No real boto calls in any pytest. The live eval (`scripts/eval_tools.py`) ran real Bedrock in us-east-1 for $0.0025. Spec, plan, and implementation each committed separately on branch `ai`.

## Day 7 — wrap-up: prompt fixes, pin guard, adversarial tests, model-quality report
Spec: `docs/superpowers/specs/2026-10-16-ai-day7-design.md` · Plan: `docs/superpowers/plans/2026-10-16-ai-day7.md`

**Day-6 findings fixed (both were prompt issues, not code bugs):**
- **tool2_types** (`normalized_form` → `null`): the prompt never said what to put when a value can't be normalized, so Nova chose `null` and the strict `str` schema rejected the whole response. Fixed with one sentence: for a reject rule, `normalized_form` must be `""` (never null).
- **tool5_update** (malformed JSON = Python code): the prompt title "Update matching" read like a coding task to Nova Lite, which returned Python instead of JSON. Fixed by renaming the prompt to "Row matching analysis" and adding an up-front "return JSON only — no code, no prose" instruction. (So the Day-6 PARSE FAIL was the model emitting Python, caught by `_extract_json` — the guard working.)

**Fresh real-Bedrock run — 5/5 clean** (us-east-1, 1 case/tool, tool5 = 3 rows; total **$0.0024**, cached reruns free):

| tool | model | in tok | out tok | latency ms | est $ | checks |
|---|---|---:|---:|---:|---:|---|
| tool1_semantics | nova-lite | 347 | 173 | 1556 | 0.000062 | 3 OK |
| tool2_types | nova-lite | 379 | 435 | 2322 | 0.000127 | 3 OK |
| tool3_formulas | nova-pro | 243 | 239 | 3063 | 0.000959 | 3 OK |
| tool4_standardize | nova-pro | 255 | 292 | 2823 | 0.001138 | 3 OK |
| tool5_update | nova-lite | 467 | 265 | 1301 | 0.000092 | 3 OK |

**Pinning + adversarial tests** (`test_ai_day7.py`, +12 cases → suite 73 passed, all offline):
- **Pin guard** (×5 tools): `PROMPT_VERSION == "v1"`, the `prompts/<tool>.v1.md` file exists, and every `_FIELDS` name has a `{placeholder}` in the prompt (catches a field that would silently render unfilled, since `render_prompt` uses `str.replace`).
- **Adversarial gaps:** `_extract_json` rejects a response with no JSON object; an empty `{}` per tool raises Pydantic `ValidationError`. (The spec's "invented row_id" / "contradictory mapping" cases were already covered — Tool #2 is value-pattern rules with no row_id; Tool #4 one-to-many→ambiguous is Day-4 `test_run_tool4_one_to_many_demoted_to_ambiguous`.)

**Eval artifacts relocated:** `write_report` now writes `ai-eval-day7.{md,json}` to `backend/.cache/eval/` (under the already-gitignored `.cache/`), not `docs/`. This session log is the single committed, human-curated record — the standalone `docs/ai-model-quality.md` was folded in here and removed.

**Confidence-band behavior (unchanged, recorded for the report):**
- Every tool output is an untrusted proposal; nothing auto-applies. Two human review gates.
- `ambiguous` and sub-floor `safe` proposals are demoted to human review (Tools #2/#4/#5).
- Models may only *select* from candidate IDs/values in the prompt; invented IDs/headers/canonicals are rejected whole.

**Known limitations:**
- **Summary-row / column totals deferred** — row-wise formulas only.
- **Update mode skips unmatched rows** — insert deferred.
- **Formulas are syntax-verified, not calculated** — OpenPyXL does not evaluate.
- **Region-locked access** — cross-region inference profiles (`us.*`/`apac.*`) hit an org SCP deny; only bare us-east-1 Nova ids work here.

**Still open (not AI-day work):** `CONFIDENCE_FLOOR`/pricing placeholders stay until real tuning + Nova pricing land; BE integration — no worker calls `run_toolN` yet.

## QuickSight / Analytics session — 2026-10-22

### Environment discovered
- QuickSight account: `453995432289`, identity region `ap-southeast-1` (us-east-1 calls fail with `AccessDeniedException` pointing here).
- AWS profile: `ChallengerAccess-453995432289` (not `ChallengerAccess` — old name).
- QuickSight edition: Enterprise. Service role: `aws-quicksight-service-role-v0`.
- Registered new user `karitt.tha@gmail.com` as ADMIN (was not in the user list; `Active: false` until first console login).

### S3 → QuickSight integration: resolved 2026-10-23
`create-data-source` (type S3, manifest) now works. Root cause and fix:
- **Root cause:** QuickSight maintains an internal S3 integration flag separate from the IAM service role policy. The flag was not initialized — the service role policy (`QuickSightS3AccessPolicyPai`) existed but QuickSight's own feature registry had never been activated.
- **Fix:** QuickSight console → Admin → **AWS resources** ("Allow connections to first-party services") — opening this page initializes the S3 integration flag. After that, `create-data-source` succeeds immediately.
- **Note:** IAM permissions and bucket policy were correct throughout. The `qs-bucket-policy.json` (service principal policy) was added but is not strictly necessary once the AWS resources page is visited.

**S3 data source:** `qa-s3-7f32316e` → dataset `qa-issues-s3-76bde119` (108 rows, SPICE). Pipeline in `scripts/demo_quicksight_pipeline.py` updated to use this dataset.

### What was built
| Artifact | Location | Description |
|---|---|---|
| `scripts/flatten_quality_reports.py` | repo | Collects all `quality/quality-report.json` from S3, flattens to one CSV row per issue, uploads to `quicksight/quality-issues.csv` |
| `scripts/flatten_inspections.py` | repo | Collects all `inspection/manifest.json`, flattens to one CSV row per column per job (name, type, blank rate) — written, not yet run |
| `scripts/demo_quicksight_pipeline.py` | repo | End-to-end demo: flatten → upload CSV to S3 → `create-ingestion` on S3-backed dataset |
| `scripts/qs-manifest.json` | repo | QuickSight S3 manifest (HTTPS regional URI format) |
| `quicksight/quality-issues.csv` | `xlsx-workflow-demo-453995432289` S3 | 108 issues across 27 jobs |
| `quicksight/manifest.json` | `xlsx-workflow-demo-453995432289` S3 | Manifest pointing at quality-issues.csv |

**QuickSight resources:**
- S3 data source: `qa-s3-7f32316e`
- S3-backed dataset: `qa-issues-s3-76bde119` (108 rows, SPICE) — used by `demo_quicksight_pipeline.py`
- Athena data source: `qs-athena` (workgroup: primary, results: `test-probe-453995432289/athena-results/`)
- Athena-backed dataset: `qs-quality-athena` (108 rows, SPICE) — Glue table: `excelbridge.quality_issues`
- File-upload dataset: `ad7043d8-6f59-4254-95fa-ab5571ce0908` ("QA report") — stale, superseded by S3-backed dataset
- Glue database: `excelbridge`; Glue table: `quality_issues` → `s3://xlsx-workflow-demo-453995432289/quicksight/`

**Ground-truth numbers (108 rows as of 2026-10-23):**
- Total issues: 108 · Jobs with issues: 27
- By kind: duplicate_rows 42, type_mismatch 24, blank_column 24, blank_row 18
- By action: keep_first_delete_later 42, manual_review 24, exclude_from_input 24, delete 18

### Next steps
1. **QuickSight embedding** — publish dashboards and add authenticated dashboard embedding after row-level security maps dashboard rows to the app user. Anonymous embedding is unsafe because the flattened datasets aggregate all jobs in the bucket.

### Quick integration follow-through — 2026-10-23
- Added `backend/app/services/quicksight_pipeline.py` to flatten primary and `input_2`–`input_8` quality/inspection artifacts. Both CSVs always write headers, including when there are no rows.
- Added a buffered S3 EventBridge → SQS → Lambda refresh path in `infra/template.yaml`. Events batch for up to 60 seconds; a Quick ingestion conflict leaves the SQS event for retry.
- Added `scripts/qs-inspections-manifest.json` and refreshed the manual demo pipeline to use the same multi-slot flattening logic.
- Deployed to `xlsx-workflow-demo` in us-east-1 using the `finpilot` SSO profile; Quick resources remain in ap-southeast-1. The stack now has the EventBridge rule, SQS queue/DLQ, and refresh Lambda.
- Extended quality dataset `qa-issues-s3-76bde119` with `input_slot`; created S3 source `qa-inspections-source-76bde119` and dataset `qa-inspections-s3-76bde119`.
- A live invocation with a real four-input job exposed that Quick `ListIngestions` has no resource-level IAM scope. The Lambda now relies on Quick's dataset-scoped `CreateIngestion` response and SQS retry instead of account-wide listing permission; the external Lambda role grant is scoped to the two dataset ingestion ARN patterns.
- The first inspection dataset ingestion failed because the CSV did not exist yet. The deployed worker then published both CSVs and both new SPICE ingestions completed successfully.
- Live refresh result: 56 quality reports → 154 rows and 56 inspection manifests → 424 rows. For four-input job `ffe13591-8570-4ab9-9117-edf19b075865`, the quality CSV has rows in `input`/`input_2`/`input_3`/`input_4`; inspection has 8 rows per slot. Both datasets refreshed with `COMPLETED` status.
- Authenticated dashboard embedding remains pending row-level security; flattened reports aggregate all jobs in the bucket, so anonymous embedding is unsafe.

### Quick dashboard web embed follow-up — 2026-10-23
- Verified the live Quick resources before setup: neither current S3 dataset had tag-based RLS, and no dashboard was published. Existing analyses referenced stale file-upload data.
- Added an authenticated backend URL-minting route. It derives the owner tag from the verified Cognito subject, checks both datasets contain `owner_id` and the expected enabled tag rule, restricts the Quick embed to the exact request origin, and returns no-cache short-lived embed URLs. Missing dataset security or capacity pricing fails closed.
- Added `owner_id` to the Quick CSV pipeline, sourced from DynamoDB job metadata; missing job metadata gives a blank owner. The deployed refresh rebuilt 154 quality rows and 427 inspection rows; both SPICE ingestions completed.
- Updated both live dataset schemas with `owner_id` and enabled tag-based RLS (`app_user_id` → `owner_id`, no match-all). Published dashboard `excelbridge-quality-dashboard`, reusing the two visuals from an existing analysis and remapping its dataset to the S3-backed quality dataset. Inspection data is secured and refreshed, but is not yet shown in a dashboard visual.
- Added a least-privilege inline policy to `xlsx-workflow-demo-lambda` for `DescribeDataSet` on both datasets and `GenerateEmbedUrlForAnonymousUser` on this dashboard. Configured the dashboard ID in the backend stack and deployed the `/analytics/quick` frontend to CloudFront (`d35kjusenp6a9t.cloudfront.net`). Site returns HTTP 200; the embed API returns 401 without Cognito auth as expected.
- The remaining blocker is account pricing: a live embed API call returns `UnsupportedPricingPlanException` because the QuickSight account has no active Capacity Pricing plan. Backend and UI now return a clear `QUICKSIGHT_CAPACITY_REQUIRED` message. No capacity plan has been activated; enable one before the authenticated dashboard smoke test.
