# AI Day 5 — Design Spec

- **Date:** 2026-10-16
- **Status:** Approved (brainstorming)
- **Spec for:** AI Day 5 (`docs/ai-plan.md` §Day-5), bounded by **ADR 0001** D6/D7 (`docs/decisions/0001-design-grilling-decisions.md`).
- **Working dir:** `backend/` (pytest: `pythonpath=["."]`, `testpaths=["app/tests"]`).

## Goal

Fill the last tool adapter. One new function `run_tool5` replaces the stub in `backend/app/ai/tool5_update.py`, plus `test_ai_day5.py`. Tool #5 matches unresolved current rows to candidate main rows; the model may only **select** from the candidate IDs supplied for each row, or return `unmatched`.

`run_tool5` mirrors the existing `run_tool4` four-step shape: render → `converse_json` → Pydantic-validate (trust boundary) → reject-whole guardrail → demote-only guardrail → wrap `AuditMeta` + `safe_log` cost line.

**Non-negotiable invariant (CLAUDE.md #1):** the AI response is an untrusted proposal. Reject the whole response if the model selects a row ID it was never offered, or contradicts itself (`unmatched` with a non-null selection). Guardrails only ever *add* caution (demote to `human_review`), never remove it. The BE apply-phase (§10.6) re-rejects any selected ID not in the candidate list and owns the duplicate/conflict resolution policy — that is the real safety gate.

## Verified preconditions

- Schema `Tool5Match` / `Tool5Output` (`schemas.py:119-130`) already exists — **unchanged**. `MatchType = exact | normalized | ambiguous | duplicate | conflict | unmatched` (`domain/enums.py`).
- Prompt `app/prompts/tool5_update.v1.md` already exists (Day 1) and already states the two invariants (select from `candidate_main_row_ids`; `unmatched` → null) — **unchanged**.
- `BedrockClient.converse_json(model_id, prompt, max_tokens, temperature)` returns `(parsed, raw, usage, latency_ms)` — used as-is.
- Shared `adapter.render_prompt`/`sha256_hex`, `policy.CONFIDENCE_FLOOR`, and `"rule_count"` in `SAFE_LOG_FIELDS` all landed on Day 4 — reused unchanged.
- **ADR D6:** candidate generation (key-blocking + fuzzy, top ~5, recall-biased) is plain-Python, **BE-owned**. The AI receives the ~5 candidates and only picks among them. `run_tool5` therefore has **no new helper and no blocking code** — it consumes `candidate_rows` from `inputs`.
- **Eval-set scope (brainstorming decision):** Day 5 is fake-Bedrock unit tests only, mirroring Days 1-4. Real-Bedrock accuracy measurement and threshold *tuning* are Day 6. Day 5 wires the demote logic to the existing `CONFIDENCE_FLOOR` (0.80).

---

## 1. Adapter (`tool5_update.py`)

`run_tool5(inputs, client=None, model_id=None) -> ToolResult[Tool5Output]`, mirroring `run_tool4`.

- `TOOL = "tool5_update"`, `PROMPT_VERSION = "v1"`.
- `_FIELDS = ("current_rows", "candidate_rows", "match_key")` — the three placeholders the v1 prompt declares.
- Model: `settings.bedrock_model_id` (Nova Lite). Matching against ~5 bounded candidates is structured selection, not heavy reasoning — Nova Lite matches Tools #1/#2, not the `_heavy` tier used by #3/#4.

**`_validate_against_inputs(payload)` — reject-whole (invariant #1):** for each match,
- if `selected_main_row_id` is not `None` and not in that match's own `candidate_main_row_ids` → `ValueError` (hallucinated/un-offered ID; message contains `"candidate"`).
- if `match_type == "unmatched"` and `selected_main_row_id` is not `None` → `ValueError` (contradictory output; message contains `"unmatched"`).

The check reads the candidate list off each `Tool5Match` (the prompt echoes back the per-row candidates the model was given), so no cross-referencing against raw `inputs` is needed — consistent with how Tool #4 validates against its own payload fields.

**`_apply_guardrails(payload)` — demote-only (caution):** set `recommended_action = "human_review"` when
- `match_type` ∈ `{ambiguous, duplicate, conflict}`, **or**
- `confidence < CONFIDENCE_FLOOR`.

Never clears an existing `human_review`. `exact`/`normalized` above the floor keep whatever action the model set. This realizes the Day-5 line "tune thresholds so ambiguous → humans" — the threshold is `CONFIDENCE_FLOOR`; actual tuning against real confidences is Day 6.

**Audit + log:** standard `AuditMeta` (`input_hash = sha256_hex(prompt)`, `output_hash = sha256_hex(raw)`, tokens, latency) and the standard `safe_log` cost line with `"rule_count": len(payload.matches)`. No raw field values logged (the `safe_log` allowlist drops everything else).

---

## 2. Tests — `test_ai_day5.py` (new)

Same fake-Bedrock harness as `test_ai_day4.py` (`FakeBedrock` + `_client`, no real boto calls). A fixture `T5_FIXTURE` with a couple of unresolved current rows and candidate IDs. Cases:

- **well-formed exact match** (`selected_main_row_id` in candidates) → `ToolResult[Tool5Output]`, `meta.tool == "tool5_update"`, 64-char hashes.
- **`unmatched` + null selection** → accepted, no error.
- **malformed** (`confidence > 1`) → `ValidationError` (Pydantic, before the extra checks).
- **hallucinated ID** (`selected_main_row_id` not in that row's `candidate_main_row_ids`) → `ValueError`, `match="candidate"`.
- **contradiction** (`match_type == "unmatched"` with a non-null `selected_main_row_id`) → `ValueError`, `match="unmatched"`.
- **demote `ambiguous`** → `recommended_action == "human_review"` even if the model set something else.
- **demote below-floor `exact`** (confidence < 0.80) → `recommended_action == "human_review"`.
- **cost log** emitted with `rule_count` == number of matches; no raw field values (e.g. a sample value string) appear in the log line.

Regression: `python -m pytest` — whole backend suite green (Days 1-5 + BE/FE).

---

## Handoff / notes

- **BE handoff:** `run_tool5` guardrails are AI-side *caution* only. BE still (§10.6) re-rejects any `selected_main_row_id` not in the candidate list at apply-time, owns candidate generation (ADR D6 blocking), **skips** unmatched current rows for the demo (ADR D7 — insert is future work), and owns the duplicate/conflict resolution policy (merge / latest-wins / keep-both / reject-all). The AI only labels + recommends.
- **Log schema:** Tool #5 emits `rule_count` (matches), consistent with Tools #2/#4.
- **Placeholder:** `CONFIDENCE_FLOOR = 0.80` (shared, flagged in-code since Day 4). No new placeholders.
- **Not in this spec:** real-Bedrock evaluation + threshold tuning (Day 6); ADR D1 size caps (BE-owned `settings`/`policy` change). This completes Tools #1-#5; Day 6 is the real-model fixture run.
