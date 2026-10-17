"""Export synthetic HTTP fixtures through real FastAPI routes, with fake storage.

Run with the backend development Python environment. No AWS calls or credentials
are used. These fixtures are contract evidence, never real integration evidence.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.api.dependencies import get_dynamo_store, get_s3_store  # noqa: E402
from app.auth import current_user_id  # noqa: E402
from app.tests.test_api import FakeDynamo, FakeS3  # noqa: E402
from app.tests.test_workbook_configuration import WorkbookS3, workbook_bytes  # noqa: E402


class FixtureS3(WorkbookS3):
    def create_upload_url(self, job_id, slot, filename, content_type):
        self.objects[self.input_key(job_id, slot, filename)] = workbook_bytes(slot)
        return {
            "key": self.input_key(job_id, slot, filename),
            "url": f"https://contract-fixture.s3.us-east-1.amazonaws.com/{job_id}/{slot}?signature=fixture-not-valid",
            "expires_in": 300,
        }


destination = ROOT / "frontend/src/tests/fixtures/backend"
destination.mkdir(parents=True, exist_ok=True)
for mode in ["current", "both"]:
    store = FakeDynamo()
    app.dependency_overrides[get_dynamo_store] = lambda: store
    storage = FixtureS3()
    app.dependency_overrides[get_s3_store] = lambda: storage
    app.dependency_overrides[current_user_id] = lambda: "contract-fixture-user"
    body = {
        "config": {"comment_name": "Profit", "output_header": "profit", "standardize": mode == "both", "update": mode == "both"},
        "input_filename": "current.xlsx",
        **({"main_filename": "main.xlsx"} if mode == "both" else {}),
    }
    with TestClient(app) as client, patch("app.api.jobs.uuid4", return_value=UUID("11111111-1111-4111-8111-111111111111")):
        def save(name, response, expected_status=200):
            assert response.status_code == expected_status
            (destination / f"{mode}-{name}.json").write_text(json.dumps(response.json(), indent=2) + "\n", encoding="utf8")
        response = client.post("/v1/jobs", json=body, headers={"x-request-id": "contract-fixture-create"})
        save("create", response, 201)
        job_id = response.json()["job"]["job_id"]
        for slot in (["input", "main"] if mode == "both" else ["input"]):
            save(f"confirm-{slot}", client.post(f"/v1/jobs/{job_id}/uploads/complete", json={"slot": slot}, headers={"x-request-id": f"contract-fixture-confirm-{slot}"}))
        save("get", client.get(f"/v1/jobs/{job_id}", headers={"x-request-id": "contract-fixture-get"}))
        selections = {}
        for slot in (["input", "main"] if mode == "both" else ["input"]):
            meta = client.get(f"/v1/jobs/{job_id}/workbooks/{slot}/metadata")
            save(f"metadata-{slot}", meta)
            selections[slot] = {"sheet_name": "Data", "header_row": 3, "header_confirmed": True, "key_column": "A" if mode == "both" else None, "workbook_version": meta.json()["workbook_version"]}
        configured = client.put(f"/v1/jobs/{job_id}/configuration", json={"expected_revision": store.item["revision"], "selections": selections})
        save("configured", configured)
        save("started", client.post(f"/v1/jobs/{job_id}/start", params={"expected_revision": configured.json()["job"]["revision"]}))
app.dependency_overrides.clear()
print("Exported contract fixtures through FastAPI with fake storage; no real AWS integration.")
