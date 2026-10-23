"""Tool #3 adapter (§10.4): render the formula-generation prompt, call Bedrock, validate into
Tool3Output, then reject-whole on a hallucinated referenced header, a non-'=' formula, or a
forbidden function. The authoritative function allowlist + in-range check stay on the backend;
this is a thin caution guard. Labeled 'syntax verified,' never 'calculated.'"""
import json
import logging
import re

from openpyxl.utils import get_column_letter

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


def _normalize_formula_references(payload: Tool3Output, inputs: dict) -> None:
    """Convert model header references into ordinary row-relative A1 formulas.

    Plain worksheets do not support Excel table references such as
    ``[@Quantity]``. Converting only headers explicitly supplied to the model
    keeps the formula deterministic while preserving the formula allowlist and
    range checks performed later by the review gate.
    """
    headers = [str(header) for header in inputs.get("source_headers", [])]
    formula = payload.formula_template
    for index, header in sorted(enumerate(headers, start=1), key=lambda item: len(item[1]), reverse=True):
        column = get_column_letter(index)
        escaped = re.escape(header)
        formula = re.sub(rf"\[@{escaped}\]", f"{column}{{row}}", formula, flags=re.IGNORECASE)
        formula = re.sub(
            rf"(?<![A-Za-z0-9_]){escaped}(?![A-Za-z0-9_])",
            f"{column}{{row}}",
            formula,
            flags=re.IGNORECASE,
        )
    # The model sometimes doubles the placeholder ("C{row}{row}" -> "C1010" after substitution,
    # out of range). {row} is always one row number per reference, so collapse any run of them.
    payload.formula_template = re.sub(r"(?:\{row\})+", "{row}", formula)


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
    _normalize_formula_references(payload, inputs)
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
