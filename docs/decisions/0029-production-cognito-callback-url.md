# Decision 0029: Register the production CloudFront Cognito URLs

## Context

The deployed frontend is served from `https://d35kjusenp6a9t.cloudfront.net`, but
the Cognito app client had been deployed with only the local development callback
and logout URLs:

- `http://localhost:5173/auth/callback`
- `http://localhost:5173/login`

As a result, Cognito rejected sign-in redirects from the production frontend.

## Decision

Deploy the backend stack with `FrontendOrigin` set to the production CloudFront
origin. CloudFormation then owns these Cognito app-client values:

- `https://d35kjusenp6a9t.cloudfront.net/auth/callback`
- `https://d35kjusenp6a9t.cloudfront.net/login`

The frontend deployment script already derives the same URLs from the frontend
stack output, so no hard-coded production URL is added to the application source.

## Verification

The Cognito app client was queried after deployment and returned the CloudFront
callback and logout URLs. The backend stack completed successfully in
`us-east-1`.

## Consequence

Production sign-in works against the deployed CloudFront site. Local development
requires a separate deployment/configuration using the localhost origin, or a
separate Cognito app client if both environments must be used simultaneously.
