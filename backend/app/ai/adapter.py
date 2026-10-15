"""Shared tool-adapter helpers: the prompt render + hash every run_toolN duplicated."""
import hashlib
import json

from app.ai.prompts import get_prompt


def render_prompt(tool: str, version: str, fields: tuple[str, ...], inputs: dict) -> str:
    text = get_prompt(tool, version)
    for key in fields:
        value = inputs.get(key, "")
        if not isinstance(value, str):
            value = json.dumps(value)  # serialize lists/dicts; keep caller flexible
        text = text.replace("{" + key + "}", value)
    return text


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()
