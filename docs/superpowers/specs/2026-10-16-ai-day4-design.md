# AI Day 4 — Design Spec

- **Date:** 2026-10-16
- **Status:** Approved (brainstorming)
- **Spec for:** AI Day 4 (`docs/ai-plan.md` §Day-4), reshaped by **ADR 0001** (`docs/decisions/0001-design-grilling-decisions.md`).
- **Working dir:** `backend/` (pytest: `pythonpath=["."]`, `testpaths=["app/tests"]`).

## Goal

Complete the AI tool adapters for Day 4, with one addition the ADR forced:

1. **Shared adapter helper** — extract the `_render`/`_sha` duplication (deferred from Day 3 as the rule-of-three) and the shared `CONFIDENCE_FLOOR`.
2. **Tool #2 rework (ADR D4)** — migrate from per-cell `proposals[]` keyed by `row_id` to per-value-pattern `rules[]`. This edits code shipped on Day 3.
3. **Tool #3 formula adapter** — fill the `tool3_formulas.py` stub (`run_tool3`).
4. **Tool #4 standardization adapter** — fill the `tool4_standardize.py` stub (`run_tool4`).
5. **Tests** — update `test_ai_day3.py` for the Tool #2 rework; add `test_ai_day4.py` for Tools #3/#4.

All adapters mirror the existing `run_tool1`/`run_tool2` four-step shape: render → `converse_json` → Pydantic-validate (trust boundary) → wrap `AuditMeta`, plus reject-whole guardrails and, where a `status`/`action` field exists, a demote-only confidence guardrail.

**Non-negotiable invariant throughout (CLAUDE.md #1):** every AI response is an untrusted proposal. Reject the whole response on any hallucinated header / off-allowlist value / forbidden formula. Guardrails only ever *add* caution (demote), never remove it. The backend's deterministic re-check (Python re-parse, authoritative formula allowlist) remains the real safety gate.

## Verified preconditions

- `BedrockClient.converse_json(model_id, prompt, max_tokens, temperature)` returns `(parsed_json, raw_text, usage, latency_ms)` — unchanged; all adapters use it as-is.
- Nothing outside `backend/app/ai/` + its tests references the Tool #2 `proposals`/`row_id` shape. The frontend `index.ts` has no Tool #2 model (its `"normalized"` is a `MatchType` literal, unrelated). **The Tool #2 rework is contained to the backend AI module and its tests.**
- No `tool2_types.v2` references and no response cache exist yet (real Bedrock is Day 6) — rewriting `tool2_types.v1.md` in place is safe.

---

## 1. Shared adapter helper

**New file `backend/app/ai/adapter.py`:**

```python
"""Shared tool-adapter helpers: the prompt render + hash every run_toolN duplicates."""
import hashlib
import json

from app.ai.prompts import get_prompt


def render_prompt(tool: str, version: str, fields: tuple[str, ...], inputs: dict) -> str:
    text = get_prompt(tool, version)
    for key in fields:
        value = inputs.get(key, "")
        if not isinstance(value, str):
            value = json.dumps(value)  # serialize lists/dicts; keep caller flexible
        text = text.replace("{" + key + "}", value)
    return text


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()
```

**`policy.py`:** add the shared guardrail constant (Tool #2 and #4 both use it):

```python
CONFIDENCE_FLOOR = 0.80  # PLACEHOLDER — not in surviving extract, confirm with team
```

Add `"rule_count"` to `SAFE_LOG_FIELDS` (Tool #2 now logs rules, not rows). Keep `"row_count"` (other tools may still use it).

**`tool1_semantics.py` and `tool2_types.py`:** delete their local `_render`/`_sha`; import `render_prompt`/`sha256_hex` from `app.ai.adapter`. `tool2_types.py` imports `CONFIDENCE_FLOOR` from `policy` instead of defining it.

---

## 2. Tool #2 rework — per-pattern rules (ADR D4)

**Why:** per-cell proposals on a dirty column blow `maxTokens`, the $140 cap, and the review UI. One rule per distinct value-pattern; the backend applies each rule to every matching cell and re-parses each result in Python (§10.3).

**Schema (`schemas.py`)** — replace `Tool2CellProposal` + `Tool2Output`:

```python
class Tool2Rule(BaseModel):
    pattern: str            # e.g. "DD/MM/YYYY"
    example_original: str   # a representative raw value (redacted sample)
    normalized_form: str    # e.g. "ISO date YYYY-MM-DD"
    confidence: float = Field(ge=0, le=1)
    status: str             # safe | ambiguous | reject
    reason: str


class Tool2Output(BaseModel):
    column_id: str
    target_type: str
    rules: list[Tool2Rule]
```

**Adapter (`tool2_types.py`):**
- `_validate_against_inputs(payload, inputs)` keeps **only** the `target_type ∈ ALLOWED_TARGET_TYPES` check. The `unknown row_id` check is **deleted** — rules describe value-patterns, not prompt rows, so there is no row-id set to validate against. (The "model may only select from candidates" invariant does not apply to descriptive patterns; BE re-parses every applied cell, which is the real check.)
- `_apply_confidence_floor` iterates `payload.rules`; a `safe` rule below `CONFIDENCE_FLOOR` → `ambiguous`.
- Log line: `"rule_count": len(payload.rules)` instead of `row_count`.

**Prompt (`tool2_types.v1.md`):** rewrite the Rules + Output sections to instruct **one rule per distinct value-pattern, never one per cell**, output shape `rules[]` with the new fields. Keep version `v1`.

**Tests (`test_ai_day3.py`):**
- `GOOD_TOOL2` and all response literals → `rules[]` shape.
- **Delete** `test_run_tool2_rejects_unknown_row_id` (no row_ids anymore).
- Keep `test_run_tool2_rejects_bad_target_type`, the demote tests (now on rules), and the cost-log test (assert `rule_count`, and that `pattern`/`normalized_form` raw values never reach the log).

---

## 3. Tool #3 formula adapter (`tool3_formulas.py`)

`run_tool3(inputs, client=None, model_id=None) -> ToolResult[Tool3Output]`, mirroring `run_tool1`.

- `TOOL = "tool3_formulas"`, `PROMPT_VERSION = "v1"`.
- `_FIELDS = ("meaning", "source_headers", "allowed_functions", "samples", "expected_type")`.
- Schema `Tool3Output` already exists — unchanged.
- **Reject-whole guardrail** `_validate_against_inputs(payload, inputs)` (thin — authoritative allowlist stays on BE):
  - `formula_template` does not start with `=` → reject.
  - any header in `referenced_headers` not in `inputs["source_headers"]` → reject (hallucinated header).
  - uppercased `formula_template` contains any forbidden token → reject:
    `FORBIDDEN_TOKENS = frozenset({"INDIRECT", "OFFSET", "WEBSERVICE", "HYPERLINK", "NOW", "TODAY", "RAND", "RANDBETWEEN"})`
    (external-links/macros manifest as these tokens or a non-`=` start at this layer; BE does the authoritative range + full-allowlist check.)
- **No demote guardrail:** `Tool3Output` has no `status` field; low confidence simply surfaces in the review UI (ADR D9).
- Same `AuditMeta` + `safe_log` cost line as the other tools (`row_count` omitted or 0 — single formula).

---

## 4. Tool #4 standardization adapter (`tool4_standardize.py`)

`run_tool4(inputs, client=None, model_id=None) -> ToolResult[Tool4Output]`, mirroring `run_tool2`.

- `TOOL = "tool4_standardize"`, `PROMPT_VERSION = "v1"`.
- `_FIELDS = ("source_values", "canonical_candidates", "samples")`.
- Schema `Tool4Output` already exists — unchanged.
- **Reject-whole guardrail:** build `allowed = set(inputs["canonical_candidates"])`. For each mapping, reject the whole response if `canonical_value` ∉ `allowed`, **unless** `cardinality == "unmapped"` and `canonical_value == ""` (unmapped values stay blank). This enforces "model cannot invent a canonical value."
- **Demote-only guardrails:**
  - one-to-many: if a `source_value` appears in >1 mapping with distinct `canonical_value`, set `action = "ambiguous"` on those mappings (plan: one-to-many is always ambiguous).
  - a `safe` mapping below `CONFIDENCE_FLOOR` → `action = "ambiguous"`.
- Cost log: `"rule_count": len(payload.mappings)` (reuse the rules-count key).

---

## 5. Tests — `test_ai_day4.py` (new)

Same fake-Bedrock harness as `test_ai_day3.py` (no real boto calls). Cases:

**Tool #3:**
- well-formed formula → `ToolResult[Tool3Output]`, meta populated.
- malformed (`confidence > 1`) → `ValidationError`.
- `referenced_headers` includes a header not in `source_headers` → `ValueError` (hallucinated header).
- formula containing `INDIRECT(...)` → `ValueError` (forbidden formula).
- formula not starting with `=` → `ValueError`.

**Tool #4:**
- well-formed mapping (one-to-one + unmapped) → `ToolResult[Tool4Output]`.
- `canonical_value` not in `canonical_candidates` → `ValueError` (hallucinated canonical).
- same `source_value` → two canonical values → both demoted to `action = "ambiguous"`.
- `safe` below `CONFIDENCE_FLOOR` → `ambiguous`.
- cost log emitted; no raw source/canonical values in the log line.

Regression: run `test_ai_day1/2/3` + `test_ai_day4` — all green.

---

## Handoff / notes

- **BE handoff:** `ALLOWED_TARGET_TYPES` (Tool #2) and `FORBIDDEN_TOKENS` (Tool #3) are AI-side *caution* guardrails. BE still owns: Python re-parse of every normalized cell (§10.3), and the authoritative formula allowlist + in-range verifier (§10.4 / backend-plan Day 4). The forbidden-token set is a thin subset of BE's rule, intentionally duplicated as a cheap reject-whole guard — not the source of truth.
- **ADR D4 "already built per-cell" path:** our Day-3 code was per-cell; this spec is the collapse-to-rules migration it calls for.
- **Placeholders to confirm:** `CONFIDENCE_FLOOR = 0.80`, `PRICE_PER_1K_*_USD = 0.0`, the `FORBIDDEN_TOKENS` volatile set. All flagged in-code.
- **Not in this spec:** ADR D1 (size caps for ~2,000 rows) touches `settings`/`policy` cap values, not tool logic — a separate small change, BE-owned. ADR D6 (Tool #5 candidate blocking) is Day 5/6.
