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


def _apply_confidence_floor(payload: Tool2Output) -> None:
    """Demote-only guardrail: a 'safe' below the floor becomes 'ambiguous' (manual review).
    confidence/status are self-reported by the model, so the guard only adds caution, never
    removes it. The backend's Python re-parse (§10.3) is still the real check."""
    for p in payload.proposals:
        if p.status == "safe" and p.confidence < CONFIDENCE_FLOOR:
            p.status = "ambiguous"


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
    _validate_against_inputs(payload, inputs)  # reject unknown row_ids / target type
    _apply_confidence_floor(payload)           # demote-only guardrail

    meta = AuditMeta(
        tool=TOOL, model_id=model_id, prompt_version=PROMPT_VERSION,
        input_hash=_sha(prompt), output_hash=_sha(raw), latency_ms=latency_ms,
        input_tokens=usage["inputTokens"], output_tokens=usage["outputTokens"],
    )
    _log.info(json.dumps(safe_log({
        "tool": TOOL, "model_id": model_id, "prompt_version": PROMPT_VERSION,
        "input_hash": meta.input_hash, "output_hash": meta.output_hash,
        "latency_ms": latency_ms, "input_tokens": meta.input_tokens,
        "output_tokens": meta.output_tokens, "row_count": len(payload.proposals),
        "estimated_usd": estimate_cost_usd(meta.input_tokens, meta.output_tokens),
    })))
    return ToolResult[Tool2Output](meta=meta, payload=payload)
