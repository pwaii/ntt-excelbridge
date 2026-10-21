"""API tests for the first backend milestone."""

from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.jobs import create_job
from app.api.uploads import complete_upload
from app.domain.schemas import CreateJobRequest, JobConfig, UploadCompleteRequest
from app.storage.dynamo_store import RevisionConflictError


def _request() -> Request:
    request = Request({"type": "http", "headers": []})
    request.state.request_id = "test-request"
    return request


def _job_item() -> dict:
    return {
        "PK": "JOB#job-1",
        "SK": "META",
        "entity_type": "job",
        "job_id": "job-1",
        "owner_id": "local-user",
        "status": "UPLOADING",
        "revision": 1,
        "config": {"comment_name": "Status"},
        "files": {
            "input": {
                "filename": "input.xlsx",
                "key": "jobs/job-1/input/input/input.xlsx",
                "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "uploaded": False,
            }
        },
        "created_at": "2026-10-15T00:00:00+00:00",
        "updated_at": "2026-10-15T00:00:00+00:00",
        "expires_at": 1_800_000_000,
    }


class FakeDynamo:
    def __init__(self) -> None:
        self.item = _job_item()
        self.updates = []

    def create_job(self, job_id, owner_id, config, files, **kwargs):
        self.item = _job_item()
        self.item.update(
            job_id=job_id,
            owner_id=owner_id,
            config=config,
            files=files,
            revision=0,
            status="DRAFT",
        )
        return deepcopy(self.item)

    def update_job(self, job_id, expected_revision, updates):
        if expected_revision != self.item["revision"]:
            raise RevisionConflictError("stale")
        self.updates.append(deepcopy(updates))
        self.item.update(deepcopy(updates))
        self.item["revision"] += 1
        return deepcopy(self.item)

    def set_execution_metadata(self, job_id, updates):
        self.item.update(deepcopy(updates))
        return deepcopy(self.item)

    def get_job(self, job_id):
        return deepcopy(self.item) if job_id == self.item["job_id"] else None

    def put_child(self, job_id, sort_key, item):
        return {"PK": f"JOB#{job_id}", "SK": sort_key, **item}


class FakeS3:
    def input_key(self, job_id, slot, filename):
        return f"jobs/{job_id}/input/{slot}/{filename}"

    def create_upload_url(self, job_id, slot, filename, content_type):
        return {
            "key": self.input_key(job_id, slot, filename),
            "url": f"https://example.test/{job_id}/{slot}",
            "expires_in": 300,
        }

    def head_object(self, key):
        return {
            "ContentLength": 123,
            "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "ETag": '"etag-1"',
        }

    def put_bytes(self, key, body, content_type):
        assert key.endswith("input.xlsx")
        assert body == b"xlsx-bytes"
        assert content_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def create_download_url(self, key):
        return {"key": key, "url": "https://example.test/download", "expires_in": 300}

    def job_prefix(self, job_id):
        return f"jobs/{job_id}"


def test_create_job_returns_upload_url():
    dynamo = FakeDynamo()
    s3 = FakeS3()
    response = create_job(
        CreateJobRequest(config=JobConfig(comment_name="Status"), input_filename="input.xlsx"),
        _request(),
        "local-user",
        dynamo,
        s3,
    )
    assert response.job.status.value == "UPLOADING"
    assert response.uploads[0].key.endswith("/input/input.xlsx")


def test_create_job_returns_multiple_supporting_workbook_uploads():
    response = create_job(
        CreateJobRequest(
            config=JobConfig(comment_name="Status"),
            input_filename="input.xlsx",
            additional_filenames=["history.xlsx", "reference.xlsx"],
        ),
        _request(),
        "local-user",
        FakeDynamo(),
        FakeS3(),
    )

    assert [upload.slot for upload in response.uploads] == ["input", "attachment_1", "attachment_2"]
    assert response.job.files["attachment_1"].filename == "history.xlsx"
    assert response.job.files["attachment_2"].filename == "reference.xlsx"


def test_main_file_is_required_for_update():
    with pytest.raises(HTTPException) as raised:
        create_job(
            CreateJobRequest(
                config=JobConfig(comment_name="Status", update=True, key_column="CustomerID"),
                input_filename="input.xlsx",
            ),
            _request(),
            "local-user",
            FakeDynamo(),
            FakeS3(),
        )
    assert raised.value.status_code == 422
    assert "main_filename" in str(raised.value.detail)


def test_upload_completion_moves_job_to_uploaded():
    dynamo = FakeDynamo()
    s3 = FakeS3()
    response = complete_upload(
        "job-1",
        UploadCompleteRequest(slot="input"),
        _request(),
        "local-user",
        dynamo,
        s3,
    )
    assert response.job.status.value == "UPLOADED"
    assert response.job.files["input"].uploaded is True


def test_first_of_two_uploads_can_remain_uploading():
    dynamo = FakeDynamo()
    dynamo.item["files"]["main"] = {
        "filename": "main.xlsx",
        "key": "jobs/job-1/input/main/main.xlsx",
        "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "uploaded": False,
    }
    s3 = FakeS3()

    response = complete_upload(
        "job-1",
        UploadCompleteRequest(slot="input"),
        _request(),
        "local-user",
        dynamo,
        s3,
    )

    assert response.job.status.value == "UPLOADING"
    assert "status" not in dynamo.updates[-1]
