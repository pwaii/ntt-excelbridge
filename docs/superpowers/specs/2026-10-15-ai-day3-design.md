# AI Engineer — Day 3 Design

**Date:** 2026-10-15
**Scope:** Day-3 deliverables from `docs/ai-plan.md` — Tool #2 normalization adapter; response
validation against known row IDs / headers / allowed target types; confidence bands +
manual-review rules; token/cost measurements in structured logs.

**Source-of-truth note:** `design.md` no longer exists; `docs/ai-plan.md` is the authoritative
extract. `CONFIDENCE_FLOOR` and the Nova price-per-token constants are **not** in the surviving
extract — they are conservative placeholders, flagged in-code, same convention as the Day-1 caps.

**Core invariant (unchanged):** Every AI result is an untrusted proposal. The model never executes
code, never mutates data, and may only *select* from candidate IDs supplied in the prompt. Tool #2's
confidence/safe-flag are **self-reported by the model** — part of the untrusted payload — so the
guardrail below only ever makes a proposal *more* cautious, and the backend's Python re-parse
(§10.3) remains the real safety check downstream.

**What already exists:** `Tool2Output`/`Tool2CellProposal` schemas (`domain/schemas.py`), the
`tool2_types.v1.md` prompt, `policy.py` (`safe_log`, caps, `redact_sample`), and the `run_tool1`
pattern to mirror. `tool2_types.py` is a one-line stub. This spec fills the stub + a cost helper +
a self-check test file. No new infrastructure.

---

## 1. Adapter — `backend/app/ai/tool2_types.py`

`run_tool2(inputs, client=None, model_id=None) -> ToolResult[Tool2Output]`, the same four-step
shape as `run_tool1`: render → `converse_json` → Pydantic-validate → wrap `AuditMeta`.

- `TOOL = "tool2_types"`, `PROMPT_VERSION = "v1"`.
- `_FIELDS = ("column_id", "target_type", "samples", "type_distribution", "constraints")` — matches
  the placeholders in `tool2_types.v1.md`.
- **Duplicate** the tiny `_render` / `_sha` helpers from `tool1_semantics.py` (~8 lines). Not
  extracting a shared helper yet — rule of three; Day 4 (tool3/4) is when the third copy appears and
  extraction pays off. Zero risk to the already-tested `run_tool1`.
- Uses `MAX_OUTPUT_TOKENS` and `settings.bedrock_temperature`, same as `run_tool1`.

## 2. Post-schema validation (trust boundary beyond Pydantic)

After `payload = Tool2Output(**data)`, run these checks in order. Any failure **rejects the whole
response** by raising `ValueError` (BE maps to `MODEL_OUTPUT_INVALID`) — consistent with
`run_tool1`'s all-or-nothing and the invariant "reject outputs with unknown row IDs/headers".

1. **Target type allowlist.** `payload.target_type` must be in:
   ```python
   ALLOWED_TARGET_TYPES = frozenset({"string", "integer", "number", "date", "datetime", "boolean"})
   ```
   This is a **new contract**: the vocabulary the rule engine must use when it proposes a target
   type (`tool2_types.v1.md` says target type is "proposed by the rule engine"). Handoff note to BE.
2. **Known row IDs.** Build `allowed = {s["row_id"] for s in inputs["samples"]}` and reject if any
   `proposal.row_id` is not in it. Input `samples` shape for Tool #2: `[{"row_id": str, "value": str}, …]`.

## 3. Confidence-band guardrail (demote-only)

```python
CONFIDENCE_FLOOR = 0.80   # PLACEHOLDER — not in surviving extract, confirm with team
```

For each proposal: **if `status == "safe"` and `confidence < CONFIDENCE_FLOOR`, rewrite `status`
to `"ambiguous"`** (the manual-review bucket). The guard can only make a proposal more cautious,
never less — a confident-sounding low-score "safe" cannot talk past the review gate. This is the
sole mutation of untrusted payload. `"ambiguous"` and `"reject"` are left as the model set them.

## 4. Token/cost in structured logs

In `policy.py` (the budget/caps home, §15):

```python
PRICE_PER_1K_INPUT_USD  = 0.0  # PLACEHOLDER — Nova pricing not in extract, confirm with team
PRICE_PER_1K_OUTPUT_USD = 0.0  # PLACEHOLDER

def estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens / 1000) * PRICE_PER_1K_INPUT_USD + (output_tokens / 1000) * PRICE_PER_1K_OUTPUT_USD
```

Add `"estimated_usd"` to `SAFE_LOG_FIELDS` (it is a number, never a cell value). `run_tool2` builds
one record — `tool`, `model_id`, `prompt_version`, `input_hash`, `output_hash`, `latency_ms`,
`input_tokens`, `output_tokens`, `row_count` (= `len(payload.proposals)`), `estimated_usd` — and
emits it through `safe_log(...)` via `logging.getLogger(__name__)`. `safe_log` guarantees no raw
value leaks even if the record dict grows later.

## 5. Self-check — `backend/app/tests/test_ai_day3.py`

Fake-Bedrock (no real boto), mirrors `test_ai_day2.py`:

- Happy path: well-formed response → `ToolResult[Tool2Output]`, `meta` populated, token counts carried.
- Unknown `row_id` in a proposal → `ValueError`.
- `target_type` off the allowlist → `ValueError`.
- `status="safe"`, `confidence=0.5` → demoted to `"ambiguous"`.
- `status="safe"`, `confidence=0.95` → stays `"safe"`.
- Malformed payload (e.g. `confidence > 1`) → `ValidationError` (Pydantic, before the extra checks).
- `estimate_cost_usd` math; `safe_log` keeps `estimated_usd` and drops a raw-value key.

## Out of scope for Day 3

`run_tool1` changes, the workers (`quality_rules` etc. are stubs), extracting a shared adapter
helper (deferred to Day 4's rule-of-three), Tools #3–#5, real Bedrock calls.

## Open items / risk

- `CONFIDENCE_FLOOR` (0.80) and both price constants (0.0) are placeholders — confirm real values
  with the team before any cost number or demotion threshold is relied on.
- `ALLOWED_TARGET_TYPES` is a contract this slice *introduces*; the rule engine (BE, still a stub)
  must emit exactly these strings. Surface to BE at handoff.
