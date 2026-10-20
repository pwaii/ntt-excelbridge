"""Shared boto3 session and client configuration for local and Lambda runs."""

from functools import lru_cache

import boto3
from botocore.config import Config

from app.settings import settings


def _session_kwargs() -> dict[str, str]:
    kwargs = {"region_name": settings.aws_region}
    if settings.aws_profile:
        kwargs["profile_name"] = settings.aws_profile
    return kwargs


@lru_cache(maxsize=1)
def get_session() -> boto3.Session:
    """Create one explicit session and reuse it for the process lifetime."""

    return boto3.Session(**_session_kwargs())


def get_client_config() -> Config:
    """Return bounded retry and timeout settings for AWS API clients."""

    return Config(
        retries={"mode": "adaptive", "total_max_attempts": 3},
        connect_timeout=5,
        read_timeout=30,
        max_pool_connections=20,
    )


@lru_cache(maxsize=1)
def get_s3_client():
    return get_session().client("s3", config=get_client_config())


@lru_cache(maxsize=1)
def get_dynamodb_resource():
    return get_session().resource("dynamodb", config=get_client_config())


@lru_cache(maxsize=1)
def get_stepfunctions_client():
    return get_session().client("stepfunctions", config=get_client_config())
