"""Stable QuickSight identities and RLS principals for website customers."""

from __future__ import annotations

from hashlib import sha256
import re


def _role_parts(role_arn: str) -> tuple[str, str, str]:
    match = re.fullmatch(r"arn:(aws|aws-us-gov|aws-cn):iam::(\d{12}):role/(.+)", role_arn)
    if not match:
        raise ValueError("QUICKSIGHT_EMBEDDING_ROLE_ARN must be a valid IAM role ARN")
    partition, account_id, role_path = match.groups()
    return f"arn:{partition}:quicksight", account_id, role_path.rsplit("/", 1)[-1]


def reader_username(owner_id: str) -> str:
    """Map one verified app subject to one stable, non-PII Quick username."""
    if not owner_id:
        raise ValueError("A non-empty authenticated app subject is required")
    return "web-" + sha256(owner_id.encode("utf-8")).hexdigest()[:48]


def reader_quicksight_username(role_arn: str, owner_id: str) -> str:
    """QuickSight addresses IAM role sessions by ``role-name/session-name``."""
    _, _, role_name = _role_parts(role_arn)
    return f"{role_name}/{reader_username(owner_id)}"


def reader_user_arn(role_arn: str, region: str, owner_id: str) -> str:
    """Return the deterministic ARN for a user federated through the embedding role."""
    partition, account_id, role_name = _role_parts(role_arn)
    session_name = reader_username(owner_id)
    return f"arn:{partition}:quicksight:{region}:{account_id}:user/default/{role_name}/{session_name}"


def reader_email(owner_id: str) -> str:
    """Return a unique non-deliverable address; QuickSight IAM users do not sign in by email."""
    return f"{reader_username(owner_id)}@example.invalid"
