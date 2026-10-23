"""Regression: segment-2/3 must use each input slot's own sheet, not the primary input's.

A secondary input workbook can have a different sheet name than the primary. Reusing the
primary's `config.input_sheet` for every slot made `inspect_bytes` raise "Selected worksheet
does not exist" on quality-gate submission (503).
"""

from io import BytesIO

from openpyxl import Workbook

from app.lambda_handlers import _tool_inputs


def _wb(sheet_title: str, headers: list[str]) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = sheet_title
    sheet.append(headers)
    sheet.append(["v"] * len(headers))
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


class _S3:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects

    def get_bytes(self, key: str) -> bytes:
        return self.objects[key]


def test_tool_inputs_uses_secondary_slot_sheet_not_primary():
    item = {
        "files": {"input": {"key": "k1"}, "input_2": {"key": "k2"}},
        "config": {"input_sheet": "Primary", "input_header_row": 1,
                   "comment_name": "c", "output_header": "o"},
        # Secondary input keeps its own sheet selection here.
        "workbook_selections": {"input_2": {"sheet_name": "West Shipment", "header_row": 1}},
    }
    s3 = _S3({"k1": _wb("Primary", ["A", "B"]),
              "k2": _wb("West Shipment", ["PartNo", "OnHand"])})

    # Before the fix this raised ValueError("Selected worksheet does not exist").
    out = _tool_inputs(item, s3, "tool1", "input_2")
    assert out["current_headers"] == ["PartNo", "OnHand"]
