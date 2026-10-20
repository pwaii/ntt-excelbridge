# Decision 0020: Separate workflow metadata from revision-checked state

## Context

The API starts a Step Functions segment and then receives an execution ARN.
The segment's first Lambda can begin before the API persists that ARN. A
revision-incrementing API write can therefore make the worker's planned
revision stale, or report a successful start as a failure after the execution
has already begun. Bedrock calls add a second race because the model call can
finish after another API or worker has advanced the job.

## Decision

- Persist only `execution_arn` and `workflow_segment` through
  `DynamoStore.set_execution_metadata`. This write does not change `revision`,
  `status`, or workflow transition validation.
- After Bedrock returns, reread the job and update using the latest revision.
  The worker writes only when the job is still in the predecessor state for the
  same workflow segment. If another writer already advanced the target or a
  later state, the stale worker exits without regressing it.
- Classify `StartExecution` outcomes. Definitive AWS rejections mark the job
  `FAILED` and make retry explicit. Transport/timeout failures record an
  unknown-start error while keeping the live retry state, preventing an
  automatic duplicate execution. If execution succeeded but metadata storage
  fails, report that the workflow started and require reconciliation.
- Pass the segment and starting revision through Step Functions Bedrock task
  inputs so the worker can identify its workflow step.

## Consequences

Revision CAS remains the protection for actual state transitions and review
decisions. Metadata persistence cannot invalidate an in-flight worker. A lost
start response is intentionally not auto-retried; operators or the status API
must reconcile the execution before another start is allowed.
