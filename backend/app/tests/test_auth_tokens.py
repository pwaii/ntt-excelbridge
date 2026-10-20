"""Real RSA verification with synthetic claims and a stubbed JWKS transport."""

from time import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from starlette.requests import Request

from app import auth
from app.settings import settings


@pytest.fixture
def signed(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(settings, "cognito_user_pool_id", "us-east-1_synthetic")
    monkeypatch.setattr(settings, "cognito_app_client_id", "synthetic-client")
    monkeypatch.setattr(settings, "cognito_api_token_type", "access")
    monkeypatch.setattr(
        auth,
        "_jwks_client",
        lambda issuer: SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())
        ),
    )

    def token(**changes):
        claims = {
            "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_synthetic",
            "sub": "synthetic-user",
            "client_id": "synthetic-client",
            "token_use": "access",
            "exp": int(time()) + 300,
            "iat": int(time()) - 5,
        }
        claims.update(changes)
        return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "synthetic-key"})

    return token


def test_access_token_signature_and_identity(signed):
    assert auth.verify_token(signed()) == "synthetic-user"


@pytest.mark.parametrize(
    "change",
    [
        {"exp": 1},
        {"iss": "https://untrusted.invalid"},
        {"client_id": "another-client"},
        {"token_use": "id"},
        {"sub": ""},
        {"iat": 9999999999},
    ],
)
def test_invalid_claims_fail_closed(signed, change):
    with pytest.raises(HTTPException) as error:
        auth.verify_token(signed(**change))
    assert error.value.status_code == 401


def test_id_tokens_require_the_configured_audience(signed, monkeypatch):
    monkeypatch.setattr(settings, "cognito_api_token_type", "id")
    assert auth.verify_token(signed(token_use="id", aud="synthetic-client")) == "synthetic-user"
    with pytest.raises(HTTPException):
        auth.verify_token(signed(token_use="id", aud="other"))


def test_forged_signature_rejected(signed):
    raw = signed().split(".")
    token = ".".join(raw[:2]) + "." + "a" * len(raw[2])
    with pytest.raises(HTTPException):
        auth.verify_token(token)


def test_unsigned_and_wrong_algorithms_rejected(signed):
    with pytest.raises(HTTPException):
        auth.verify_token(jwt.encode({"sub": "forged"}, key="", algorithm="none"))


def test_gateway_claims_or_user_header_cannot_replace_a_bearer_token(signed):
    request = Request(
        {
            "type": "http",
            "headers": [],
            "aws.event": {"requestContext": {"authorizer": {"jwt": {"claims": {"sub": "forged"}}}}},
        }
    )
    with pytest.raises(HTTPException) as error:
        auth.current_user_id(request, "spoofed-user", None)
    assert error.value.status_code == 401


@pytest.mark.parametrize(
    "host,environment,allowed",
    [
        ("127.0.0.1", "local", True),
        ("testclient", "test", True),
        ("203.0.113.5", "demo", False),
        ("127.0.0.1", "production", False),
    ],
)
def test_local_fallback_is_scoped(monkeypatch, host, environment, allowed):
    monkeypatch.setattr(settings, "cognito_user_pool_id", "")
    monkeypatch.setattr(settings, "environment", environment)
    request = Request({"type": "http", "headers": [], "client": (host, 1234)})
    if allowed:
        assert auth.current_user_id(request, None, None) == "local-user"
    else:
        with pytest.raises(HTTPException):
            auth.current_user_id(request, None, None)
