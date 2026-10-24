"""bedrock_handler is the shared Lambda both the in-process orchestrator and the deployed Step
Functions path call per tool. These lock the empty-prompt skip and optional-tool reject handling
at that layer, so the behavior holds on the deployed state machine (which hardcodes the sequence)."""

import pytest

from app import lambda_handlers as handlers
from app.tests.test_api import FakeDynamo, FakeS3


def _stores(monkeypatch, status="NORMALIZATION_PENDING", comment_name=""):
    dynamo = FakeDynamo()
    dynamo.item.update(job_id="job-1", revision=1, status=status, workflow_segment=2,
                       config={"comment_name": comment_name})
    calls = []
    monkeypatch.setattr(handlers, "_stores", lambda: (dynamo, FakeS3()))
    monkeypatch.setattr(handlers, "run_tool_segment",
                        lambda *a, **k: (calls.append(a[1]), {"status": "proposed"})[1])
    return dynamo, calls


def test_empty_prompt_skips_tool3_proposal_but_advances_status(monkeypatch):
    dynamo, calls = _stores(monkeypatch, comment_name="")
    result = handlers.bedrock_handler({"job_id": "job-1", "tool": "tool3", "segment": 2}, None)
    assert result["status"] == "skipped"
    assert "tool3" not in calls  # no proposal was generated
    assert dynamo.item["status"] == "FORMULA_REVIEW_PENDING"  # state machine still advances


def test_prompt_present_runs_tool3(monkeypatch):
    # Pass inputs in the event so _tool_inputs (S3-backed) is bypassed for this unit test.
    _dynamo, calls = _stores(monkeypatch, comment_name="Add a Stock Level column")
    handlers.bedrock_handler({"job_id": "job-1", "tool": "tool3", "segment": 2, "inputs": {"meaning": "x"}}, None)
    assert "tool3" in calls


def test_optional_tool_guardrail_reject_does_not_fail_job(monkeypatch):
    dynamo, _calls = _stores(monkeypatch, status="FORMULA_REVIEW_PENDING", comment_name="x")
    monkeypatch.setattr(handlers, "run_tool_segment",
                        lambda *a, **k: (_ for _ in ()).throw(ValueError("invented canonical value")))
    result = handlers.bedrock_handler({"job_id": "job-1", "tool": "tool4", "segment": 2, "inputs": {"source_values": []}}, None)
    assert result["status"] == "rejected"  # swallowed, job continues
    assert dynamo.item["status"] == "STANDARDIZATION_PENDING"


def test_core_tool_failure_still_raises(monkeypatch):
    _stores(monkeypatch, comment_name="x")
    monkeypatch.setattr(handlers, "run_tool_segment",
                        lambda *a, **k: (_ for _ in ()).throw(ValueError("boom")))
    with pytest.raises(ValueError):
        handlers.bedrock_handler({"job_id": "job-1", "tool": "tool2", "inputs": {"x": 1}}, None)
