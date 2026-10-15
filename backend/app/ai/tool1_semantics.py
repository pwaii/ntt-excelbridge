"""Tool #1 adapter (§10.2): render the semantic-verification prompt from inspection
inputs, call Bedrock, validate the response into Tool1Output (the trust boundary), and
wrap it with Python-computed AuditMeta. The model only verifies meaning / points at
candidate source columns — it never creates values."""
import hashlib
import json

from app.ai.bedrock_client import BedrockClient
from app.ai.policy import MAX_OUTPUT_TOKENS
from app.ai.prompts import get_prompt
from app.domain.schemas import AuditMeta, Tool1Output, ToolResult
from app.settings import settings

TOOL = "tool1_semantics"
PROMPT_VERSION = "v1"

# Placeholders the v1 prompt template declares (§10.2 inputs).
_FIELDS = (
    "comment_name", "output_header", "current_headers", "normalized_headers",
    "main_headers", "type_summaries", "samples",
)


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


def run_tool1(
    inputs: dict, client: BedrockClient | None = None, model_id: str | None = None
) -> ToolResult[Tool1Output]:
    client = client or BedrockClient()
    model_id = model_id or settings.bedrock_model_id

    prompt = _render(inputs)
    data, raw, usage, latency_ms = client.converse_json(
        model_id, prompt, MAX_OUTPUT_TOKENS, settings.bedrock_temperature
    )
    payload = Tool1Output(**data)  # trust boundary: reject anything off-shape

    meta = AuditMeta(
        tool=TOOL, model_id=model_id, prompt_version=PROMPT_VERSION,
        input_hash=_sha(prompt), output_hash=_sha(raw), latency_ms=latency_ms,
        input_tokens=usage["inputTokens"], output_tokens=usage["outputTokens"],
    )
    return ToolResult[Tool1Output](meta=meta, payload=payload)
