# ADR 0007: Configure the HTTP API JWT identity source

## Status

Accepted for the demo implementation.

## Context

SAM validation rejected the HTTP API's Cognito JWT authorizer because it had
issuer and audience settings but no identity source. API Gateway must know
where to read the bearer token from each request.

## Decision

Configure `IdentitySource` as `$request.header.Authorization`. This matches the
frontend/API contract and the standard HTTP bearer-token header.

## Consequences

SAM can transform the HTTP API authorizer definition, and API Gateway will
validate the Cognito JWT supplied in the `Authorization` header. Requests
without that header will not satisfy the default authorizer.
