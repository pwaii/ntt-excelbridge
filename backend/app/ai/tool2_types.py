"""Tool #2 adapter (§10.3, ADR D4): render the type-normalization prompt, call Bedrock,
validate the response into Tool2Output (shape), reject an off-allowlist target type, and
demote over-confident 'safe' rules. Tool #2 returns ONE RULE PER VALUE-PATTERN; the backend
applies each rule to every matching cell and re-parses in Python before acceptance."""
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

# Models sometimes return a programming-language spelling even though the prompt
# asks for the backend vocabulary. Normalize only unambiguous aliases at this
# trust boundary; unknown values remain hard failures.
TARGET_TYPE_ALIASES = {
    "str": "string",
    "text": "string",
    "int": "integer",
    "float": "number",
    "double": "number",
    "decimal": "number",
    "bool": "boolean",
    **{name: name for name in ALLOWED_TARGET_TYPES},
}

_log = logging.getLogger(__name__)


def _canonical_target_type(value: str) -> str:
    # Inspection labels differ from the public rule vocabulary. Also handle
    # reports created before the quality worker started emitting canonical names.
    return {
        "int": "integer", "bool": "boolean", "decimal": "number",
        "percentage": "number", "text": "string", "identifier": "string",
        "identifier-like": "string", "formula": "string",
    }.get(value, value)


def _validate_against_inputs(payload: Tool2Output) -> None:
    """Reject the whole response (invariant #1) if the model used an unknown target type.
    Rules describe value-patterns, not prompt rows, so there is no row-id set to check —
    the backend re-parses every applied cell, which is the real safety gate (§10.3)."""
    raw_target_type = payload.target_type.strip().lower()
    normalized_target_type = TARGET_TYPE_ALIASES.get(raw_target_type)
    if normalized_target_type is None:
        raise ValueError(
            f"target_type {payload.target_type!r} not in {set(ALLOWED_TARGET_TYPES)}"
        )
    payload.target_type = normalized_target_type


def _apply_confidence_floor(payload: Tool2Output) -> None:
    """Demote-only guardrail: a 'safe' rule below the floor becomes 'ambiguous' (manual
    review). confidence/status are self-reported, so the guard only adds caution."""
    for r in payload.rules:
        if r.status == "safe" and r.confidence < CONFIDENCE_FLOOR:
            r.status = "ambiguous"


def run_tool2(
    inputs: dict, client: BedrockClient | None = None, model_id: str | None = None
) -> ToolResult[Tool2Output]:
    client = client or BedrockClient()
    model_id = model_id or settings.bedrock_model_id

    inputs = {**inputs, "target_type": _canonical_target_type(inputs.get("target_type", ""))}
    if inputs["target_type"] not in ALLOWED_TARGET_TYPES:
        raise ValueError(f"unsupported input target_type: {inputs['target_type']!r}")
    prompt = render_prompt(TOOL, PROMPT_VERSION, _FIELDS, inputs)
    data, raw, usage, latency_ms = client.converse_json(
        model_id, prompt, MAX_OUTPUT_TOKENS, settings.bedrock_temperature
    )
    payload = Tool2Output(**data)  # trust boundary: reject anything off-shape
    payload.target_type = _canonical_target_type(payload.target_type)
    _validate_against_inputs(payload)  # reject off-allowlist target type
    _apply_confidence_floor(payload)   # demote-only guardrail

    meta = AuditMeta(
        tool=TOOL, model_id=model_id, prompt_version=PROMPT_VERSION,
        input_hash=sha256_hex(prompt), output_hash=sha256_hex(raw), latency_ms=latency_ms,
        input_tokens=usage["inputTokens"], output_tokens=usage["outputTokens"],
    )
    _log.info(json.dumps(safe_log({
        "tool": TOOL, "model_id": model_id, "prompt_version": PROMPT_VERSION,
        "input_hash": meta.input_hash, "output_hash": meta.output_hash,
        "latency_ms": latency_ms, "input_tokens": meta.input_tokens,
        "output_tokens": meta.output_tokens, "rule_count": len(payload.rules),
        "estimated_usd": estimate_cost_usd(meta.input_tokens, meta.output_tokens),
    })))
    return ToolResult[Tool2Output](meta=meta, payload=payload)
