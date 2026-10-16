# Session log — AI Engineer (Days 1–5)

Branch: `ai`. Stack: Bedrock Runtime Converse API + Pydantic. Every tool output is an
untrusted proposal validated at a trust boundary; the model never executes code.

**Status:** Days 1–5 complete. Backend suite green (59 passed). Tools #1–#5 all implemented;
Day 6 is the real-Bedrock fixture evaluation.

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

## Open items / handoff to BE
- **Log schema:** Tools #2/#4 now emit `rule_count` (not `row_count`) — confirm BE log consumers.
- **Placeholders (flagged in-code):** `CONFIDENCE_FLOOR = 0.80`; `PRICE_PER_1K_*_USD = 0.0` (cost logs read $0.00 until real Nova pricing lands); Tool #3 `FORBIDDEN_TOKENS` volatile set.
- **AI-side guards are caution-only.** BE owns the real checks: Python re-parse of every normalized cell (§10.3) and the authoritative formula allowlist + in-range verifier (§10.4).
- **Tool #5 candidate generation (ADR D6):** the key-blocking + fuzzy top-~5 recall-biased step before the AI is plain-Python and **BE-owned** — `run_tool5` only consumes the supplied candidates. Per-match `candidate_main_row_ids` check is a caution guard; BE re-rejects off-candidate IDs at apply-time and owns the duplicate/conflict resolution policy. Unmatched current rows are **skipped** for the demo (ADR D7; insert is future work).
- **End-to-end integration gap:** no backend worker calls `run_toolN` yet — the adapters are a standalone, fake-Bedrock-tested library. Wiring them into a worker + the review gates is a BE task, not in the AI day plan.
- **Not done here:** ADR D1 (size caps for ~2,000-row working set) — a `settings`/`policy` value change, BE-owned.

## Verification completed
Full backend suite `python -m pytest` → **59 passed** at the Day-5 commit (`7d7e0ec`), including 8 new Tool #5 tests. No real boto calls in any test. Spec, plan, and implementation each committed separately on branch `ai`.

## Next — Day 6
Full fixture evaluation against **real** Bedrock with capped samples (exact/fuzzy/ambiguous/duplicate/no-match); measure avg tokens + latency per tool; cache responses by input hash; confirm the model is non-Marketplace. Requires live AWS Bedrock access (creds + model enabled in-region).
