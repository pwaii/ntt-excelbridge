"""Private S3 storage for workbook inputs and workflow artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any

from app.settings import settings
from app.storage.aws_session import get_s3_client


class S3Store:
    """S3 adapter using the project jobs/<job_id>/ object layout."""

    def __init__(self, bucket: str | None = None, client: Any | None = None) -> None:
        self.bucket = bucket or settings.app_data_bucket
        if not self.bucket:
            raise ValueError("APP_DATA_BUCKET must be configured before using S3Store")
        self.client = client or get_s3_client()

    def job_prefix(self, job_id: str) -> str:
        self._validate_component(job_id, "job_id")
        return f"{settings.s3_prefix}/{job_id}"

    def input_key(self, job_id: str, slot: str, filename: str) -> str:
        self._validate_component(slot, "slot")
        safe_filename = PurePosixPath(filename).name
        if not safe_filename or safe_filename in {".", ".."}:
            raise ValueError("filename must contain a file name")
        return f"{self.job_prefix(job_id)}/input/{slot}/{safe_filename}"

    def artifact_key(self, job_id: str, area: str, filename: str) -> str:
        self._validate_component(area, "artifact area")
        safe_filename = PurePosixPath(filename).name
        if not safe_filename or safe_filename in {".", ".."}:
            raise ValueError("filename must contain a file name")
        return f"{self.job_prefix(job_id)}/{area}/{safe_filename}"

    def create_upload_url(
        self,
        job_id: str,
        slot: str,
        filename: str,
        content_type: str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) -> dict[str, Any]:
        """Create a short-lived browser PUT URL for one workbook input."""

        key = self.input_key(job_id, slot, filename)
        expires_in = settings.presigned_url_ttl_seconds
        url = self.client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
            HttpMethod="PUT",
        )
        return {
            "bucket": self.bucket,
            "key": key,
            "url": url,
            "expires_in": expires_in,
        }

    def create_download_url(self, key: str) -> dict[str, Any]:
        """Create a short-lived browser GET URL for a private artifact."""

        expires_in = settings.presigned_url_ttl_seconds
        url = self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )
        return {"key": key, "url": url, "expires_in": expires_in}

    def head_object(self, key: str) -> dict[str, Any]:
        return self.client.head_object(Bucket=self.bucket, Key=key)

    def put_bytes(self, key: str, body: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )

    def get_bytes(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()

    @staticmethod
    def _validate_component(value: str, label: str) -> None:
        if not value or value in {".", ".."} or "/" in value or "\\" in value:
            raise ValueError(f"{label} must be a single path component")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
