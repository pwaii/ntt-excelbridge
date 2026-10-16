# Session log — AI Engineer (Days 1–6)

Branch: `ai`. Stack: Bedrock Runtime Converse API + Pydantic. Every tool output is an
untrusted proposal validated at a trust boundary; the model never executes code.

**Status:** Days 1–6 complete. Backend suite green (61 passed). Tools #1–#5 tested against real Bedrock; cache, preflight, and eval harness in place.

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

## Next — Day 7
Fix the tool2/tool5 prompts for the Day-6 findings (force `normalized_form` string; JSON-only framing + one-shot retry); adversarial tests (invented row IDs, unsupported formulas, empty responses, contradictory mappings); accuracy scoring + `CONFIDENCE_FLOOR` tuning; short model-quality report with known limitations.
