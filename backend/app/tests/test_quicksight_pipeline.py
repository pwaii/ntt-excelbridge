from io import BytesIO
from decimal import Decimal

from openpyxl import Workbook

from app.services.quicksight_pipeline import (
    INSPECTION_FIELDS,
    QUALITY_FIELDS,
    WORKBOOK_FIELD_PAIR_FIELDS,
    encode_csv,
    flatten_workbook_field_pairs,
    flatten_inspection_manifests,
    flatten_quality_reports,
    inspection_artifact_key,
    quality_artifact_key,
    workbook_source_id,
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


def test_csv_is_valid_with_zero_rows():
    assert encode_csv([], QUALITY_FIELDS).decode().splitlines() == [",".join(QUALITY_FIELDS)]
    assert encode_csv([], INSPECTION_FIELDS).decode().splitlines() == [",".join(INSPECTION_FIELDS)]
    assert encode_csv([], WORKBOOK_FIELD_PAIR_FIELDS).decode().splitlines() == [",".join(WORKBOOK_FIELD_PAIR_FIELDS)]


def _workbook_bytes(headers, rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Catalog"
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_workbook_field_pairs_support_arbitrary_headers_and_keep_row_association():
    price_quantity = _workbook_bytes(
        ["Unit Price", "Quantity", "Region"],
        [[12.99, 3, "West"], [5.50, 7, "East"]],
    )
    account_data = _workbook_bytes(
        ["Account", "Balance", "Risk Band"],
        [["A-10", 25.25, "Low"]],
    )
    pairs = flatten_workbook_field_pairs(
        [
            ("jobs/job-1/input/input/items.xlsx", "owner-1", price_quantity),
            ("jobs/job-2/input/input/accounts.xlsx", "owner-1", account_data),
        ],
        {
            ("job-1", "input"): {"sheets": [{"name": "Catalog", "header_row": 1, "headers": ["Unit Price", "Quantity", "Region"]}]},
            ("job-2", "input"): {"sheets": [{"name": "Catalog", "header_row": 1, "headers": ["Account", "Balance", "Risk Band"]}]},
        },
    )

    assert pairs
    assert {row["x_field"] for row in pairs} == {"Unit Price", "Quantity", "Region", "Account", "Balance", "Risk Band"}
    assert all(row["owner_id"] == "owner-1" for row in pairs)
    assert all(row["source_id"] == workbook_source_id("owner-1", row["job_id"], row["input_slot"]) for row in pairs)
    assert any(
        row["row_mode"] == "pair"
        and row["x_field"] == "Unit Price"
        and row["y_field"] == "Quantity"
        and row["x_number"] == Decimal("12.99")
        and row["y_number"] == Decimal("3")
        and row["row_number"] == 2
        for row in pairs
    )
    assert any(
        row["row_mode"] == "pair"
        and row["x_field"] == "Region"
        and row["x_category"] == "West"
        and row["x_number"] is None
        and row["y_field"] == "Unit Price"
        for row in pairs
    )
    assert any(
        row["row_mode"] == "pair"
        and row["x_field"] == "Risk Band"
        and row["x_category"] == "Low"
        and row["x_number"] is None
        and row["y_field"] == "Balance"
        and row["y_number"] == Decimal("25.25")
        for row in pairs
    )
    assert any(
        row["row_mode"] == "single"
        and row["x_field"] == "Balance"
        and row["x_number"] == Decimal("25.25")
        and row["y_field"] == "__none__"
        and row["y_number"] == Decimal("2")
        for row in pairs
    )
    assert not any(row["x_field"] == "Unit Price" and row["y_field"] == "Balance" for row in pairs)


def test_workbook_field_pairs_enforce_expansion_limit():
    data = _workbook_bytes(["A", "B", "C"], [[1, 2, 3]])
    try:
        flatten_workbook_field_pairs(
            [("jobs/job-1/input/input/items.xlsx", "owner-1", data)],
            {("job-1", "input"): {"sheets": [{"name": "Catalog", "header_row": 1, "headers": ["A", "B", "C"]}]}},
            max_rows=8,
        )
    except ValueError as error:
        assert "safety limit" in str(error)
    else:
        raise AssertionError("expected pair expansion limit to be enforced")
