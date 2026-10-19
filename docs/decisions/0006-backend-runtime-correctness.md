# Decision 0006: Backend runtime correctness fixes

Date: 2026-10-18

## Decisions

### Workflow-start race

Catch only `RevisionConflictError` when persisting the Step Functions execution
ARN after a segment starts. The expected race reads the latest job; AWS,
serialization, and programming failures continue to the normal error handler.

### HTTP API JWT identity source

The Cognito JWT authorizer reads bearer tokens from
`$request.header.Authorization`. This matches the frontend/API contract and
allows SAM/API Gateway validation to transform successfully.

### State-machine dependency scope

`STATE_MACHINE_ARN` is injected only into `ApiFunction`. Worker functions do
not need it, so they must not depend on the state machine that invokes them.
This keeps the SAM dependency graph acyclic.

## Consequence

The backend handles the expected asynchronous-start race without hiding real
failures, accepts the standard authorization header, and can be transformed by
SAM without a worker/state-machine dependency cycle.
