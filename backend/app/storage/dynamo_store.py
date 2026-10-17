"""DynamoDB single-table adapter with revision-safe job updates."""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from time import time
from typing import Any

from boto3.dynamodb.conditions import Attr, Key

from app.domain.enums import JobStatus
from app.domain.state_machine import validate_transition
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

    def get_child(self, job_id: str, sort_key: str) -> dict[str, Any] | None:
        """Read one issue/proposal/review/event by its exact sort key."""

        if not sort_key or "/" in sort_key or "\\" in sort_key:
            raise ValueError("sort_key must be a non-empty single identifier")
        response = self.table.get_item(
            Key={"PK": f"JOB#{job_id}", "SK": sort_key},
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
        if "status" in updates:
            current = self.get_job(job_id)
            if current and current.get("status"):
                from_status = JobStatus(current["status"])
                to_status = JobStatus(getattr(updates["status"], "value", updates["status"]))
                validate_transition(from_status, to_status)
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

    def list_children(self, job_id: str, prefix: str, limit: int = 100) -> list[dict[str, Any]]:
        items, _ = self.list_children_page(job_id, prefix, limit=limit)
        return items

    def list_children_page(
        self,
        job_id: str,
        prefix: str,
        *,
        limit: int = 100,
        cursor: str | None = None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        query: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(f"JOB#{job_id}") & Key("SK").begins_with(prefix),
            "Limit": max(1, min(limit, 100)),
            "ScanIndexForward": True,
        }
        if cursor:
            try:
                decoded = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
                query["ExclusiveStartKey"] = json.loads(decoded)
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error) as error:
                raise ValueError("invalid DynamoDB pagination cursor") from error
        response = self.table.query(**query)
        last_key = response.get("LastEvaluatedKey")
        next_cursor = None
        if last_key:
            encoded = json.dumps(last_key, separators=(",", ":")).encode("utf-8")
            next_cursor = base64.urlsafe_b64encode(encoded).decode("ascii")
        return response.get("Items", []), next_cursor


def utc_now() -> str:
    return datetime.now(UTC).isoformat()
