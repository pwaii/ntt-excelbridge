"""Day-3 AI (revised by ADR D4): Tool #2 normalization adapter + cost helper, tested with a
fake Bedrock client. Tool #2 now returns one rule per value-pattern, not one per cell."""
import json

import pytest
from pydantic import ValidationError

from app.ai import policy
from app.ai.bedrock_client import BedrockClient
from app.ai.policy import safe_log
from app.ai.tool2_types import run_tool2
from app.domain.schemas import Tool2Output, ToolResult


def test_estimate_cost_usd_uses_price_constants(monkeypatch):
    monkeypatch.setattr(policy, "PRICE_PER_1K_INPUT_USD", 0.001)
    monkeypatch.setattr(policy, "PRICE_PER_1K_OUTPUT_USD", 0.004)
    # 2000/1000*0.001 + 500/1000*0.004 == 0.002 + 0.002
    assert policy.estimate_cost_usd(2000, 500) == pytest.approx(0.004)


def test_safe_log_keeps_estimated_usd_drops_raw_values():
    out = safe_log(
        {"estimated_usd": 0.01, "example_original": "SECRET", "tool": "tool2_types"}
    )
    assert out == {"estimated_usd": 0.01, "tool": "tool2_types"}


# One safe high-confidence date-pattern rule + one reject rule.
GOOD_TOOL2 = (
    "```json\n"
    '{"column_id": "OrderDate", "target_type": "date", "rules": ['
    '{"pattern": "DD/MM/YYYY", "example_original": "01/02/2024", "normalized_form": "ISO date", '
    '"confidence": 0.95, "status": "safe", "reason": "us date"},'
    '{"pattern": "free text", "example_original": "bogus", "normalized_form": "", '
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
    assert len(result.payload.rules) == 2
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
        '{"column_id": "OrderDate", "target_type": "date", "rules": ['
        '{"pattern": "p", "example_original": "a", "normalized_form": "b", '
        '"confidence": 5, "status": "safe", "reason": "r"}]}'
    )
    with pytest.raises(ValidationError):
        run_tool2(FIXTURE, client=_client(bad))


def test_run_tool2_rejects_bad_target_type():
    resp = '{"column_id": "OrderDate", "target_type": "timestamp", "rules": []}'
    with pytest.raises(ValueError, match="target_type"):
        run_tool2(FIXTURE, client=_client(resp))


@pytest.mark.parametrize("alias,canonical", [("int", "integer"), ("bool", "boolean")])
def test_run_tool2_canonicalizes_inspection_labels(alias, canonical):
    response = json.dumps({"column_id": "Amount", "target_type": alias, "rules": []})
    client = _client(response)
    inputs = {**FIXTURE, "target_type": alias}
    result = run_tool2(inputs, client=client)
    assert result.payload.target_type == canonical
    sent = client._client.calls[0]["messages"][0]["content"][0]["text"]
    assert f"target type (proposed by the rule engine): {canonical}" in sent
    assert inputs["target_type"] == alias


def test_safe_below_floor_demoted_to_ambiguous():
    resp = (
        '{"column_id": "OrderDate", "target_type": "date", "rules": ['
        '{"pattern": "p", "example_original": "a", "normalized_form": "b", '
        '"confidence": 0.5, "status": "safe", "reason": "r"}]}'
    )
    result = run_tool2(FIXTURE, client=_client(resp))
    assert result.payload.rules[0].status == "ambiguous"


def test_safe_above_floor_and_reject_untouched():
    result = run_tool2(FIXTURE, client=_client(GOOD_TOOL2))
    assert result.payload.rules[0].status == "safe"    # confidence 0.95
    assert result.payload.rules[1].status == "reject"  # left as the model set it


def test_run_tool2_emits_cost_log(caplog):
    with caplog.at_level("INFO", logger="app.ai.tool2_types"):
        run_tool2(
            FIXTURE,
            client=_client(GOOD_TOOL2, usage={"inputTokens": 100, "outputTokens": 40}),
        )
    lines = [r.getMessage() for r in caplog.records if "estimated_usd" in r.getMessage()]
    assert lines, "no cost log emitted"
    record = json.loads(lines[0])
    assert record["rule_count"] == 2
    assert record["input_tokens"] == 100 and record["output_tokens"] == 40
    assert "estimated_usd" in record
    # no raw cell values ever reach the log
    assert "example_original" not in lines[0] and "normalized_form" not in lines[0]
