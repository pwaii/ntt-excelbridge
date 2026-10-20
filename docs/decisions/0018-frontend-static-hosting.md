# Decision 0018: Host the frontend privately behind CloudFront

## Context

The backend API is available through API Gateway, but the React/Vite frontend
was only available from the local Vite development server. The frontend needs a
public HTTPS origin for Cognito callbacks, browser access, and API CORS.

## Decision

Deploy the frontend as static assets in a separate private S3 bucket and serve
them through a CloudFront distribution using Origin Access Control. Configure
SPA fallback responses to `index.html`, publish the CloudFront origin to the
backend's Cognito callback, logout, and CORS settings, then build and sync the
Vite assets.

## Consequences

- The existing private job-data bucket remains separate from frontend assets.
- The frontend receives a stable HTTPS CloudFront URL without requiring a custom
  domain or public S3 access.
- CloudFront distribution creation and updates take longer than a local Vite
  startup; invalidation is run after each publish.
- A custom domain can be added later without changing the frontend architecture.
