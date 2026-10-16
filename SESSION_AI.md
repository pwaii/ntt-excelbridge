# Session log — AI Engineer (Days 1–4)

Branch: `ai`. Stack: Bedrock Runtime Converse API + Pydantic. Every tool output is an
untrusted proposal validated at a trust boundary; the model never executes code.

**Status:** Days 1–4 complete. Backend suite green (45 passed). Tools #1–#4 implemented;
Tool #5 is Day 5.

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

## Open items / handoff to BE
- **Log schema:** Tools #2/#4 now emit `rule_count` (not `row_count`) — confirm BE log consumers.
- **Placeholders (flagged in-code):** `CONFIDENCE_FLOOR = 0.80`; `PRICE_PER_1K_*_USD = 0.0` (cost logs read $0.00 until real Nova pricing lands); Tool #3 `FORBIDDEN_TOKENS` volatile set.
- **AI-side guards are caution-only.** BE owns the real checks: Python re-parse of every normalized cell (§10.3) and the authoritative formula allowlist + in-range verifier (§10.4).
- **Not done here:** ADR D1 (size caps for ~2,000-row working set) — a `settings`/`policy` value change, BE-owned. ADR D6 (Tool #5 candidate blocking) — Day 5/6.

## Next — Day 5
Tool #5 unresolved-match prompt + schema; model may only pick supplied candidate main-row IDs; evaluation set (exact/fuzzy/ambiguous/duplicate/no-match); tune thresholds so ambiguous → humans.
