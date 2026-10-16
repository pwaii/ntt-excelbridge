"""AI-safety policy (§14.3, §15): prompt/sample caps, sample redaction, log allowlist.

Caps are re-exported from settings so there is one source of truth; the demo
guardrails already define rows/tokens. Redaction and the log allowlist keep raw
sensitive cell values out of prompts, logs and any logged payload.
"""
from app.settings import settings

MAX_ROWS = settings.max_data_rows
MAX_OUTPUT_TOKENS = settings.bedrock_max_tokens
MAX_SAMPLES_PER_COLUMN = settings.max_samples_per_column
MAX_CANDIDATE_MATCHES = settings.max_candidate_matches

# --- Cost (§15, USD cap) ---
PRICE_PER_1K_INPUT_USD = 0.0   # PLACEHOLDER — Nova pricing not in surviving extract, confirm with team
PRICE_PER_1K_OUTPUT_USD = 0.0  # PLACEHOLDER


def estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    """Per-call USD estimate from self-metered token counts. Prices are placeholders."""
    return (input_tokens / 1000) * PRICE_PER_1K_INPUT_USD + (
        output_tokens / 1000
    ) * PRICE_PER_1K_OUTPUT_USD


# Only these keys may ever be logged (§14 / §16): hashes, IDs, counts — never cell values.
CONFIDENCE_FLOOR = 0.80  # PLACEHOLDER — not in surviving extract, confirm with team

SAFE_LOG_FIELDS = {
    "tool", "model_id", "prompt_version", "input_hash", "output_hash",
    "latency_ms", "input_tokens", "output_tokens", "row_count", "rule_count", "estimated_usd",
}


def safe_log(d: dict) -> dict:
    """Drop every field not on the allowlist, so raw values can't leak into logs."""
    return {k: v for k, v in d.items() if k in SAFE_LOG_FIELDS}


def redact_sample(value: str) -> str:
    """Shape-preserving mask for logs/display: digits->#, letters->x, punctuation kept."""
    return "".join("#" if c.isdigit() else "x" if c.isalpha() else c for c in value)
