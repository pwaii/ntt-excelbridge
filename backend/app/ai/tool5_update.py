"""Tool #5 adapter: select only from backend-generated candidate row IDs."""

from __future__ import annotations

import json
import logging

from app.ai.adapter import render_prompt, sha256_hex
from app.ai.bedrock_client import BedrockClient
from app.ai.policy import CONFIDENCE_FLOOR, estimate_cost_usd, safe_log
from app.domain.enums import MatchType
from app.domain.schemas import AuditMeta, Tool5Match, Tool5Output, ToolResult
from app.settings import settings

TOOL = "tool5_update"
PROMPT_VERSION = "v1"
_FIELDS = ("current_rows", "candidate_rows", "match_key")
_HUMAN_ONLY_TYPES = frozenset({"ambiguous", "duplicate", "conflict"})
_log = logging.getLogger(__name__)


def _validate_against_inputs(payload: Tool5Output, inputs: dict) -> Tool5Output:
    allowed_current = {
        str(row.get("current_row_id"))
        for row in inputs.get("current_rows", [])
        if row.get("current_row_id")
    }
    allowed_current.update(
        str(row.get("current_row_id"))
        for row in inputs.get("deterministic_matches", [])
        if row.get("current_row_id")
    )
    candidate_map = {
        str(row.get("current_row_id")): set(row.get("candidate_main_row_ids", []))
        for row in inputs.get("current_rows", [])
    }
    for match in payload.matches:
        if match.current_row_id not in allowed_current:
            raise ValueError(f"unknown current_row_id: {match.current_row_id}")
        candidates = candidate_map.get(match.current_row_id, set(match.candidate_main_row_ids))
        if set(match.candidate_main_row_ids) - candidates:
            raise ValueError(f"Tool #5 returned candidates not supplied for {match.current_row_id}")
        if match.selected_main_row_id and match.selected_main_row_id not in candidates:
            raise ValueError(f"selected_main_row_id is not a supplied candidate for {match.current_row_id}")
        if match.match_type == MatchType.UNMATCHED and match.selected_main_row_id:
            raise ValueError("unmatched Tool #5 result cannot select a main row")
    seen = set()
    for match in payload.matches:
        if match.current_row_id in seen:
            raise ValueError(f"duplicate Tool #5 result for {match.current_row_id}")
        seen.add(match.current_row_id)
    return payload


def _apply_guardrails(payload: Tool5Output) -> Tool5Output:
    """Demote risky or low-confidence matches; never auto-apply them."""

    for match in payload.matches:
        if match.match_type in _HUMAN_ONLY_TYPES or match.confidence < CONFIDENCE_FLOOR:
            match.recommended_action = "human_review"
    return payload


def run_tool5(
    inputs: dict,
    client: BedrockClient | None = None,
    model_id: str | None = None,
) -> ToolResult[Tool5Output]:
    client = client or BedrockClient()
    model_id = model_id or settings.bedrock_model_id
    current_rows = inputs.get("current_rows") or []
    if current_rows:
        # Page unresolved rows so a large set never truncates the model's JSON array (AI-004).
        # candidate_rows stay unfiltered per page: the row explosion is in current_rows, and
        # the candidate set is already bounded by max_candidate_matches during matching.
        prompts, raws, matches = [], [], []
        in_tokens = out_tokens = latency_ms = 0
        step = max(1, int(settings.max_tool5_rows))
        for start in range(0, len(current_rows), step):
            page_inputs = {**inputs, "current_rows": current_rows[start:start + step]}
            prompt = render_prompt(TOOL, PROMPT_VERSION, _FIELDS, page_inputs)
            data, raw, usage, latency = client.converse_json(
                model_id, prompt, settings.bedrock_max_tokens_tool5, settings.bedrock_temperature
            )
            page = _validate_against_inputs(Tool5Output(**data), page_inputs)
            matches.extend(page.matches)
            prompts.append(prompt)
            raws.append(raw)
            in_tokens += usage["inputTokens"]
            out_tokens += usage["outputTokens"]
            latency_ms += latency
        prompt = "\n".join(prompts)
        raw = "\n".join(raws)
        usage = {"inputTokens": in_tokens, "outputTokens": out_tokens}
        payload = _apply_guardrails(Tool5Output(matches=matches))
    else:
        # Exact deterministic matching already resolved every row. Avoid an
        # empty Bedrock call while retaining a hashable audit envelope.
        data = {"matches": []}
        prompt = render_prompt(TOOL, PROMPT_VERSION, _FIELDS, inputs)
        raw = json.dumps(data, sort_keys=True)
        usage = {"inputTokens": 0, "outputTokens": 0}
        latency_ms = 0
        payload = _apply_guardrails(_validate_against_inputs(Tool5Output(**data), inputs))

    deterministic = [
        Tool5Match(
            current_row_id=item["current_row_id"],
            candidate_main_row_ids=item["candidate_main_row_ids"],
            selected_main_row_id=item["selected_main_row_id"],
            match_type=MatchType.EXACT,
            confidence=1.0,
            reason="unique normalized business-key match",
            recommended_action="human_review",
        )
        for item in inputs.get("deterministic_matches", [])
    ]
    payload = Tool5Output(matches=deterministic + payload.matches)
    meta = AuditMeta(
        tool=TOOL,
        model_id=model_id,
        prompt_version=PROMPT_VERSION,
        input_hash=sha256_hex(prompt),
        output_hash=sha256_hex(raw),
        latency_ms=latency_ms,
        input_tokens=usage["inputTokens"],
        output_tokens=usage["outputTokens"],
    )
    _log.info(json.dumps(safe_log({
        "tool": TOOL,
        "model_id": model_id,
        "prompt_version": PROMPT_VERSION,
        "input_hash": meta.input_hash,
        "output_hash": meta.output_hash,
        "latency_ms": latency_ms,
        "input_tokens": meta.input_tokens,
        "output_tokens": meta.output_tokens,
        "row_count": len(payload.matches),
        "rule_count": len(payload.matches),
        "estimated_usd": estimate_cost_usd(meta.input_tokens, meta.output_tokens),
    })))
    return ToolResult[Tool5Output](meta=meta, payload=payload)
