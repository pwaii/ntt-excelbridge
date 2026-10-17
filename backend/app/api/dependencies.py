"""FastAPI dependencies for shared AWS adapters."""

from functools import lru_cache

from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store
from app.storage.sfn_store import WorkflowStore


@lru_cache(maxsize=1)
def get_dynamo_store() -> DynamoStore:
    return DynamoStore()


@lru_cache(maxsize=1)
def get_s3_store() -> S3Store:
    return S3Store()


@lru_cache(maxsize=1)
def get_workflow_store() -> WorkflowStore:
    return WorkflowStore()
