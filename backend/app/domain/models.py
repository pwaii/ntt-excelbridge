"""Domain models for job metadata and API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import JobStatus
from app.domain.schemas import JobConfig
from app.domain.workbooks import WorkbookSelection


class StoredFile(BaseModel):
    """The safe subset of an uploaded S3 object kept in the job record."""

    filename: str
    key: str
    content_type: str | None = None
    size_bytes: int | None = Field(default=None, ge=0)
    etag: str | None = None
    sha256: str | None = None
    version_id: str | None = None
    uploaded: bool = False


class JobRecord(BaseModel):
    """Typed view of the DynamoDB META item."""

    model_config = ConfigDict(extra="ignore")

    job_id: str
    owner_id: str
    status: JobStatus
    revision: int = Field(ge=0)
    config: JobConfig
    configuration_confirmed: bool = False
    workbook_selections: dict[str, WorkbookSelection] = Field(default_factory=dict)
    files: dict[str, StoredFile] = Field(default_factory=dict)
    artifacts: dict[str, dict[str, Any]] = Field(default_factory=dict)
    input_hash: str | None = None
    main_hash: str | None = None
    output_hash: str | None = None
    execution_arn: str | None = None
    workflow_segment: int | None = None
    error_code: str | None = None
    error_detail: str | None = None
    created_at: datetime
    updated_at: datetime
    expires_at: int | None = None

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> JobRecord:
        """Convert a DynamoDB native-type item into the API model."""

        return cls.model_validate(item)


class JobResponse(BaseModel):
    job: JobRecord
    request_id: str


class JobListResponse(BaseModel):
    jobs: list[JobRecord]
    request_id: str


class PresignedUpload(BaseModel):
    slot: str
    filename: str
    key: str
    url: str
    expires_in: int


class CreateJobResponse(JobResponse):
    uploads: list[PresignedUpload]


class UploadCompleteResponse(JobResponse):
    uploaded_slot: str


class ReviewResponse(JobResponse):
    review_id: str
    execution_arn: str | None = None


class PresignedDownload(BaseModel):
    artifact_type: str
    key: str
    url: str
    expires_in: int
    request_id: str
