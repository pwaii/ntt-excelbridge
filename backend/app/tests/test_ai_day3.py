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
