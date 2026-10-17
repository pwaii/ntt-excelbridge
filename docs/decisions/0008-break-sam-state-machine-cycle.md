# ADR 0008: Scope the state-machine ARN to the API function

## Status

Accepted for the demo implementation.

## Context

SAM lint detected a circular dependency. The global Lambda environment injected
`STATE_MACHINE_ARN` into every function, including worker functions referenced
by the state machine definition. That made each worker depend on the state
machine while the state machine depended on the worker functions.

## Decision

Remove `STATE_MACHINE_ARN` from the global function environment and define it
only on `ApiFunction`, whose job-start, retry, and cancel routes use
`WorkflowStore`.

## Consequences

Worker Lambdas no longer depend on the state machine resource. The API retains
the ARN it needs, and SAM can construct an acyclic dependency graph.
