"""Authentication boundary for API routes.

Verify Cognito JWTs for direct FastAPI and API Gateway requests. Unconfigured
local development permits loopback access; deployed requests always need auth.
"""

from __future__ import annotations

import re
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException, Request, status

from app.settings import settings


@lru_cache(maxsize=4)
def _jwks_client(issuer: str):
    return jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", timeout=5)


def verify_token(token: str) -> str:
    """Verify Cognito RS256, issuer, expiry, subject, token use and app client.

    The issuer/key URL is constructed only from trusted server configuration.
    https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
    """
    pool, client = settings.cognito_user_pool_id, settings.cognito_app_client_id
    if not re.fullmatch(r"[a-z0-9-]+_\w+", pool) or not client:
        raise HTTPException(503, "Cognito pool and app client must be configured")
    region = pool.split("_", 1)[0]
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{pool}"
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise jwt.InvalidTokenError()
        key = _jwks_client(issuer).get_signing_key_from_jwt(token).key
        token_type = settings.cognito_api_token_type
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=issuer,
            audience=client if token_type == "id" else None,
            options={
                "require": ["exp", "iat", "sub", "iss", "token_use"],
                "verify_aud": token_type == "id",
            },
        )
        if claims.get("token_use") != token_type or not claims.get("sub"):
            raise jwt.InvalidTokenError()
        if token_type == "access" and claims.get("client_id") != client:
            raise jwt.InvalidTokenError()
        return str(claims["sub"])
    except jwt.PyJWKClientConnectionError as error:
        raise HTTPException(503, "Cognito signing keys are temporarily unavailable") from error
    except (jwt.PyJWTError, ValueError) as error:
        raise HTTPException(
            401, "Invalid or expired authentication token", headers={"WWW-Authenticate": "Bearer"}
        ) from error


def current_user_id(
    request: Request,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> str:
    """Return the authenticated subject or reject an unauthenticated request."""

    if isinstance(authorization, str):
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token or len(token) > 16384:
            raise HTTPException(401, "A Bearer token is required")
        return verify_token(token)

    if settings.cognito_user_pool_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authenticated Cognito subject is missing",
        )

    # Local-only fallback. It is unavailable once Cognito is configured.
    if request.scope.get("aws.event") or settings.environment not in {"demo", "local", "test"}:
        raise HTTPException(401, "Authentication is required")
    host = request.client.host if request.client else ""
    if host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        raise HTTPException(401, "Local authentication requires a loopback connection")
    return x_user_id or "local-user"
