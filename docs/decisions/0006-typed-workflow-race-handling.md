# ADR 0006: Handle the workflow-start race with a typed conflict

## Status

Accepted for the demo implementation.

## Context

After starting a Step Functions segment, the API persists the execution ARN
using the revision it just wrote. A fast Lambda can update the job first, so
that persistence write can legitimately lose its optimistic-concurrency race.

The previous fallback caught every `Exception`, which could hide AWS outages,
permission failures, serialization errors, and programming defects.

## Decision

Catch only `RevisionConflictError` around the execution-ARN persistence write.
For that expected race, read the latest job and return it. All other failures
continue to the existing workflow-failure handler.

## Consequences

The API remains tolerant of the expected Step Functions/Lambda timing race,
while unrelated DynamoDB and application failures are no longer silently
treated as a normal race.
