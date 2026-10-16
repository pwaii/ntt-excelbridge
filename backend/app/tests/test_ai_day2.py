"""Day-2 AI: Bedrock Converse client + Tool #1 adapter, tested with a fake Bedrock
client (no real boto calls). Proves the invocation boundary: render -> call ->
validate -> wrap, and that off-shape model output is rejected (§10.1, §10.2)."""
import pytest
from pydantic import ValidationError

from app.ai.bedrock_client import BedrockClient
from app.ai.policy import MAX_OUTPUT_TOKENS
from app.ai.tool1_semantics import run_tool1
from app.domain.schemas import Tool1Output, ToolResult
from app.settings import settings

# A well-formed Tool1 response, wrapped in a ```json fence + prose the way Nova tends to.
GOOD_RESPONSE = (
    "Here is the result:\n```json\n"
    '{"meaning": "customer tier", '
    '"existing_column_matches": [{"column_id": "LoyaltyLevel", "confidence": 0.9, "reason": "x"}], '
    '"recommended_output_header": "Tier", "interpretation": "maps loyalty", '
    '"confidence": 0.9, "status": "confirmed", "questions_for_human": []}\n```\n'
)

FIXTURE = {
    "comment_name": "customer loyalty tier",
    "output_header": "Tier",
    "current_headers": ["CustomerID", "LoyaltyLevel", "SpendYTD"],   # structured -> adapter serializes
    "normalized_headers": ["customer_id", "loyalty_level", "spend_ytd"],
    "main_headers": [],
    "type_summaries": {"loyalty_level": "string (Gold/Silver/Bronze)"},
    "samples": [{"cell": "B2", "value": "Gold"}],
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


# --- BedrockClient ---

def test_converse_json_extracts_object_from_fenced_prose():
    data, _raw, usage, latency_ms = _client(GOOD_RESPONSE).converse_json(
        settings.bedrock_model_id, "prompt", MAX_OUTPUT_TOKENS
    )
    assert data["status"] == "confirmed"
    assert usage["inputTokens"] == 10
    assert latency_ms >= 0


def test_converse_json_rejects_unlisted_model():
    with pytest.raises(ValueError, match="allowlist"):
        _client("{}").converse_json("some.random-model-v9", "prompt", MAX_OUTPUT_TOKENS)


def test_converse_json_errors_when_no_json_object():
    with pytest.raises(ValueError, match="no JSON"):
        _client("sorry, I cannot help").converse_json(
            settings.bedrock_model_id, "prompt", MAX_OUTPUT_TOKENS
        )


# --- Tool #1 adapter ---

def test_run_tool1_renders_prompt_applies_caps_and_wraps_meta():
    client = _client(GOOD_RESPONSE)
    result = run_tool1(FIXTURE, client=client)

    assert isinstance(result, ToolResult)
    assert isinstance(result.payload, Tool1Output)
    assert result.payload.status == "confirmed"
    assert result.meta.tool == "tool1_semantics"
    assert result.meta.prompt_version == "v1"
    assert len(result.meta.input_hash) == 64 and len(result.meta.output_hash) == 64
    assert result.meta.input_tokens == 10 and result.meta.output_tokens == 5

    sent = client._client.calls[0]
    text = sent["messages"][0]["content"][0]["text"]
    assert "{comment_name}" not in text  # fully rendered, no leftover placeholders
    assert "LoyaltyLevel" in text        # structured input serialized into the prompt
    assert sent["inferenceConfig"]["maxTokens"] == MAX_OUTPUT_TOKENS


def test_run_tool1_rejects_malformed_payload():
    # confidence > 1 and required fields missing -> trust boundary must reject
    with pytest.raises(ValidationError):
        run_tool1(FIXTURE, client=_client('{"meaning": "x", "confidence": 5}'))
