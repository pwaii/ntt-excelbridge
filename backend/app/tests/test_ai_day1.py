"""Self-checks for the Day-1 AI artifacts: envelope, policy, prompt loader."""
import pytest
from pydantic import ValidationError

from app.domain.schemas import AuditMeta, ToolResult, Tool1Output


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
