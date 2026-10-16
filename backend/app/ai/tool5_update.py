"""Tool #5 adapter (§10.6): render the unresolved-match prompt, call Bedrock, validate into
Tool5Output, reject-whole on a selected row ID that was never offered (or an 'unmatched' row
that still carries a selection), then demote ambiguous/duplicate/conflict/low-confidence rows
to 'human_review'. The model may only SELECT from the candidate IDs supplied per row — it never
invents one. BE re-rejects any off-candidate ID at apply-time and owns conflict resolution."""
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
from app.domain.schemas import AuditMeta, Tool5Output, ToolResult
from app.settings import settings

TOOL = "tool5_update"
PROMPT_VERSION = "v1"

# Placeholders the v1 prompt template declares (§10.6 inputs).
_FIELDS = ("current_rows", "candidate_rows", "match_key")

# match_types that are never auto-applied regardless of confidence (prompt + §10.6).
_HUMAN_ONLY_TYPES = frozenset({"ambiguous", "duplicate", "conflict"})

_log = logging.getLogger(__name__)


def _validate_selections(payload: Tool5Output) -> None:
    """Reject the whole response (invariant #1) if a match selects a row ID outside the
    candidates it was offered, or marks a row 'unmatched' while still selecting one."""
    for m in payload.matches:
        if m.selected_main_row_id is not None and (
            m.selected_main_row_id not in m.candidate_main_row_ids
        ):
            raise ValueError(
                f"selected_main_row_id {m.selected_main_row_id!r} not in candidate list"
            )
        if m.match_type == "unmatched" and m.selected_main_row_id is not None:
            raise ValueError("unmatched match must have null selected_main_row_id")


def _apply_guardrails(payload: Tool5Output) -> None:
    """Demote-only: send ambiguous/duplicate/conflict and below-floor matches to human review.
    Never clears an action the model already set to review."""
    for m in payload.matches:
        if m.match_type in _HUMAN_ONLY_TYPES or m.confidence < CONFIDENCE_FLOOR:
            m.recommended_action = "human_review"


def run_tool5(
    inputs: dict, client: BedrockClient | None = None, model_id: str | None = None
) -> ToolResult[Tool5Output]:
    client = client or BedrockClient()
    model_id = model_id or settings.bedrock_model_id  # Nova Lite: structured selection, not heavy reasoning

    prompt = render_prompt(TOOL, PROMPT_VERSION, _FIELDS, inputs)
    data, raw, usage, latency_ms = client.converse_json(
        model_id, prompt, MAX_OUTPUT_TOKENS, settings.bedrock_temperature
    )
    payload = Tool5Output(**data)  # trust boundary: reject anything off-shape
    _validate_selections(payload)  # reject un-offered IDs / contradictory unmatched
    _apply_guardrails(payload)     # demote to human_review

    meta = AuditMeta(
        tool=TOOL, model_id=model_id, prompt_version=PROMPT_VERSION,
        input_hash=sha256_hex(prompt), output_hash=sha256_hex(raw), latency_ms=latency_ms,
        input_tokens=usage["inputTokens"], output_tokens=usage["outputTokens"],
    )
    _log.info(json.dumps(safe_log({
        "tool": TOOL, "model_id": model_id, "prompt_version": PROMPT_VERSION,
        "input_hash": meta.input_hash, "output_hash": meta.output_hash,
        "latency_ms": latency_ms, "input_tokens": meta.input_tokens,
        "output_tokens": meta.output_tokens, "rule_count": len(payload.matches),
        "estimated_usd": estimate_cost_usd(meta.input_tokens, meta.output_tokens),
    })))
    return ToolResult[Tool5Output](meta=meta, payload=payload)
