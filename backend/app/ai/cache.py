"""Response cache (§15, ADR 0001 residual note): wrap a BedrockClient and memoize
converse_json by sha256(model_id + prompt) to a JSON file, so repeat demo/eval runs don't
re-call Bedrock. Safe because a human reviews every result — a stale cached proposal can
never auto-apply. Drop-in: identical converse_json signature, so it slots in wherever an
adapter accepts an injected client."""
import json
from pathlib import Path

from app.ai.adapter import sha256_hex
from app.ai.bedrock_client import BedrockClient

# backend/.cache/bedrock/ — module-level so tests can monkeypatch it.
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "bedrock"


class CachingBedrockClient:
    def __init__(self, inner: BedrockClient | None = None):
        self._inner = inner or BedrockClient()

    def converse_json(
        self, model_id: str, prompt: str, max_tokens: int, temperature: float = 0.0
    ) -> tuple[dict, str, dict, int]:
        key = sha256_hex(model_id + "\x00" + prompt)
        path = CACHE_DIR / f"{key}.json"
        if path.exists():
            d = json.loads(path.read_text(encoding="utf-8"))
            return d["parsed"], d["raw"], d["usage"], d["latency_ms"]
        parsed, raw, usage, latency_ms = self._inner.converse_json(
            model_id, prompt, max_tokens, temperature
        )
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"parsed": parsed, "raw": raw, "usage": usage,
                        "latency_ms": latency_ms}),
            encoding="utf-8",
        )
        return parsed, raw, usage, latency_ms
