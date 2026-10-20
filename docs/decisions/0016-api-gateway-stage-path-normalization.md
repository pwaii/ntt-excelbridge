# Decision 0016: Normalize named API Gateway stage paths before FastAPI dispatch

## Context

The deployed HTTP API uses the named `demo` stage. The live API Gateway request
was reaching the API Lambda with `rawPath` set to `/demo/health`, while the
FastAPI application exposes `/health`. Mangum therefore dispatched the full
stage-prefixed path and returned FastAPI's `404 {"detail":"Not Found"}`.

## Decision

Detect the API Gateway stage from `requestContext.stage` and configure Mangum to
strip that prefix only when it is present in `rawPath`. Keep the base path `/`
for local ASGI requests, `$default` stages, and events whose raw path is already
stage-free.

## Consequences

- Deployed requests such as `/demo/health` reach FastAPI as `/health`.
- Local development continues to use `/health` without a deployment-specific
  hard-coded stage.
- The behavior is covered by focused unit tests.
