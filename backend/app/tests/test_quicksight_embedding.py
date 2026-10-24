from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api import analytics


class FakeQuickSight:
    def __init__(self, unprotected_dataset: str | None = None) -> None:
        self.unprotected_dataset = unprotected_dataset
        self.described: list[str] = []

    def describe_data_set(self, *, AwsAccountId: str, DataSetId: str) -> dict:
        assert AwsAccountId == "453995432289"
        self.described.append(DataSetId)
        protected = DataSetId != self.unprotected_dataset
        return {
            "DataSet": {
                "OutputColumns": [{"Name": "owner_id"}],
                "RowLevelPermissionDataSet": {
                    "Arn": "arn:aws:quicksight:ap-southeast-1:453995432289:dataset/owner-rules",
                    "PermissionPolicy": "GRANT_ACCESS",
                    "FormatVersion": "VERSION_2",
                    "Status": "ENABLED" if protected else "DISABLED",
                },
            }
        }


def test_embed_rls_guard_includes_workbook_rows_dataset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analytics.settings, "quicksight_quality_dataset_id", "quality")
    monkeypatch.setattr(analytics.settings, "quicksight_inspection_dataset_id", "inspection")
    monkeypatch.setattr(analytics.settings, "quicksight_workbook_rows_dataset_id", "workbook-rows")
    monkeypatch.setattr(analytics.settings, "quicksight_workbook_field_pairs_dataset_id", "workbook-field-pairs")
    dataset_ids = analytics._dashboard_dataset_ids()
    quicksight = FakeQuickSight()

    analytics._verify_dashboard_dataset_rls(
        quicksight,
        "453995432289",
        dataset_ids,
        "arn:aws:quicksight:ap-southeast-1:453995432289:dataset/owner-rules",
    )

    assert quicksight.described == ["quality", "inspection", "workbook-rows", "workbook-field-pairs"]


def test_embed_rls_guard_blocks_unprotected_workbook_rows() -> None:
    quicksight = FakeQuickSight(unprotected_dataset="workbook-rows")

    with pytest.raises(HTTPException) as error:
        analytics._verify_dashboard_dataset_rls(
            quicksight,
            "453995432289",
            ("quality", "inspection", "workbook-rows", "workbook-field-pairs"),
            "arn:aws:quicksight:ap-southeast-1:453995432289:dataset/owner-rules",
        )

    assert error.value.status_code == 503
    assert error.value.headers["X-Error-Code"] == "QUICKSIGHT_RLS_NOT_READY"
    assert quicksight.described == ["quality", "inspection", "workbook-rows", "workbook-field-pairs"]
