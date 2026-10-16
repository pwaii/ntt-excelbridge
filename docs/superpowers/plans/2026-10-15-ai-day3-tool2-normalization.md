# AI Day 3 — Tool #2 Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the `tool2_types.py` stub with a `run_tool2` adapter that renders the Tool #2 prompt, calls Bedrock, validates the response against known row IDs / an allowed target-type set, demotes over-confident "safe" proposals, and emits a structured token/cost log line.

**Architecture:** Mirrors the existing `run_tool1` four-step shape (render → `converse_json` → Pydantic-validate → wrap `AuditMeta`), then adds two post-schema trust-boundary checks and a demote-only confidence guardrail. A tiny cost helper lives in `policy.py` beside the other budget/caps code. No new infrastructure; `Tool2Output` schema and `tool2_types.v1.md` prompt already exist.

**Tech Stack:** Python 3.12, Pydantic v2, boto3 (faked in tests), pytest.

**Spec:** `docs/superpowers/specs/2026-10-15-ai-day3-design.md`

**Working dir for all commands:** `backend/` (pytest is configured with `pythonpath=["."]`, `testpaths=["app/tests"]`).

---

### Task 1: Cost helper in `policy.py`

**Files:**
- Modify: `backend/app/ai/policy.py`
- Test: `backend/app/tests/test_ai_day3.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `backend/app/tests/test_ai_day3.py` with:

```python
"""Day-3 AI: Tool #2 normalization adapter + cost helper, tested with a fake Bedrock
client (no real boto calls). Proves the trust boundary: render -> call -> schema-validate
-> known-id/target-type validate -> demote-only guardrail -> cost log (§10.3)."""
import json

import pytest
from pydantic import ValidationError

from app.ai import policy
from app.ai.bedrock_client import BedrockClient
from app.ai.policy import estimate_cost_usd, safe_log
from app.ai.tool2_types import run_tool2
from app.domain.schemas import Tool2Output, ToolResult


def test_estimate_cost_usd_uses_price_constants(monkeypatch):
    monkeypatch.setattr(policy, "PRICE_PER_1K_INPUT_USD", 0.001)
    monkeypatch.setattr(policy, "PRICE_PER_1K_OUTPUT_USD", 0.004)
    # 2000/1000*0.001 + 500/1000*0.004 == 0.002 + 0.002
    assert policy.estimate_cost_usd(2000, 500) == pytest.approx(0.004)


def test_safe_log_keeps_estimated_usd_drops_raw_values():
    out = safe_log({"estimated_usd": 0.01, "original": "SECRET", "tool": "tool2_types"})
    assert out == {"estimated_usd": 0.01, "tool": "tool2_types"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest app/tests/test_ai_day3.py -v`
Expected: collection error / ImportError — `cannot import name 'estimate_cost_usd'` and `run_tool2`.

- [ ] **Step 3: Add the cost helper and allowlist entry to `policy.py`**

Append after the existing `MAX_*` constants (around line 12), and add `"estimated_usd"` to `SAFE_LOG_FIELDS`:

```python
# --- Cost (§15, USD cap) ---
PRICE_PER_1K_INPUT_USD = 0.0   # PLACEHOLDER — Nova pricing not in surviving extract, confirm with team
PRICE_PER_1K_OUTPUT_USD = 0.0  # PLACEHOLDER


def estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    """Per-call USD estimate from self-metered token counts. Prices are placeholders."""
    return (input_tokens / 1000) * PRICE_PER_1K_INPUT_USD + (
        output_tokens / 1000
    ) * PRICE_PER_1K_OUTPUT_USD
```

In `SAFE_LOG_FIELDS`, add `"estimated_usd"`:

```python
SAFE_LOG_FIELDS = {
    "tool", "model_id", "prompt_version", "input_hash", "output_hash",
    "latency_ms", "input_tokens", "output_tokens", "row_count", "estimated_usd",
}
```

- [ ] **Step 4: Run the two cost tests to verify they pass**

Run: `python -m pytest app/tests/test_ai_day3.py -k "estimate_cost or safe_log" -v`
Expected: 2 passed. (Other tests still error on the missing `run_tool2` import — fixed in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai/policy.py backend/app/tests/test_ai_day3.py
git commit -m "feat(ai): per-call cost estimate helper for Tool #2 logging"
```

---

### Task 2: `run_tool2` base adapter (render → call → schema-validate → wrap)

**Files:**
- Modify: `backend/app/ai/tool2_types.py` (replace the one-line stub)
- Test: `backend/app/tests/test_ai_day3.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/app/tests/test_ai_day3.py` (the fake client + fixtures mirror `test_ai_day2.py`):

```python
# A well-formed Tool #2 response: one safe high-confidence date + one reject.
GOOD_TOOL2 = (
    "```json\n"
    '{"column_id": "OrderDate", "target_type": "date", "proposals": ['
    '{"row_id": "r2", "original": "01/02/2024", "normalized": "2024-01-02", '
    '"confidence": 0.95, "status": "safe", "reason": "us date"},'
    '{"row_id": "r3", "original": "bogus", "normalized": "", '
    '"confidence": 0.2, "status": "reject", "reason": "unparseable"}]}\n```'
)

FIXTURE = {
    "column_id": "OrderDate",
    "target_type": "date",
    "samples": [{"row_id": "r2", "value": "01/02/2024"}, {"row_id": "r3", "value": "bogus"}],
    "type_distribution": {"date": 1, "string": 1},
    "constraints": "preserve source day/month order",
}


class FakeBedrock:
    """Stands in for a boto3 bedrock-runtime client. Records the converse() kwargs."""

    def __init__(self, text: str, usage: dict | None = None):
        self._text = text
        self._usage = usage or {"inputTokens": 10, "outputTokens": 5}
        self.calls: list[dict] = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "output": {"message": {"content": [{"text": self._text}]}},
            "usage": self._usage,
        }


def _client(text: str, usage: dict | None = None) -> BedrockClient:
    return BedrockClient(client=FakeBedrock(text, usage))


def test_run_tool2_renders_prompt_and_wraps_meta():
    client = _client(GOOD_TOOL2)
    result = run_tool2(FIXTURE, client=client)

    assert isinstance(result, ToolResult)
    assert isinstance(result.payload, Tool2Output)
    assert result.payload.target_type == "date"
    assert len(result.payload.proposals) == 2
    assert result.meta.tool == "tool2_types"
    assert result.meta.prompt_version == "v1"
    assert len(result.meta.input_hash) == 64 and len(result.meta.output_hash) == 64
    assert result.meta.input_tokens == 10 and result.meta.output_tokens == 5

    sent = client._client.calls[0]
    text = sent["messages"][0]["content"][0]["text"]
    assert "{column_id}" not in text      # fully rendered
    assert "OrderDate" in text            # structured input serialized


def test_run_tool2_rejects_malformed_payload():
    # confidence 5 > 1 -> Pydantic rejects before the extra checks
    bad = (
        '{"column_id": "OrderDate", "target_type": "date", "proposals": ['
        '{"row_id": "r2", "original": "a", "normalized": "b", '
        '"confidence": 5, "status": "safe", "reason": "r"}]}'
    )
    with pytest.raises(ValidationError):
        run_tool2(FIXTURE, client=_client(bad))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest app/tests/test_ai_day3.py -k "renders_prompt or malformed" -v`
Expected: FAIL — `ImportError: cannot import name 'run_tool2'` (stub is empty).

- [ ] **Step 3: Replace the stub in `tool2_types.py`**

Overwrite `backend/app/ai/tool2_types.py` entirely with:

```python
"""Tool #2 adapter (§10.3): render the type-normalization prompt, call Bedrock, validate the
response into Tool2Output (shape), then reject any unknown row_id / off-allowlist target type and
demote over-confident 'safe' proposals. The backend re-parses every normalized value in Python
before it can be accepted; the model only proposes."""
import hashlib
import json
import logging

from app.ai.bedrock_client import BedrockClient
from app.ai.policy import MAX_OUTPUT_TOKENS, estimate_cost_usd, safe_log
from app.ai.prompts import get_prompt
from app.domain.schemas import AuditMeta, Tool2Output, ToolResult
from app.settings import settings

TOOL = "tool2_types"
PROMPT_VERSION = "v1"

# Placeholders the v1 prompt template declares (§10.3 inputs).
_FIELDS = ("column_id", "target_type", "samples", "type_distribution", "constraints")

# The vocabulary the rule engine must use when it proposes a target type (handoff to BE).
ALLOWED_TARGET_TYPES = frozenset(
    {"string", "integer", "number", "date", "datetime", "boolean"}
)
CONFIDENCE_FLOOR = 0.80  # PLACEHOLDER — not in surviving extract, confirm with team

_log = logging.getLogger(__name__)


def _render(inputs: dict) -> str:
    text = get_prompt(TOOL, PROMPT_VERSION)
    for key in _FIELDS:
        value = inputs.get(key, "")
        if not isinstance(value, str):
            value = json.dumps(value)  # serialize lists/dicts; keep caller flexible
        text = text.replace("{" + key + "}", value)
    return text


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def run_tool2(
    inputs: dict, client: BedrockClient | None = None, model_id: str | None = None
) -> ToolResult[Tool2Output]:
    client = client or BedrockClient()
    model_id = model_id or settings.bedrock_model_id

    prompt = _render(inputs)
    data, raw, usage, latency_ms = client.converse_json(
        model_id, prompt, MAX_OUTPUT_TOKENS, settings.bedrock_temperature
    )
    payload = Tool2Output(**data)  # trust boundary: reject anything off-shape

    meta = AuditMeta(
        tool=TOOL, model_id=model_id, prompt_version=PROMPT_VERSION,
        input_hash=_sha(prompt), output_hash=_sha(raw), latency_ms=latency_ms,
        input_tokens=usage["inputTokens"], output_tokens=usage["outputTokens"],
    )
    return ToolResult[Tool2Output](meta=meta, payload=payload)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest app/tests/test_ai_day3.py -k "renders_prompt or malformed" -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai/tool2_types.py backend/app/tests/test_ai_day3.py
git commit -m "feat(ai): Tool #2 base adapter (render/call/validate/wrap)"
```

---

### Task 3: Post-schema validation — known row IDs + allowed target type (reject whole)

**Files:**
- Modify: `backend/app/ai/tool2_types.py`
- Test: `backend/app/tests/test_ai_day3.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/app/tests/test_ai_day3.py`:

```python
def test_run_tool2_rejects_unknown_row_id():
    resp = (
        '{"column_id": "OrderDate", "target_type": "date", "proposals": ['
        '{"row_id": "r999", "original": "x", "normalized": "y", '
        '"confidence": 0.9, "status": "safe", "reason": "r"}]}'
    )
    with pytest.raises(ValueError, match="unknown row_ids"):
        run_tool2(FIXTURE, client=_client(resp))


def test_run_tool2_rejects_bad_target_type():
    resp = '{"column_id": "OrderDate", "target_type": "timestamp", "proposals": []}'
    with pytest.raises(ValueError, match="target_type"):
        run_tool2(FIXTURE, client=_client(resp))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest app/tests/test_ai_day3.py -k "unknown_row_id or bad_target_type" -v`
Expected: FAIL — no `ValueError` raised (the adapter currently accepts both responses).

- [ ] **Step 3: Add the validator and call it after the Pydantic parse**

In `backend/app/ai/tool2_types.py`, add this function above `run_tool2`:

```python
def _validate_against_inputs(payload: Tool2Output, inputs: dict) -> None:
    """Reject the whole response (invariant #1) if the model used an unknown target type or a
    row_id not sent in the prompt. Consistent with run_tool1's all-or-nothing."""
    if payload.target_type not in ALLOWED_TARGET_TYPES:
        raise ValueError(
            f"target_type {payload.target_type!r} not in {set(ALLOWED_TARGET_TYPES)}"
        )
    allowed = {s["row_id"] for s in inputs.get("samples", [])}
    unknown = [p.row_id for p in payload.proposals if p.row_id not in allowed]
    if unknown:
        raise ValueError(f"proposals reference unknown row_ids: {unknown}")
```

Then in `run_tool2`, insert the call immediately after the `payload = Tool2Output(**data)` line:

```python
    payload = Tool2Output(**data)  # trust boundary: reject anything off-shape
    _validate_against_inputs(payload, inputs)  # reject unknown row_ids / target type
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest app/tests/test_ai_day3.py -k "unknown_row_id or bad_target_type" -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai/tool2_types.py backend/app/tests/test_ai_day3.py
git commit -m "feat(ai): Tool #2 reject unknown row_ids and off-allowlist target type"
```

---

### Task 4: Demote-only confidence guardrail

**Files:**
- Modify: `backend/app/ai/tool2_types.py`
- Test: `backend/app/tests/test_ai_day3.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/app/tests/test_ai_day3.py`:

```python
def test_safe_below_floor_demoted_to_ambiguous():
    resp = (
        '{"column_id": "OrderDate", "target_type": "date", "proposals": ['
        '{"row_id": "r2", "original": "a", "normalized": "b", '
        '"confidence": 0.5, "status": "safe", "reason": "r"}]}'
    )
    result = run_tool2(FIXTURE, client=_client(resp))
    assert result.payload.proposals[0].status == "ambiguous"


def test_safe_above_floor_and_reject_untouched():
    result = run_tool2(FIXTURE, client=_client(GOOD_TOOL2))
    assert result.payload.proposals[0].status == "safe"    # confidence 0.95
    assert result.payload.proposals[1].status == "reject"  # left as the model set it
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest app/tests/test_ai_day3.py -k "demoted or untouched" -v`
Expected: FAIL on `test_safe_below_floor_demoted_to_ambiguous` — status is still `"safe"`. (`untouched` already passes.)

- [ ] **Step 3: Add the guardrail and call it after validation**

In `backend/app/ai/tool2_types.py`, add this function above `run_tool2`:

```python
def _apply_confidence_floor(payload: Tool2Output) -> None:
    """Demote-only guardrail: a 'safe' below the floor becomes 'ambiguous' (manual review).
    confidence/status are self-reported by the model, so the guard only adds caution, never
    removes it. The backend's Python re-parse (§10.3) is still the real check."""
    for p in payload.proposals:
        if p.status == "safe" and p.confidence < CONFIDENCE_FLOOR:
            p.status = "ambiguous"
```

Then in `run_tool2`, add the call right after `_validate_against_inputs(...)`:

```python
    _validate_against_inputs(payload, inputs)  # reject unknown row_ids / target type
    _apply_confidence_floor(payload)           # demote-only guardrail
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest app/tests/test_ai_day3.py -k "demoted or untouched" -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai/tool2_types.py backend/app/tests/test_ai_day3.py
git commit -m "feat(ai): Tool #2 demote-only confidence guardrail"
```

---

### Task 5: Structured token/cost log line

**Files:**
- Modify: `backend/app/ai/tool2_types.py`
- Test: `backend/app/tests/test_ai_day3.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/app/tests/test_ai_day3.py`:

```python
def test_run_tool2_emits_cost_log(caplog):
    with caplog.at_level("INFO", logger="app.ai.tool2_types"):
        run_tool2(
            FIXTURE,
            client=_client(GOOD_TOOL2, usage={"inputTokens": 100, "outputTokens": 40}),
        )
    lines = [r.getMessage() for r in caplog.records if "estimated_usd" in r.getMessage()]
    assert lines, "no cost log emitted"
    record = json.loads(lines[0])
    assert record["row_count"] == 2
    assert record["input_tokens"] == 100 and record["output_tokens"] == 40
    assert "estimated_usd" in record
    # no raw cell values ever reach the log
    assert "original" not in lines[0] and "normalized" not in lines[0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest app/tests/test_ai_day3.py -k "emits_cost_log" -v`
Expected: FAIL — `assert lines` fails (no log emitted yet).

- [ ] **Step 3: Emit the safe_log record before returning**

In `backend/app/ai/tool2_types.py`, in `run_tool2`, insert this block after the `meta = AuditMeta(...)` assignment and before the `return`:

```python
    _log.info(json.dumps(safe_log({
        "tool": TOOL, "model_id": model_id, "prompt_version": PROMPT_VERSION,
        "input_hash": meta.input_hash, "output_hash": meta.output_hash,
        "latency_ms": latency_ms, "input_tokens": meta.input_tokens,
        "output_tokens": meta.output_tokens, "row_count": len(payload.proposals),
        "estimated_usd": estimate_cost_usd(meta.input_tokens, meta.output_tokens),
    })))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest app/tests/test_ai_day3.py -k "emits_cost_log" -v`
Expected: 1 passed.

- [ ] **Step 5: Run the whole Day-3 suite + existing AI suites (no regressions)**

Run: `python -m pytest app/tests/test_ai_day3.py app/tests/test_ai_day2.py app/tests/test_ai_day1.py -v`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/ai/tool2_types.py backend/app/tests/test_ai_day3.py
git commit -m "feat(ai): Tool #2 structured token/cost log line"
```

---

## Notes / handoff

- **BE handoff:** `ALLOWED_TARGET_TYPES` in `tool2_types.py` is the contract the rule engine must emit when proposing a target type. The backend's Python re-parse (§10.3) is still the real safety check; `_apply_confidence_floor` only makes proposals more cautious.
- **Placeholders to confirm with team:** `CONFIDENCE_FLOOR = 0.80`, `PRICE_PER_1K_INPUT_USD`/`PRICE_PER_1K_OUTPUT_USD = 0.0`. All flagged in-code.
- **Deferred (rule of three):** `_render`/`_sha` are duplicated from `tool1_semantics.py`. Extract a shared adapter helper on Day 4 when tool3/tool4 add the third copy.
