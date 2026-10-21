"""Catch handlers must retain the job identity used to record failures."""

import json
from pathlib import Path


def test_failure_routes_preserve_job_context():
    definition = json.loads(
        (Path(__file__).resolve().parents[3] / "infra" / "statemachine.asl.json").read_text()
    )
    routes = [
        catcher
        for state in definition["States"].values()
        for catcher in state.get("Catch", [])
        if catcher["Next"] == "MarkFailed"
    ]
    assert routes
    for route in routes:
        # A missing ResultPath replaces the entire input with Error/Cause,
        # making MarkFailed's $.job_id parameter fail before Lambda runs.
        assert route["ResultPath"] == "$.workflow_error"
    assert definition["States"]["MarkFailed"]["Parameters"]["job_id.$"] == "$.job_id"
