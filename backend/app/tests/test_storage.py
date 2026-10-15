from __future__ import annotations

from io import BytesIO

from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store


class FakeS3Client:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def generate_presigned_url(self, operation, Params, ExpiresIn, HttpMethod=None):
        self.calls.append(
            (
                operation,
                {
                    "Params": Params,
                    "ExpiresIn": ExpiresIn,
                    "HttpMethod": HttpMethod,
                },
            )
        )
        return "https://example.invalid/signed"

    def get_object(self, **kwargs):
        return {"Body": BytesIO(b"payload")}


class FakeDynamoClientExceptions:
    class ConditionalCheckFailedException(Exception):
        pass


class FakeDynamoMeta:
    client = type("Client", (), {"exceptions": FakeDynamoClientExceptions})()


class FakeTable:
    meta = FakeDynamoMeta()

    def __init__(self) -> None:
        self.item = None

    def put_item(self, **kwargs):
        self.item = kwargs["Item"]

    def get_item(self, **kwargs):
        return {"Item": self.item} if self.item else {}

    def update_item(self, **kwargs):
        self.item = {
            **self.item,
            "status": kwargs["ExpressionAttributeValues"].get(
                ":value_0", self.item["status"]
            ),
            "revision": self.item["revision"] + 1,
        }
        return {"Attributes": self.item}


def test_s3_store_uses_jobs_prefix_and_signed_urls():
    store = S3Store(bucket="demo-bucket", client=FakeS3Client())

    upload = store.create_upload_url("job-1", "current", "source.xlsx")
    download = store.create_download_url("jobs/job-1/output/final.xlsx")

    assert upload["key"] == "jobs/job-1/input/current/source.xlsx"
    assert download["url"].startswith("https://")
    assert store.get_bytes("jobs/job-1/input/current/source.xlsx") == b"payload"


def test_dynamo_store_creates_and_revision_updates_job():
    store = DynamoStore(table=FakeTable())

    created = store.create_job("job-1", "user-1", {"comment_name": "segment"})
    assert created["PK"] == "JOB#job-1"
    assert created["SK"] == "META"
    assert created["revision"] == 0
    assert store.get_job("job-1")["status"] == "DRAFT"

    updated = store.update_job("job-1", 0, {"status": "UPLOADING"})
    assert updated["status"] == "UPLOADING"
    assert updated["revision"] == 1
