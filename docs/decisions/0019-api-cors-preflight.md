# Decision 0019: Keep browser CORS preflight public

## Context

The deployed HTTP API uses a Cognito JWT authorizer on its catch-all `ANY`
routes. Browser requests from the CloudFront frontend send an `OPTIONS`
preflight before authenticated `POST`, `PUT`, and other requests. The catch-all
route caused that preflight to receive `401 Unauthorized` before FastAPI or the
HTTP API CORS response could handle it.

## Decision

Add an explicit `OPTIONS /{proxy+}` route for `ApiFunction` and override its
authorizer with `NONE`. The route is only for browser preflight negotiation;
all application methods continue to use the catch-all routes with the Cognito
JWT authorizer. FastAPI's existing `CORSMiddleware` and API Gateway's CORS
configuration continue to provide the response headers. Set the Lambda
`CORS_ORIGINS` environment variable from the same `FrontendOrigin` parameter
so FastAPI accepts the browser origin after API Gateway forwards the preflight.

## Consequences

- Browser clients can complete CORS preflight without presenting a token.
- No application endpoint becomes anonymous: `POST /v1/jobs` and every other
  real API route remain protected by Cognito.
- The deployment smoke test must verify that an `OPTIONS` request returns a
  successful response with the CloudFront origin headers, and that an
  unauthenticated application request still returns `401`.
