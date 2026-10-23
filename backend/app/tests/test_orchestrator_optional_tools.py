"""Segment 2 must survive an optional-tool guardrail reject-whole (e.g. a forbidden formula
function) and still open the transformation gate, while a core-tool failure still propagates."""

import pytest

from app.workers import orchestrator


class _Dynamo:
    def __init__(self, item):
        self._item = item

    def get_job(self, _job_id):
        return self._item


def _run(monkeypatch, item, failing):
    calls, gates = [], []

    def fake_bedrock(event, _ctx):
        calls.append((event["tool"], event["slot"]))
        if event["tool"] == failing:
            raise ValueError("forbidden functions in formula: ['INDIRECT']")

    monkeypatch.setattr(orchestrator, "bedrock_handler", fake_bedrock)
    monkeypatch.setattr(orchestrator, "quality_gate_handler", lambda e, _c: gates.append(e))
    orchestrator.run_bedrock_segment("job", _Dynamo(item), None)
    return calls, gates


def test_rejected_tool3_does_not_fail_the_segment(monkeypatch):
    item = {"config": {"standardize": True}, "files": {"input": {"key": "k"}}}
    calls, gates = _run(monkeypatch, item, failing="tool3")
    # Ran past the rejected tool3 and still invoked tool4, then opened the transformation gate.
    assert ("tool3", "input") in calls and ("tool4", "input") in calls
    assert gates and gates[0]["gate"] == "transformation"


def test_core_tool_failure_still_propagates(monkeypatch):
    item = {"config": {}, "files": {"input": {"key": "k"}}}
    with pytest.raises(ValueError):
        _run(monkeypatch, item, failing="tool1")
