"""Self-checks for the Day-1 AI artifacts: envelope, policy, prompt loader."""
import pytest
from pydantic import ValidationError

from app.domain.schemas import AuditMeta, Tool1Output, ToolResult


def _meta() -> AuditMeta:
    return AuditMeta(
        tool="tool1_semantics", model_id="amazon.nova-lite-v1:0", prompt_version="v1",
        input_hash="a" * 64, output_hash="b" * 64,
        latency_ms=123, input_tokens=50, output_tokens=20,
    )


def _tool1_payload() -> Tool1Output:
    return Tool1Output(
        meaning="customer tier", recommended_output_header="Tier",
        interpretation="maps loyalty level", confidence=0.9, status="confirmed",
    )


def test_tool_result_wraps_meta_and_payload():
    r = ToolResult[Tool1Output](meta=_meta(), payload=_tool1_payload())
    assert r.meta.tool == "tool1_semantics"
    assert r.payload.recommended_output_header == "Tier"


def test_tool_result_rejects_payload_not_matching_type():
    with pytest.raises(ValidationError):
        ToolResult[Tool1Output](meta=_meta(), payload={"not": "a tool1 output"})


from app.ai import policy


def test_caps_sourced_from_settings():
    assert policy.MAX_ROWS == 50_000
    assert policy.MAX_OUTPUT_TOKENS == 2048
    assert policy.MAX_SAMPLES_PER_COLUMN == 20
    assert policy.MAX_CANDIDATE_MATCHES == 25


def test_safe_log_keeps_only_allowlisted_fields():
    dirty = {"tool": "tool1_semantics", "input_tokens": 5,
             "raw_value": "john@example.com", "cell": "Smith, 99 High St"}
    clean = policy.safe_log(dirty)
    assert clean == {"tool": "tool1_semantics", "input_tokens": 5}
    assert "raw_value" not in clean and "cell" not in clean


def test_redact_sample_preserves_shape_not_content():
    assert policy.redact_sample("John99") == "xxxx##"
    assert policy.redact_sample("a@b.com") == "x@x.xxx"
    assert policy.redact_sample("") == ""


from app.ai.prompts import TOOLS, get_prompt


def test_get_prompt_loads_every_tool_v1():
    for tool in TOOLS:
        text = get_prompt(tool)
        assert text.strip(), f"{tool} prompt is empty"
        assert "do not invent" in text.lower()  # the core trust rule must be stated


def test_get_prompt_unknown_tool_raises():
    with pytest.raises(FileNotFoundError):
        get_prompt("tool9_nonexistent")
