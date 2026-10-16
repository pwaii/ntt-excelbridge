"""Day-7 AI wrap-up: guard tests that lock the prompt/version pinning and the two
adversarial gaps not already covered by Days 3-5. All offline (crafted fake responses)."""
import importlib
import json as _json

import pytest
from pydantic import ValidationError

from app.ai.bedrock_client import BedrockClient, _extract_json
from app.ai.prompts import get_prompt

# (module path, run fn name, TOOL const, PROMPT_VERSION, _FIELDS) — resolved via import below.
TOOL_MODULES = [
    "app.ai.tool1_semantics",
    "app.ai.tool2_types",
    "app.ai.tool3_formulas",
    "app.ai.tool4_standardize",
    "app.ai.tool5_update",
]


@pytest.mark.parametrize("modpath", TOOL_MODULES)
def test_prompt_version_and_fields_are_pinned(modpath):
    mod = importlib.import_module(modpath)
    # version pinned to v1
    assert mod.PROMPT_VERSION == "v1", f"{modpath} drifted off v1"
    # prompt file exists for (TOOL, v1)
    text = get_prompt(mod.TOOL, "v1")  # raises FileNotFoundError if renamed/deleted
    # every declared field has a matching placeholder in the prompt
    missing = [f for f in mod._FIELDS if "{" + f + "}" not in text]
    assert not missing, f"{modpath} fields without a placeholder in prompt: {missing}"


# ---------------------------------------------------------------------------
# Adversarial guard tests
# ---------------------------------------------------------------------------

class _FakeBedrock:
    """Returns a fixed text body from converse(), like the Day 3-5 fakes."""

    def __init__(self, text: str):
        self._text = text

    def converse(self, **kwargs):
        return {
            "output": {"message": {"content": [{"text": self._text}]}},
            "usage": {"inputTokens": 1, "outputTokens": 1},
        }


def _client(text: str) -> BedrockClient:
    return BedrockClient(client=_FakeBedrock(text))


def test_extract_json_rejects_response_with_no_object():
    with pytest.raises(ValueError, match="no JSON object"):
        _extract_json("sorry, I can't help with that")


from app.ai.tool1_semantics import run_tool1
from app.ai.tool2_types import run_tool2
from app.ai.tool3_formulas import run_tool3
from app.ai.tool4_standardize import run_tool4
from app.ai.tool5_update import run_tool5

_EMPTY_CASES = [
    (run_tool1, {"comment_name": "x", "output_header": "x", "current_headers": [],
                 "normalized_headers": [], "main_headers": [], "type_summaries": {},
                 "samples": []}),
    (run_tool2, {"column_id": "c", "target_type": "date", "samples": [],
                 "type_distribution": {}, "constraints": ""}),
    (run_tool3, {"meaning": "m", "source_headers": [], "allowed_functions": [],
                 "samples": [], "expected_type": "number"}),
    (run_tool4, {"source_values": [], "canonical_candidates": [], "samples": []}),
    (run_tool5, {"current_rows": [], "candidate_rows": [], "match_key": "k"}),
]


@pytest.mark.parametrize("run_fn,inputs", _EMPTY_CASES)
def test_empty_object_response_rejected(run_fn, inputs):
    with pytest.raises(ValidationError):
        run_fn(inputs, client=_client("{}"))


# ---------------------------------------------------------------------------
# write_report persistence (Task 3 — true red→green)
# ---------------------------------------------------------------------------

def test_write_report_persists_md_and_json(tmp_path):
    from scripts.eval_tools import write_report
    rows = [{
        "tool": "tool1_semantics", "model_id": "amazon.nova-lite-v1:0",
        "in_tokens": 300, "out_tokens": 120, "latency_ms": 800, "est_usd": 0.0001,
        "checks_passed": 3, "checks_failed": [],
    }]
    md_path, json_path = write_report(rows, [], tmp_path)
    md = md_path.read_text(encoding="utf-8")
    assert md.startswith("# AI Day 7")
    assert "tool1_semantics" in md
    data = _json.loads(json_path.read_text(encoding="utf-8"))
    assert data["rows"][0]["tool"] == "tool1_semantics"
    assert data["failures"] == []
