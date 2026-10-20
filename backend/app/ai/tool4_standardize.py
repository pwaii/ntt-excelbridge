"""Tool #4 adapter (§10.5): render the standardization prompt, call Bedrock, validate into
Tool4Output, reject-whole on a canonical value the prompt never offered, then demote one-to-many
and over-confident 'safe' mappings to 'ambiguous'. The model may only map to supplied candidates."""
import json
import logging

from app.ai.adapter import render_prompt, sha256_hex
from app.ai.bedrock_client import BedrockClient
from app.ai.policy import (
    CONFIDENCE_FLOOR,
    MAX_OUTPUT_TOKENS,
    estimate_cost_usd,
    safe_log,
)
from app.domain.schemas import AuditMeta, Tool4Output, ToolResult
from app.settings import settings

TOOL = "tool4_standardize"
PROMPT_VERSION = "v1"

# Placeholders the v1 prompt template declares (§10.5 inputs).
_FIELDS = ("source_values", "canonical_candidates", "samples")

_log = logging.getLogger(__name__)


def _validate_against_inputs(payload: Tool4Output, inputs: dict) -> None:
    """Reject the whole response (invariant #1) if the model invented a canonical value. An
    unmapped mapping must carry an empty canonical_value; anything else must be a supplied
    candidate."""
    allowed = set(inputs.get("canonical_candidates", []))
    for m in payload.mappings:
        if m.cardinality == "unmapped":
            m.canonical_value = ""  # an unmapped row carries no canonical; Nova sometimes emits "unmapped"/"none" instead of blank
            continue
        if m.canonical_value not in allowed:
            raise ValueError(f"canonical_value {m.canonical_value!r} not in candidates")


def _apply_guardrails(payload: Tool4Output) -> None:
    """Demote-only: a source_value mapped to >1 distinct canonical_value is one-to-many (always
    ambiguous); a 'safe' below the floor is demoted too."""
    by_source: dict[str, set[str]] = {}
    for m in payload.mappings:
        by_source.setdefault(m.source_value, set()).add(m.canonical_value)
    for m in payload.mappings:
        if len(by_source[m.source_value]) > 1 or m.action == "safe" and m.confidence < CONFIDENCE_FLOOR:
            m.action = "ambiguous"


def run_tool4(
    inputs: dict, client: BedrockClient | None = None, model_id: str | None = None
) -> ToolResult[Tool4Output]:
    client = client or BedrockClient()
    model_id = model_id or settings.bedrock_model_id_heavy

    prompt = render_prompt(TOOL, PROMPT_VERSION, _FIELDS, inputs)
    data, raw, usage, latency_ms = client.converse_json(
        model_id, prompt, MAX_OUTPUT_TOKENS, settings.bedrock_temperature
    )
    payload = Tool4Output(**data)  # trust boundary: reject anything off-shape
    _validate_against_inputs(payload, inputs)  # reject invented canonical values
    _apply_guardrails(payload)                 # demote one-to-many / low-confidence

    meta = AuditMeta(
        tool=TOOL, model_id=model_id, prompt_version=PROMPT_VERSION,
        input_hash=sha256_hex(prompt), output_hash=sha256_hex(raw), latency_ms=latency_ms,
        input_tokens=usage["inputTokens"], output_tokens=usage["outputTokens"],
    )
    _log.info(json.dumps(safe_log({
        "tool": TOOL, "model_id": model_id, "prompt_version": PROMPT_VERSION,
        "input_hash": meta.input_hash, "output_hash": meta.output_hash,
        "latency_ms": latency_ms, "input_tokens": meta.input_tokens,
        "output_tokens": meta.output_tokens, "rule_count": len(payload.mappings),
        "estimated_usd": estimate_cost_usd(meta.input_tokens, meta.output_tokens),
    })))
    return ToolResult[Tool4Output](meta=meta, payload=payload)
