from app.api.excel_explorer import _owned_sources
from app.domain.enums import JobStatus


class _FakeDynamo:
    def __init__(self, jobs):
        self._jobs = jobs

    def list_jobs_for_owner(self, owner_id, limit=100):
        return self._jobs


class _FakeS3:
    def input_key(self, job_id, slot, filename):
        return f"jobs/{job_id}/input/{slot}/{filename}"

    def artifact_key(self, job_id, area, filename):
        return f"jobs/{job_id}/{area}/{filename}"


def test_owned_sources_includes_input_and_output():
    job = {
        "owner_id": "owner-1",
        "status": JobStatus.COMPLETED.value,
        "job_id": "job-1",
        "created_at": "2026-01-01",
        "files": {
            "input": {"uploaded": True, "filename": "source.xlsx",
                      "key": "jobs/job-1/input/input/source.xlsx"},
            "main": {"uploaded": True, "filename": "master.xlsx",
                     "key": "jobs/job-1/input/main/master.xlsx"},
        },
        "artifacts": {"output": {"key": "jobs/job-1/output/result.xlsx"}},
    }

    sources = _owned_sources("owner-1", _FakeDynamo([job]), _FakeS3())

    assert sorted((s["slot"], s["workbook_name"]) for s in sources) == [
        ("input", "source.xlsx"),
        ("main", "master.xlsx (master)"),
        ("output", "result.xlsx (output)"),
    ]


def test_owned_sources_rejects_tampered_output_key():
    job = {
        "owner_id": "owner-1",
        "status": JobStatus.COMPLETED.value,
        "job_id": "job-1",
        "created_at": "2026-01-01",
        "files": {},
        "artifacts": {"output": {"key": "jobs/other-job/output/result.xlsx"}},
    }

    assert _owned_sources("owner-1", _FakeDynamo([job]), _FakeS3()) == []
