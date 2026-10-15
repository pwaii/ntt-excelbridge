"""Authentication boundary for API routes.

API Gateway/Cognito validates the JWT before the request reaches Lambda. This
module extracts the already-validated ``sub`` claim. Local demo mode uses a
deterministic user ID until Cognito is configured.
"""

from __future__ import annotations

from fastapi import Header, HTTPException, Request, status

from app.settings import settings


def _claims_from_event(request: Request) -> dict:
    event = request.scope.get("aws.event", {})
    request_context = event.get("requestContext", {})
    authorizer = request_context.get("authorizer", {}) or {}
    jwt_claims = authorizer.get("jwt", {}).get("claims", {})
    if jwt_claims:
        return jwt_claims
    return authorizer.get("claims", {}) or {}


def current_user_id(
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> str:
    """Return the authenticated subject or reject an unauthenticated request."""

    subject = _claims_from_event(request).get("sub")
    if subject:
        return str(subject)

    if settings.cognito_user_pool_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authenticated Cognito subject is missing",
        )

    # Local-only fallback. It is unavailable once Cognito is configured.
    return x_user_id or "local-user"
