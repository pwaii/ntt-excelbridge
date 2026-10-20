"""Deterministic quality-rule tests."""

from io import BytesIO

from openpyxl import Workbook
import pytest

from app.workers.quality_rules import run_quality_rules


def _workbook_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Customers"
    sheet.append(["CustomerID", "Amount", "Unused"])
    sheet.append(["A-1", 10, None])
    sheet.append(["A-1", "not-a-number", None])
    sheet.append([None, None, None])
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def test_quality_rules_are_stable_and_include_recommended_actions():
    first = run_quality_rules(_workbook_bytes())
    second = run_quality_rules(_workbook_bytes())
    assert first == second
    assert first["issue_count"] >= 3
    assert all(issue["recommended_action"] for issue in first["issues"])


@pytest.mark.parametrize("value,expected", [(10, "integer"), (True, "boolean"), ("A123", "string")])
def test_mixed_types_use_canonical_target_names(value, expected):
    workbook = Workbook()
    workbook.active.append(["Value"])
    workbook.active.append([value])
    workbook.active.append(["unparseable"])
    stream = BytesIO()
    workbook.save(stream)
    report = run_quality_rules(stream.getvalue())
    issue = next(issue for issue in report["issues"] if issue["kind"] == "type_mismatch")
    assert issue["proposed_target_type"] == expected
