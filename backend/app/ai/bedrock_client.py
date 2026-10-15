"""Bedrock Converse wrapper (§10.1): explicit maxTokens, low temperature, retry only
transient service errors (botocore 'adaptive' mode), call only allowlisted models, and
parse the outermost JSON object out of the model's text.

Every call returns the parsed dict plus the raw text + usage + latency the audit meta
needs. The parsed dict is still an untrusted proposal — the tool adapter validates it
against a Pydantic schema before anything downstream trusts it.
"""
import json
import time

import boto3
from botocore.config import Config

from app.settings import settings

# Transient-only retries: 'adaptive' retries throttling/5xx and backs off; validation and
# access-denied are not retried by botocore. We never add our own retry around those.
_RETRY_CONFIG = Config(retries={"max_attempts": 5, "mode": "adaptive"})

# Models we are allowed to invoke — verified non-Marketplace at deploy preflight (§19) and
# pinned in settings. Guards against a stray/hallucinated model id reaching Bedrock.
MODEL_ALLOWLIST = frozenset({settings.bedrock_model_id, settings.bedrock_model_id_heavy})


def _extract_json(text: str) -> dict:
    """Take the outermost {...}; Nova may wrap JSON in prose or ```json fences."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in model output:\n{text}")
    return json.loads(text[start : end + 1])


class BedrockClient:
    def __init__(self, client=None):
        self._client = client or boto3.client(
            "bedrock-runtime", region_name=settings.aws_region, config=_RETRY_CONFIG
        )

    def converse_json(
        self, model_id: str, prompt: str, max_tokens: int, temperature: float = 0.0
    ) -> tuple[dict, str, dict, int]:
        """Returns (parsed_json, raw_text, usage, latency_ms). Raises ValueError for an
        unlisted model or when the response carries no JSON object."""
        if model_id not in MODEL_ALLOWLIST:
            raise ValueError(f"model {model_id!r} not in allowlist {set(MODEL_ALLOWLIST)}")

        start = time.monotonic()
        resp = self._client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        text = resp["output"]["message"]["content"][0]["text"]
        return _extract_json(text), text, resp["usage"], latency_ms
