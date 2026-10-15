"""DynamoDB single-table adapter with revision-safe job updates."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from time import time
from typing import Any

from boto3.dynamodb.conditions import Attr, Key

from app.settings import settings
from app.storage.aws_session import get_dynamodb_resource


class JobAlreadyExistsError(RuntimeError):
    """Raised when a job ID is submitted more than once."""


class RevisionConflictError(RuntimeError):
    """Raised when a stale client attempts to update a job."""


class DynamoStore:
    """Persist jobs in PK=JOB#<id>, SK=META single-table records."""

    def __init__(self, table_name: str | None = None, table: Any | None = None) -> None:
        name = table_name or settings.dynamo_table
        self.table = table or get_dynamodb_resource().Table(name)

    @staticmethod
    def job_key(job_id: str) -> dict[str, str]:
        if not job_id or "/" in job_id or "\\" in job_id:
            raise ValueError("job_id must be a non-empty single identifier")
        return {"PK": f"JOB#{job_id}", "SK": "META"}

    def create_job(
        self,
        job_id: str,
        owner_id: str,
        config: Mapping[str, Any],
        input_hash: str | None = None,
        main_hash: str | None = None,
        files: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create an idempotent job metadata record."""

        timestamp = utc_now()
        item: dict[str, Any] = {
            **self.job_key(job_id),
            "entity_type": "job",
            "job_id": job_id,
            "owner_id": owner_id,
            "status": "DRAFT",
            "revision": 0,
            "config": dict(config),
            "created_at": timestamp,
            "updated_at": timestamp,
            "expires_at": int(time()) + settings.job_ttl_days * 86400,
            "GSI1PK": f"OWNER#{owner_id}",
            "GSI1SK": f"{timestamp}#{job_id}",
            "GSI2PK": "STATUS#DRAFT",
            "GSI2SK": f"{timestamp}#{job_id}",
        }
        if input_hash:
            item["input_hash"] = input_hash
        if main_hash:
            item["main_hash"] = main_hash
        if files:
            item["files"] = dict(files)

        try:
            self.table.put_item(
                Item=item,
                ConditionExpression=Attr("PK").not_exists(),
            )
        except self.table.meta.client.exceptions.ConditionalCheckFailedException as error:
            raise JobAlreadyExistsError(f"job already exists: {job_id}") from error
        return item

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        response = self.table.get_item(
            Key=self.job_key(job_id),
            ConsistentRead=True,
        )
        return response.get("Item")

    def update_job(
        self,
        job_id: str,
        expected_revision: int,
        updates: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Update a job and increment revision atomically."""

        if not updates:
            raise ValueError("updates must contain at least one field")
        names = {"#revision": "revision", "#updated_at": "updated_at"}
        values: dict[str, Any] = {
            ":one": 1,
            ":updated": utc_now(),
        }
        assignments = [
            "#revision = #revision + :one",
            "#updated_at = :updated",
        ]
        for index, (field, value) in enumerate(updates.items()):
            if field in {"PK", "SK", "revision", "updated_at"}:
                raise ValueError(f"field cannot be updated directly: {field}")
            name = f"#field_{index}"
            placeholder = f":value_{index}"
            names[name] = field
            values[placeholder] = value
            assignments.append(f"{name} = {placeholder}")

        if "status" in updates:
            status_value = getattr(updates["status"], "value", updates["status"])
            values[":gsi2pk"] = f"STATUS#{status_value}"
            values[":gsi2sk"] = f"{values[':updated']}#{job_id}"
            assignments.extend([
                "#gsi2pk = :gsi2pk",
                "#gsi2sk = :gsi2sk",
            ])
            names["#gsi2pk"] = "GSI2PK"
            names["#gsi2sk"] = "GSI2SK"

        try:
            response = self.table.update_item(
                Key=self.job_key(job_id),
                UpdateExpression="SET " + ", ".join(assignments),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ConditionExpression=Attr("revision").eq(expected_revision),
                ReturnValues="ALL_NEW",
            )
        except self.table.meta.client.exceptions.ConditionalCheckFailedException as error:
            raise RevisionConflictError(
                f"stale revision for job {job_id}; expected {expected_revision}"
            ) from error
        return response["Attributes"]

    def list_jobs_for_owner(self, owner_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """List jobs through the owner GSI, newest first."""

        response = self.table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("GSI1PK").eq(f"OWNER#{owner_id}"),
            Limit=max(1, min(limit, 100)),
            ScanIndexForward=False,
        )
        return response.get("Items", [])

    def put_child(self, job_id: str, sort_key: str, item: Mapping[str, Any]) -> dict[str, Any]:
        """Write an issue/proposal/review/event under a job partition."""

        if not sort_key or "/" in sort_key or "\\" in sort_key:
            raise ValueError("sort_key must be a non-empty single identifier")
        child = {
            "PK": f"JOB#{job_id}",
            "SK": sort_key,
            "expires_at": int(time()) + settings.job_ttl_days * 86400,
            **dict(item),
        }
        self.table.put_item(Item=child)
        return child


def utc_now() -> str:
    return datetime.now(UTC).isoformat()
