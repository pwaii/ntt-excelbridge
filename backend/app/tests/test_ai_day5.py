"""Day-5 AI: Tool #5 unresolved-match adapter, tested with a fake Bedrock client (no real
boto calls). The model may only SELECT from the candidate IDs supplied for each row, or
return 'unmatched'."""
import json

import pytest
from pydantic import ValidationError

from app.ai.tool5_update import run_tool5
from app.domain.schemas import Tool5Output, ToolResult


class FakeBedrock:
    """Stands in for a boto3 bedrock-runtime client. Records the converse() kwargs."""

    def __init__(self, text: str, usage: dict | None = None):
        self._text = text
        self._usage = usage or {"inputTokens": 10, "outputTokens": 5}
        self.calls: list[dict] = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "output": {"message": {"content": [{"text": self._text}]}},
            "usage": self._usage,
        }


def _client(text: str, usage: dict | None = None):
    from app.ai.bedrock_client import BedrockClient

    return BedrockClient(client=FakeBedrock(text, usage))


T5_FIXTURE = {
    "current_rows": [
        {"current_row_id": "c1", "candidate_main_row_ids": ["m1", "m2"], "fields": {"Email": "a@x.com"}},
        {"current_row_id": "c2", "candidate_main_row_ids": [], "fields": {"Email": "zzz@x.com"}},
    ],
    "candidate_rows": [
        {"main_row_id": "m1", "fields": {"Email": "a@x.com"}},
        {"main_row_id": "m2", "fields": {"Email": "other@x.com"}},
    ],
    "match_key": "Email",
}

# One confident exact match + one confident no-match (neither gets demoted).
GOOD_T5 = (
    '{"matches": ['
    '{"current_row_id": "c1", "candidate_main_row_ids": ["m1"], '
    '"selected_main_row_id": "m1", "match_type": "exact", "confidence": 0.95, '
    '"reason": "email equal", "recommended_action": "auto"},'
    '{"current_row_id": "c2", "candidate_main_row_ids": [], '
    '"selected_main_row_id": null, "match_type": "unmatched", "confidence": 0.9, '
    '"reason": "no candidate", "recommended_action": "skip"}]}'
)


def test_run_tool5_valid_match_wraps_meta():
    result = run_tool5(T5_FIXTURE, client=_client(GOOD_T5))
    assert isinstance(result, ToolResult)
    assert isinstance(result.payload, Tool5Output)
    assert result.payload.matches[0].selected_main_row_id == "m1"
    assert result.payload.matches[1].selected_main_row_id is None  # unmatched stays null
    assert result.meta.tool == "tool5_update"
    assert result.meta.prompt_version == "v1"
    assert len(result.meta.input_hash) == 64 and len(result.meta.output_hash) == 64
    assert result.meta.input_tokens == 10 and result.meta.output_tokens == 5


def test_run_tool5_renders_prompt():
    client = _client(GOOD_T5)
    run_tool5(T5_FIXTURE, client=client)
    text = client._client.calls[0]["messages"][0]["content"][0]["text"]
    assert "{current_rows}" not in text  # fully rendered
    assert "m1" in text                  # candidate id serialized into the prompt


def test_run_tool5_rejects_malformed_payload():
    bad = (
        '{"matches": [{"current_row_id": "c1", "candidate_main_row_ids": ["m1"], '
        '"selected_main_row_id": "m1", "match_type": "exact", "confidence": 5, '
        '"reason": "r", "recommended_action": "auto"}]}'
    )
    with pytest.raises(ValidationError):
        run_tool5(T5_FIXTURE, client=_client(bad))


def test_run_tool5_rejects_uncandidate_selection():
    # selected_main_row_id "m9" was never offered for this row -> reject whole (invariant #1)
    resp = (
        '{"matches": [{"current_row_id": "c1", "candidate_main_row_ids": ["m1"], '
        '"selected_main_row_id": "m9", "match_type": "exact", "confidence": 0.9, '
        '"reason": "r", "recommended_action": "auto"}]}'
    )
    with pytest.raises(ValueError, match="candidate"):
        run_tool5(T5_FIXTURE, client=_client(resp))


def test_run_tool5_rejects_unmatched_with_selection():
    # match_type unmatched but a row id was selected -> contradictory output, reject whole
    resp = (
        '{"matches": [{"current_row_id": "c1", "candidate_main_row_ids": ["m1"], '
        '"selected_main_row_id": "m1", "match_type": "unmatched", "confidence": 0.9, '
        '"reason": "r", "recommended_action": "skip"}]}'
    )
    with pytest.raises(ValueError, match="unmatched"):
        run_tool5(T5_FIXTURE, client=_client(resp))


def test_run_tool5_ambiguous_demoted_to_human_review():
    resp = (
        '{"matches": [{"current_row_id": "c1", "candidate_main_row_ids": ["m1", "m2"], '
        '"selected_main_row_id": "m1", "match_type": "ambiguous", "confidence": 0.95, '
        '"reason": "two close", "recommended_action": "auto"}]}'
    )
    result = run_tool5(T5_FIXTURE, client=_client(resp))
    assert result.payload.matches[0].recommended_action == "human_review"


def test_run_tool5_below_floor_demoted_to_human_review():
    resp = (
        '{"matches": [{"current_row_id": "c1", "candidate_main_row_ids": ["m1"], '
        '"selected_main_row_id": "m1", "match_type": "exact", "confidence": 0.5, '
        '"reason": "r", "recommended_action": "auto"}]}'
    )
    result = run_tool5(T5_FIXTURE, client=_client(resp))
    assert result.payload.matches[0].recommended_action == "human_review"


def test_run_tool5_emits_cost_log(caplog):
    with caplog.at_level("INFO", logger="app.ai.tool5_update"):
        run_tool5(
            T5_FIXTURE,
            client=_client(GOOD_T5, usage={"inputTokens": 100, "outputTokens": 40}),
        )
    lines = [r.getMessage() for r in caplog.records if "estimated_usd" in r.getMessage()]
    assert lines, "no cost log emitted"
    record = json.loads(lines[0])
    assert record["rule_count"] == 2
    assert record["input_tokens"] == 100 and record["output_tokens"] == 40
    # no raw field values ever reach the log
    assert "a@x.com" not in lines[0]


def test_run_tool5_pages_large_unresolved_sets(monkeypatch):
    # A single huge response truncates at the token cap; page it instead (AI-004). Each page
    # carries one current row, so a per-prompt fake returns just that row's match.
    from app.ai import tool5_update
    from app.ai.bedrock_client import BedrockClient

    monkeypatch.setattr(tool5_update.settings, "max_tool5_rows", 1)

    class PerRowFake:
        def __init__(self):
            self.calls = []

        def converse(self, **kwargs):
            self.calls.append(kwargs)
            text = kwargs["messages"][0]["content"][0]["text"]
            rid = "c1" if "c1" in text else "c2"  # each page carries exactly one current row
            return {
                "output": {"message": {"content": [{"text": (
                    '{"matches": [{"current_row_id": "' + rid + '", '
                    '"candidate_main_row_ids": [], "selected_main_row_id": null, '
                    '"match_type": "unmatched", "confidence": 0.9, '
                    '"reason": "no candidate", "recommended_action": "skip"}]}'
                )}]}},
                "usage": {"inputTokens": 7, "outputTokens": 3},
            }

    inputs = {
        "current_rows": [
            {"current_row_id": "c1", "candidate_main_row_ids": [], "fields": {"Email": "a@x.com"}},
            {"current_row_id": "c2", "candidate_main_row_ids": [], "fields": {"Email": "b@x.com"}},
        ],
        "candidate_rows": [],
        "match_key": "Email",
    }
    fake = PerRowFake()
    result = run_tool5(inputs, client=BedrockClient(client=fake))
    assert len(fake.calls) == 2  # one page per row
    assert {m.current_row_id for m in result.payload.matches} == {"c1", "c2"}
    assert result.meta.input_tokens == 14 and result.meta.output_tokens == 6  # summed across pages


def test_run_tool5_emits_deterministic_matches_without_calling_bedrock():
    from app.ai.bedrock_client import BedrockClient

    fake = FakeBedrock('{"matches":[]}')
    result = run_tool5(
        {
            "current_rows": [],
            "candidate_rows": [],
            "match_key": "CustomerID",
            "deterministic_matches": [
                {
                    "current_row_id": "Current!2",
                    "candidate_main_row_ids": ["Main!2"],
                    "selected_main_row_id": "Main!2",
                }
            ],
        },
        client=BedrockClient(client=fake),
    )
    assert fake.calls == []
    assert result.payload.matches[0].selected_main_row_id == "Main!2"
