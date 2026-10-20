"""Output validation worker: reopen, reconcile and reject unsafe output."""

from __future__ import annotations

from hashlib import sha256
from io import BytesIO
from typing import Any

from openpyxl import load_workbook


def validate_output(
    source: bytes,
    output: bytes,
    *,
    expected_sheet: str | None = None,
    expected_headers: list[str] | None = None,
    expected_formulas: list[str] | None = None,
    expected_min_rows: int | None = None,
) -> dict[str, Any]:
    source_hash = sha256(source).hexdigest()
    output_hash = sha256(output).hexdigest()
    # Equal bytes are allowed for a reviewed no-op, but the output must still open.
    workbook = load_workbook(BytesIO(output), data_only=False)
    try:
        if expected_sheet and expected_sheet not in workbook.sheetnames:
            raise ValueError(f"expected sheet is missing: {expected_sheet}")
        worksheet = workbook[expected_sheet] if expected_sheet else workbook.worksheets[0]
        headers = [cell.value for cell in worksheet[1]]
        if expected_headers:
            for header in expected_headers:
                if headers.count(header) != 1:
                    raise ValueError(f"expected header must occur exactly once: {header}")
        if expected_min_rows is not None and worksheet.max_row < expected_min_rows:
            raise ValueError(f"output has fewer rows than expected: {worksheet.max_row} < {expected_min_rows}")
        formulas = [cell.coordinate for row in worksheet.iter_rows() for cell in row if isinstance(cell.value, str) and cell.value.startswith("=")]
        for coordinate in expected_formulas or []:
            if coordinate not in formulas:
                raise ValueError(f"expected formula missing: {coordinate}")
        for row in worksheet.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and "[" in cell.value and "]" in cell.value:
                    raise ValueError("output contains an external workbook link")
        return {
            "status": "valid",
            "source_sha256": source_hash,
            "output_sha256": output_hash,
            "source_and_output_equal": source_hash == output_hash,
            "sheet_names": workbook.sheetnames,
            "formula_count": len(formulas),
            "row_count": worksheet.max_row,
            "column_count": worksheet.max_column,
        }
    finally:
        workbook.close()
