"""Day-5 Tool #5 tests: bounded candidate IDs are the model trust boundary."""

import pytest

from app.ai.tool5_update import run_tool5


class FakeBedrock:
    def __init__(self, text: str):
        self.text = text
        self.calls = 0

    def converse(self, **kwargs):
        self.calls += 1
        return {
            "output": {"message": {"content": [{"text": self.text}]}},
            "usage": {"inputTokens": 10, "outputTokens": 5},
        }


def _client(text: str):
    from app.ai.bedrock_client import BedrockClient

    return BedrockClient(client=FakeBedrock(text))


def test_tool5_accepts_only_a_supplied_candidate():
    result = run_tool5(
        {
            "current_rows": [
                {
                    "current_row_id": "Current!2",
                    "candidate_main_row_ids": ["Main!2"],
                }
            ],
            "candidate_rows": [{"row_id": "Main!2", "CustomerID": "ACME-100"}],
            "match_key": "CustomerID",
            "deterministic_matches": [],
        },
        client=_client(
            '{"matches":[{"current_row_id":"Current!2","candidate_main_row_ids":["Main!2"],"selected_main_row_id":"Main!2","match_type":"normalized","confidence":0.91,"reason":"close key","recommended_action":"human_review"}]}'
        ),
    )
    assert result.payload.matches[0].selected_main_row_id == "Main!2"


def test_tool5_rejects_an_invented_candidate():
    with pytest.raises(ValueError, match="not a supplied candidate"):
        run_tool5(
            {
                "current_rows": [{"current_row_id": "Current!2", "candidate_main_row_ids": ["Main!2"]}],
                "candidate_rows": [{"row_id": "Main!2"}],
                "match_key": "CustomerID",
                "deterministic_matches": [],
            },
            client=_client(
                '{"matches":[{"current_row_id":"Current!2","candidate_main_row_ids":["Main!2"],"selected_main_row_id":"Main!999","match_type":"normalized","confidence":0.91,"reason":"invented","recommended_action":"human_review"}]}'
            ),
        )


def test_tool5_does_not_call_bedrock_when_every_row_is_exact():
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
        client=_client_with_fake(fake),
    )
    assert fake.calls == 0
    assert result.payload.matches[0].match_type.value == "exact"


def _client_with_fake(fake: FakeBedrock):
    from app.ai.bedrock_client import BedrockClient

    return BedrockClient(client=fake)
