"""Day-4 AI: shared adapter helper + Tool #3 (formula) and Tool #4 (standardization)
adapters, tested with a fake Bedrock client (no real boto calls)."""
import json

import pytest
from pydantic import ValidationError

from app.ai.adapter import render_prompt, sha256_hex


def test_render_prompt_fills_placeholders_and_serializes_lists():
    text = render_prompt(
        "tool1_semantics", "v1", ("current_headers",), {"current_headers": ["A", "B"]}
    )
    assert "{current_headers}" not in text   # placeholder replaced
    assert "A" in text and "B" in text       # list serialized into the prompt


def test_sha256_hex_is_64_hex_chars():
    h = sha256_hex("x")
    assert len(h) == 64
    int(h, 16)  # raises if not hex


# --- Fake Bedrock harness (shared by Tool #3 and Tool #4 tests) ---
from app.ai.tool3_formulas import run_tool3
from app.domain.schemas import Tool3Output, ToolResult


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


def _client(text: str, usage: dict | None = None):
    from app.ai.bedrock_client import BedrockClient

    return BedrockClient(client=FakeBedrock(text, usage))


T3_FIXTURE = {
    "meaning": "total price = qty * unit price",
    "source_headers": ["Qty", "UnitPrice"],
    "allowed_functions": ["SUM", "PRODUCT"],
    "samples": [{"Qty": "2", "UnitPrice": "10"}],
    "expected_type": "number",
}

GOOD_T3 = (
    '{"formula_template": "=Qty*UnitPrice", "target_header": "Total", '
    '"expected_type": "number", "referenced_headers": ["Qty", "UnitPrice"], '
    '"explanation": "multiply", "confidence": 0.9}'
)


def test_run_tool3_valid_formula_wraps_meta():
    result = run_tool3(T3_FIXTURE, client=_client(GOOD_T3))
    assert isinstance(result, ToolResult)
    assert isinstance(result.payload, Tool3Output)
    assert result.payload.formula_template == "=Qty*UnitPrice"
    assert result.meta.tool == "tool3_formulas"
    assert len(result.meta.input_hash) == 64


def test_run_tool3_rejects_malformed_payload():
    with pytest.raises(ValidationError):
        run_tool3(T3_FIXTURE, client=_client('{"formula_template": "=A", "confidence": 5}'))


def test_run_tool3_rejects_hallucinated_header():
    resp = (
        '{"formula_template": "=Qty*Margin", "target_header": "T", "expected_type": "number", '
        '"referenced_headers": ["Qty", "Margin"], "explanation": "x", "confidence": 0.9}'
    )
    with pytest.raises(ValueError, match="source_headers"):
        run_tool3(T3_FIXTURE, client=_client(resp))


def test_run_tool3_rejects_non_formula():
    resp = (
        '{"formula_template": "Qty*UnitPrice", "target_header": "T", "expected_type": "number", '
        '"referenced_headers": ["Qty", "UnitPrice"], "explanation": "x", "confidence": 0.9}'
    )
    with pytest.raises(ValueError, match="start with"):
        run_tool3(T3_FIXTURE, client=_client(resp))


def test_run_tool3_rejects_forbidden_function():
    resp = (
        '{"formula_template": "=INDIRECT(A1)", "target_header": "T", "expected_type": "number", '
        '"referenced_headers": [], "explanation": "x", "confidence": 0.9}'
    )
    with pytest.raises(ValueError, match="forbidden"):
        run_tool3(T3_FIXTURE, client=_client(resp))


def test_run_tool3_allows_header_containing_function_substring():
    # "Snowfall" contains "NOW" — must NOT trip the forbidden-token check (we match TOKEN().
    fixture = {**T3_FIXTURE, "source_headers": ["Snowfall"]}
    resp = (
        '{"formula_template": "=SUM(Snowfall)", "target_header": "T", "expected_type": "number", '
        '"referenced_headers": ["Snowfall"], "explanation": "x", "confidence": 0.9}'
    )
    result = run_tool3(fixture, client=_client(resp))
    assert result.payload.formula_template == "=SUM(Snowfall)"


from app.ai.tool4_standardize import run_tool4
from app.domain.schemas import Tool4Output

T4_FIXTURE = {
    "source_values": [
        {"field": "Country", "value": "USA"},
        {"field": "Country", "value": "U.S."},
    ],
    "canonical_candidates": ["United States", "Canada"],
    "samples": [],
}

GOOD_T4 = (
    '{"mappings": ['
    '{"source_field": "Country", "source_value": "USA", "canonical_field": "Country", '
    '"canonical_value": "United States", "reason": "abbr", "confidence": 0.95, '
    '"cardinality": "many_to_one", "action": "safe"},'
    '{"source_field": "Country", "source_value": "XX", "canonical_field": "Country", '
    '"canonical_value": "", "reason": "unknown", "confidence": 0.1, '
    '"cardinality": "unmapped", "action": "safe"}]}'
)


def test_run_tool4_valid_mapping_wraps_meta():
    result = run_tool4(T4_FIXTURE, client=_client(GOOD_T4))
    assert isinstance(result, ToolResult)
    assert isinstance(result.payload, Tool4Output)
    assert result.payload.mappings[0].canonical_value == "United States"
    assert result.meta.tool == "tool4_standardize"


def test_run_tool4_rejects_hallucinated_canonical():
    resp = (
        '{"mappings": [{"source_field": "Country", "source_value": "USA", '
        '"canonical_field": "Country", "canonical_value": "Mexico", "reason": "x", '
        '"confidence": 0.9, "cardinality": "one_to_one", "action": "safe"}]}'
    )
    with pytest.raises(ValueError, match="not in candidates"):
        run_tool4(T4_FIXTURE, client=_client(resp))


def test_run_tool4_unmapped_nonblank_value_coerced_to_blank():
    # Nova sometimes emits the word "unmapped" (or "none") instead of a blank
    # canonical_value; an unmapped row must normalize to "" rather than reject-whole.
    resp = (
        '{"mappings": [{"source_field": "Country", "source_value": "XX", '
        '"canonical_field": "Country", "canonical_value": "unmapped", "reason": "x", '
        '"confidence": 0.1, "cardinality": "unmapped", "action": "safe"}]}'
    )
    result = run_tool4(T4_FIXTURE, client=_client(resp))
    assert result.payload.mappings[0].canonical_value == ""


def test_run_tool4_numeric_source_value_coerced_to_str():
    # Nova may emit numeric Excel values as JSON numbers; accept as strings.
    resp = (
        '{"mappings": [{"source_field": "Country", "source_value": 2, '
        '"canonical_field": "Country", "canonical_value": "", "reason": "x", '
        '"confidence": 0.1, "cardinality": "unmapped", "action": "safe"}]}'
    )
    result = run_tool4(T4_FIXTURE, client=_client(resp))
    assert result.payload.mappings[0].source_value == "2"


def test_run_tool4_one_to_many_demoted_to_ambiguous():
    resp = (
        '{"mappings": ['
        '{"source_field": "Country", "source_value": "US", "canonical_field": "Country", '
        '"canonical_value": "United States", "reason": "a", "confidence": 0.9, '
        '"cardinality": "one_to_one", "action": "safe"},'
        '{"source_field": "Country", "source_value": "US", "canonical_field": "Country", '
        '"canonical_value": "Canada", "reason": "b", "confidence": 0.9, '
        '"cardinality": "one_to_one", "action": "safe"}]}'
    )
    result = run_tool4(T4_FIXTURE, client=_client(resp))
    assert all(m.action == "ambiguous" for m in result.payload.mappings)


def test_run_tool4_safe_below_floor_demoted():
    resp = (
        '{"mappings": [{"source_field": "Country", "source_value": "USA", '
        '"canonical_field": "Country", "canonical_value": "United States", "reason": "x", '
        '"confidence": 0.5, "cardinality": "one_to_one", "action": "safe"}]}'
    )
    result = run_tool4(T4_FIXTURE, client=_client(resp))
    assert result.payload.mappings[0].action == "ambiguous"


def test_run_tool4_emits_cost_log(caplog):
    with caplog.at_level("INFO", logger="app.ai.tool4_standardize"):
        run_tool4(T4_FIXTURE, client=_client(GOOD_T4))
    lines = [r.getMessage() for r in caplog.records if "estimated_usd" in r.getMessage()]
    assert lines, "no cost log emitted"
    record = json.loads(lines[0])
    assert record["rule_count"] == 2
    # no raw mapped values ever reach the log
    assert "United States" not in lines[0]
