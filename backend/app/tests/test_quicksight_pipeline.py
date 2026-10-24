import io

from openpyxl import Workbook

from app.services.quicksight_pipeline import (
    INSPECTION_FIELDS,
    QUALITY_FIELDS,
    encode_csv,
    flatten_inspection_manifests,
    flatten_quality_reports,
    flatten_workbook_rows,
    inspection_artifact_key,
    quality_artifact_key,
)


def test_quality_flatten_includes_each_current_workbook_slot():
    reports = [
        (
            "jobs/job-1/quality/quality-report.json",
            {"issues": [{"issue_id": "a", "kind": "blank_row", "row_numbers": [2]}]},
        ),
        (
            "jobs/job-1/quality/input_2-quality-report.json",
            {"issues": [{"issue_id": "b", "kind": "type_mismatch", "row_numbers": [4, 5]}]},
        ),
        (
            "jobs/job-1/quality/input_8-quality-report.json",
            {"issues": [{"issue_id": "c", "kind": "duplicate_rows", "row_numbers": [9]}]},
        ),
        ("jobs/job-1/quality/not-a-report.json", {"issues": [{"issue_id": "ignored"}]}),
    ]

    rows = flatten_quality_reports(reports)

    assert [(row["input_slot"], row["issue_id"], row["row_count"]) for row in rows] == [
        ("input", "a", 1),
        ("input_2", "b", 2),
        ("input_8", "c", 1),
    ]
    assert quality_artifact_key("jobs/job-1/quality/input_2-quality-report.json")
    assert not quality_artifact_key("jobs/job-1/quality/input_9-quality-report.json")


def test_inspection_flatten_includes_each_current_workbook_slot():
    manifests = [
        (
            "jobs/job-2/inspection/manifest.json",
            {
                "total_rows": 10,
                "sheets": [{"name": "Current", "columns": [{"name": "ID", "index": 0,
                    "type_distribution": {"integer": 4, "string": 1}, "blank_count": 2}]}],
            },
        ),
        (
            "jobs/job-2/inspection/input_2-manifest.json",
            {
                "total_rows": 4,
                "sheets": [{"name": "Current", "columns": [{"name": "Region", "index": 0,
                    "type_distribution": {"string": 4}, "blank_count": 0}]}],
            },
        ),
    ]

    rows = flatten_inspection_manifests(manifests)

    assert [(row["input_slot"], row["column_name"], row["blank_rate"]) for row in rows] == [
        ("input", "ID", 0.2),
        ("input_2", "Region", 0.0),
    ]
    assert inspection_artifact_key("jobs/job-2/inspection/input_2-manifest.json")


def test_workbook_flatten_tags_input_and_output_sources():
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(["Product", "Price"])
    ws.append(["Widget", 9.5])
    buffer = io.BytesIO()
    wb.save(buffer)
    data = buffer.getvalue()

    rows = flatten_workbook_rows([
        ("jobs/job-1/input/input/source.xlsx", "owner-1", data),
        ("jobs/job-1/output/result.xlsx", "owner-1", data),
    ])

    assert [(row["source_kind"], row["input_slot"]) for row in rows] == [
        ("input", "input"),
        ("output", "output"),
    ]


def test_csv_is_valid_with_zero_rows():
    assert encode_csv([], QUALITY_FIELDS).decode().splitlines() == [",".join(QUALITY_FIELDS)]
    assert encode_csv([], INSPECTION_FIELDS).decode().splitlines() == [",".join(INSPECTION_FIELDS)]
