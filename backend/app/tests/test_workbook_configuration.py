"""Real route/inspection integration with in-memory storage, not AWS certification."""

from hashlib import sha256
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.api.dependencies import get_dynamo_store, get_s3_store, get_workflow_store
from app.auth import current_user_id
from app.main import app
from app.storage.dynamo_store import RevisionConflictError
from app.storage.sfn_store import WorkflowStore
from app.tests.test_api import FakeDynamo, FakeS3


def workbook_bytes(label="Current"):
    book = Workbook()
    sheet = book.active
    sheet.title = "Data"
    sheet.append(["Report"])
    sheet.append([])
    sheet.append(["ID", "Amount", "Name"])
    sheet.append(["001", 25, label])
    out = BytesIO()
    book.save(out)
    book.close()
    return out.getvalue()


class WorkbookS3(FakeS3):
    def __init__(self):
        self.objects = {}

    def get_bytes(self, key):
        return self.objects[key]

    def put_bytes(self, key, body, content_type):
        self.objects[key] = body

    def artifact_key(self, job_id, area, filename):
        return f"jobs/{job_id}/{area}/{filename}"

    def head_object(self, key):
        value = self.objects[key]
        return {
            "ContentLength": len(value),
            "ETag": sha256(value).hexdigest(),
            "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }

    def object_exists(self, key):
        return key in self.objects


@pytest.fixture
def api(monkeypatch):
    from app import lambda_handlers as handlers

    store, storage = FakeDynamo(), WorkbookS3()
    app.dependency_overrides[get_dynamo_store] = lambda: store
    app.dependency_overrides[get_s3_store] = lambda: storage
    app.dependency_overrides[get_workflow_store] = lambda: WorkflowStore(state_machine_arn="")
    app.dependency_overrides[current_user_id] = lambda: "local-user"
    # The no-ARN orchestrator drives Lambda handlers, which self-provision stores.
    monkeypatch.setattr(handlers, "_stores", lambda: (store, storage))
    with TestClient(app) as client:
        yield client, store, storage
    app.dependency_overrides.clear()


def prepare(api, standardize=False, update=False):
    client, store, storage = api
    body = {
        "config": {
            "comment_name": "Profit",
            "output_header": "profit",
            "standardize": standardize,
            "update": update,
            "key_column": "ID" if update else None,
        },
        "input_filename": "current.xlsx",
    }
    if standardize or update:
        body["main_filename"] = "main.xlsx"
    response = client.post("/v1/jobs", json=body)
    assert response.status_code == 201
    id = response.json()["job"]["job_id"]
    for slot, file in store.item["files"].items():
        storage.objects[file["key"]] = workbook_bytes(slot)
        assert (
            client.post(f"/v1/jobs/{id}/uploads/complete", json={"slot": slot}).status_code == 200
        )
    return id


def selections(client, id, both=False, update=False):
    values = {}
    for slot in ["input", "main"] if both else ["input"]:
        response = client.get(f"/v1/jobs/{id}/workbooks/{slot}/metadata")
        assert response.status_code == 200
        data = response.json()
        assert data["sheets"][0]["detected_header_row"] == 3
        assert data["sheets"][0]["data_row_count"] == 1
        values[slot] = {
            "sheet_name": "Data",
            "header_row": 3,
            "header_confirmed": True,
            "key_column": "A" if update else None,
            "workbook_version": data["workbook_version"],
        }
    return values


def test_quality_segment_fans_out_over_every_input_slot(api):
    from app.workers.orchestrator import run_quality_segment

    client, store, storage = api
    response = client.post(
        "/v1/jobs",
        json={
            "config": {"comment_name": "Profit", "output_header": "profit"},
            "input_filenames": ["current.xlsx", "current-2.xlsx"],
        },
    )
    assert response.status_code == 201
    id = response.json()["job"]["job_id"]
    assert set(store.item["files"]) == {"input", "input_2"}
    for slot, file in store.item["files"].items():
        storage.objects[file["key"]] = workbook_bytes(slot)
        client.post(f"/v1/jobs/{id}/uploads/complete", json={"slot": slot})
    store.item["config"].update({"input_sheet": "Data", "input_header_row": 3})

    gated = run_quality_segment(id, store, storage)

    assert gated["status"] == "QUALITY_REVIEW_PENDING"
    # Both input slots were inspected and quality-checked into isolated artifacts.
    assert "inspection" in gated["artifacts"] and "inspection_input_2" in gated["artifacts"]
    assert "quality" in gated["artifacts"] and "quality_input_2" in gated["artifacts"]


@pytest.mark.parametrize(
    "standardize,update", [(False, False), (True, False), (False, True), (True, True)]
)
def test_real_route_flow_all_processing_configurations(api, standardize, update):
    client, store, storage = api
    id = prepare(api, standardize, update)
    chosen = selections(client, id, standardize or update, update)
    assert client.post(f"/v1/jobs/{id}/start").status_code == 422
    saved = client.put(
        f"/v1/jobs/{id}/configuration",
        json={"expected_revision": store.item["revision"], "selections": chosen},
    )
    assert saved.status_code == 200
    job = saved.json()["job"]
    assert job["configuration_confirmed"]
    assert (
        client.get(f"/v1/jobs/{id}").json()["job"]["workbook_selections"]
        == job["workbook_selections"]
    )
    assert job["config"]["input_header_row"] == 3
    before = dict(storage.objects)
    # No-ARN start now runs segment 1 (inspect + quality) and stops at the first gate.
    started = client.post(f"/v1/jobs/{id}/start", params={"expected_revision": job["revision"]})
    assert started.status_code == 200
    assert started.json()["job"]["status"] == "QUALITY_REVIEW_PENDING"
    # Source workbooks are never mutated by inspection/quality.
    assert all(storage.objects[key] == value for key, value in before.items())
    # A second start is rejected: the job is past UPLOADED, now awaiting review.
    assert client.post(f"/v1/jobs/{id}/start").status_code == 409
    assert client.post(f"/v1/jobs/{id}/uploads/complete", json={"slot": "input"}).status_code == 409


@pytest.mark.parametrize(
    "invalid", ["sheet", "header", "key", "confirmation", "version", "revision"]
)
def test_rejects_invalid_or_stale_configuration(api, invalid):
    client, store, _storage = api
    id = prepare(api, update=True)
    chosen = selections(client, id, both=True, update=True)
    if invalid == "sheet":
        chosen["input"]["sheet_name"] = "Missing"
    if invalid == "header":
        chosen["input"]["header_row"] = 21
    if invalid == "key":
        chosen["input"]["key_column"] = "ZZZ"
    if invalid == "confirmation":
        chosen["input"]["header_confirmed"] = False
    if invalid == "version":
        chosen["input"]["workbook_version"] = "stale"
    revision = store.item["revision"]
    response = client.put(
        f"/v1/jobs/{id}/configuration",
        json={
            "expected_revision": revision - 1 if invalid == "revision" else revision,
            "selections": chosen,
        },
    )
    assert response.status_code in {409, 422}
    assert store.item["revision"] == revision
    assert not store.item.get("configuration_confirmed")


def test_invalid_file_empty_header_and_version_change_block_start(api):
    client, store, storage = api
    id = prepare(api)
    path = f"/v1/jobs/{id}/workbooks/input/metadata"
    assert client.get(path, params={"sheet_name": "Data", "header_row": 2}).json()["sheets"][0][
        "errors"
    ]
    chosen = selections(client, id)
    assert (
        client.put(
            f"/v1/jobs/{id}/configuration",
            json={"expected_revision": store.item["revision"], "selections": chosen},
        ).status_code
        == 200
    )
    storage.objects[store.item["files"]["input"]["key"]] = workbook_bytes("Changed")
    assert client.post(f"/v1/jobs/{id}/start").status_code == 409
    storage.objects[store.item["files"]["input"]["key"]] = b"not-an-xlsx"
    assert client.get(path).status_code == 422


def test_start_revision_race_does_not_fail_the_winning_execution(api, monkeypatch):
    client, store, _storage = api
    id = prepare(api)
    chosen = selections(client, id)
    assert (
        client.put(
            f"/v1/jobs/{id}/configuration",
            json={"expected_revision": store.item["revision"], "selections": chosen},
        ).status_code
        == 200
    )
    original = store.update_job

    def race(job_id, expected_revision, updates):
        original(job_id, expected_revision, updates)
        raise RevisionConflictError("A concurrent request already started the job")

    monkeypatch.setattr(store, "update_job", race)
    assert client.post(f"/v1/jobs/{id}/start").status_code == 409
    assert store.item["status"] == "INSPECTING"


def test_metadata_ownership_and_empty_workbook(api):
    client, store, storage = api
    id = prepare(api)
    app.dependency_overrides[current_user_id] = lambda: "someone-else"
    assert client.get(f"/v1/jobs/{id}/workbooks/input/metadata").status_code == 404
    app.dependency_overrides[current_user_id] = lambda: "local-user"
    book = Workbook()
    out = BytesIO()
    book.save(out)
    book.close()
    storage.objects[store.item["files"]["input"]["key"]] = out.getvalue()
    metadata = client.get(f"/v1/jobs/{id}/workbooks/input/metadata").json()
    assert metadata["sheets"][0]["columns"] == []
    assert metadata["sheets"][0]["detected_header_row"] is None
    assert metadata["sheets"][0]["errors"]


def test_missing_aws_profile_has_safe_actionable_diagnostics(api):
    from botocore.exceptions import ProfileNotFound

    client, _store, _storage = api

    def missing():
        raise ProfileNotFound(profile="private-profile-description")

    app.dependency_overrides[get_dynamo_store] = missing
    response = client.get("/v1/jobs/example")
    assert response.status_code == 503
    assert response.json()["error_code"] == "AWS_PROFILE_NOT_FOUND"
    assert response.json()["request_id"]
    assert "private-profile-description" not in response.text


def test_expired_aws_login_returns_diagnostics_with_cors(api):
    from botocore import exceptions

    login_refresh_error = getattr(exceptions, "LoginRefreshRequired", None)
    if login_refresh_error is None:
        pytest.skip("This botocore version does not support AWS CLI login profiles")
    client, _store, _storage = api

    def expired():
        raise login_refresh_error()

    app.dependency_overrides[get_dynamo_store] = expired
    response = client.get(
        "/v1/jobs", headers={"Origin": "http://127.0.0.1:5173", "X-Request-Id": "expired-login"}
    )
    assert response.status_code == 503
    assert response.json()["error_code"] == "AWS_CREDENTIALS_EXPIRED"
    assert response.json()["request_id"] == "expired-login"
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
