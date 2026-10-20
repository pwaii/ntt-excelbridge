"""Step Functions Standard adapter for short, restartable workflow segments."""

from __future__ import annotations

import json
from typing import Any

from app.settings import settings
from app.storage.aws_session import get_stepfunctions_client


class WorkflowNotConfiguredError(RuntimeError):
    pass


class WorkflowStore:
    def __init__(self, client: Any | None = None, state_machine_arn: str | None = None) -> None:
        self.state_machine_arn = state_machine_arn if state_machine_arn is not None else settings.state_machine_arn
        # Do not initialize a real boto3 client for local synchronous mode.
        # The client is needed only after a configured state-machine ARN is used.
        self.client = client

    def _client(self) -> Any:
        if self.client is None:
            self.client = get_stepfunctions_client()
        return self.client

    def start_segment(self, job_id: str, segment: int, revision: int, *, context: dict[str, Any] | None = None, execution_name: str | None = None) -> dict[str, Any]:
        if not self.state_machine_arn:
            raise WorkflowNotConfiguredError("STATE_MACHINE_ARN is not configured")
        name = execution_name or f"{job_id}-segment-{segment}-r{revision}"
        workflow_input = {"job_id": job_id, "segment": segment, "expected_revision": revision, **(context or {})}
        response = self._client().start_execution(
            stateMachineArn=self.state_machine_arn,
            name=name[:80],
            input=json.dumps(workflow_input),
        )
        return {"execution_arn": response["executionArn"], "start_date": response.get("startDate")}

    def stop(self, execution_arn: str, cause: str = "cancelled by user") -> None:
        self._client().stop_execution(executionArn=execution_arn, cause=cause[:256])
