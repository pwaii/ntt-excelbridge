from app import lambda_handlers as handlers
from app.tests.test_api import FakeDynamo


def test_bedrock_uses_latest_revision_after_ai_race(monkeypatch):
    dynamo = FakeDynamo()
    dynamo.item.update(status="NORMALIZATION_PENDING", revision=4, workflow_segment=2)

    def model_call(*args, **kwargs):
        dynamo.item["revision"] += 1
        return {"tool": "tool3", "proposal_id": "proposal-1"}

    monkeypatch.setattr(handlers, "_stores", lambda: (dynamo, object()))
    monkeypatch.setattr(handlers, "run_tool_segment", model_call)

    result = handlers.bedrock_handler(
        {
            "job_id": "job-1",
            "tool": "tool3",
            "inputs": {"source": "synthetic"},
            "segment": 2,
        },
        None,
    )

    assert result["proposal_id"] == "proposal-1"
    assert dynamo.item["status"] == "FORMULA_REVIEW_PENDING"
    assert dynamo.item["revision"] == 6


def test_bedrock_does_not_regress_a_later_step_after_ai_race(monkeypatch):
    dynamo = FakeDynamo()
    dynamo.item.update(status="UPDATE_PENDING", revision=4, workflow_segment=2)

    def model_call(*args, **kwargs):
        dynamo.item["revision"] += 1
        return {"tool": "tool3", "proposal_id": "proposal-2"}

    monkeypatch.setattr(handlers, "_stores", lambda: (dynamo, object()))
    monkeypatch.setattr(handlers, "run_tool_segment", model_call)

    handlers.bedrock_handler(
        {
            "job_id": "job-1",
            "tool": "tool3",
            "inputs": {"source": "synthetic"},
            "segment": 2,
        },
        None,
    )

    assert dynamo.item["status"] == "UPDATE_PENDING"
    assert dynamo.item["revision"] == 5
