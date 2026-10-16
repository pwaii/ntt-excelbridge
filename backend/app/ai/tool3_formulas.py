"""Tool #3 adapter (§10.4): render the formula-generation prompt, call Bedrock, validate into
Tool3Output, then reject-whole on a hallucinated referenced header, a non-'=' formula, or a
forbidden function. The authoritative function allowlist + in-range check stay on the backend;
this is a thin caution guard. Labeled 'syntax verified,' never 'calculated.'"""
import json
import logging

from app.ai.adapter import render_prompt, sha256_hex
from app.ai.bedrock_client import BedrockClient
from app.ai.policy import MAX_OUTPUT_TOKENS, estimate_cost_usd, safe_log
from app.domain.schemas import AuditMeta, Tool3Output, ToolResult
from app.settings import settings

TOOL = "tool3_formulas"
PROMPT_VERSION = "v1"

# Placeholders the v1 prompt template declares (§10.4 inputs).
_FIELDS = ("meaning", "source_headers", "allowed_functions", "samples", "expected_type")

# Thin blocklist mirroring the §10.4 bans; BE owns the authoritative allowlist + range check.
# Matched as "TOKEN(" so a header like "Snowfall" never trips the "NOW" substring.
FORBIDDEN_TOKENS = frozenset(
    {"INDIRECT", "OFFSET", "WEBSERVICE", "HYPERLINK", "NOW", "TODAY", "RAND", "RANDBETWEEN"}
)

_log = logging.getLogger(__name__)


def _validate_against_inputs(payload: Tool3Output, inputs: dict) -> None:
    """Reject the whole response (invariant #1) on a value that isn't a formula, references a
    header never sent, or calls a forbidden function."""
    if not payload.formula_template.startswith("="):
        raise ValueError("formula_template must start with '='")
    allowed = set(inputs.get("source_headers", []))
    unknown = [h for h in payload.referenced_headers if h not in allowed]
    if unknown:
        raise ValueError(f"referenced_headers not in source_headers: {unknown}")
    upper = payload.formula_template.upper()
    hits = [t for t in FORBIDDEN_TOKENS if f"{t}(" in upper]
    if hits:
        raise ValueError(f"forbidden functions in formula: {hits}")


def run_tool3(
    inputs: dict, client: BedrockClient | None = None, model_id: str | None = None
) -> ToolResult[Tool3Output]:
    client = client or BedrockClient()
    model_id = model_id or settings.bedrock_model_id_heavy

    prompt = render_prompt(TOOL, PROMPT_VERSION, _FIELDS, inputs)
    data, raw, usage, latency_ms = client.converse_json(
        model_id, prompt, MAX_OUTPUT_TOKENS, settings.bedrock_temperature
    )
    payload = Tool3Output(**data)  # trust boundary: reject anything off-shape
    _validate_against_inputs(payload, inputs)  # reject hallucinated header / forbidden formula

    meta = AuditMeta(
        tool=TOOL, model_id=model_id, prompt_version=PROMPT_VERSION,
        input_hash=sha256_hex(prompt), output_hash=sha256_hex(raw), latency_ms=latency_ms,
        input_tokens=usage["inputTokens"], output_tokens=usage["outputTokens"],
    )
    _log.info(json.dumps(safe_log({
        "tool": TOOL, "model_id": model_id, "prompt_version": PROMPT_VERSION,
        "input_hash": meta.input_hash, "output_hash": meta.output_hash,
        "latency_ms": latency_ms, "input_tokens": meta.input_tokens,
        "output_tokens": meta.output_tokens,
        "estimated_usd": estimate_cost_usd(meta.input_tokens, meta.output_tokens),
    })))
    return ToolResult[Tool3Output](meta=meta, payload=payload)
