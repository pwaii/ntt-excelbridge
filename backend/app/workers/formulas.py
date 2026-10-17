"""Backend-owned formula verifier for Tool #3 proposals."""

from __future__ import annotations

import re
from io import BytesIO

from openpyxl import Workbook
from openpyxl.formula import Tokenizer
from openpyxl.utils.cell import column_index_from_string

DEFAULT_FUNCTIONS = frozenset({"ABS", "AVERAGE", "CONCAT", "COUNT", "COUNTA", "DATE", "DAY", "IF", "IFERROR", "LEFT", "LEN", "LOWER", "MAX", "MIN", "MONTH", "OR", "ROUND", "SUM", "TRIM", "UPPER", "YEAR"})
FORBIDDEN = frozenset({"INDIRECT", "OFFSET", "WEBSERVICE", "HYPERLINK", "NOW", "TODAY", "RAND", "RANDBETWEEN"})
_REF = re.compile(r"(?<![A-Z0-9_])\$?([A-Z]{1,3})\$?(\d+)(?![A-Z0-9_])", re.IGNORECASE)
_FUNCTION = re.compile(r"\b([A-Z][A-Z0-9_.]*)\s*\(", re.IGNORECASE)


def verify_formula(formula: str, *, allowed_functions: set[str] | None = None, min_row: int = 2, max_row: int = 2, min_column: int = 1, max_column: int = 16384, target_column: int | None = None) -> dict[str, object]:
    if not isinstance(formula, str) or not formula.startswith("="):
        raise ValueError("formula must start with '='")
    upper = formula.upper()
    if any(token in upper for token in ("[", "]", "#REF!", "!", "{", "}", "\\")):
        raise ValueError("formula contains an external link or unsupported syntax")
    functions = {match.group(1).upper() for match in _FUNCTION.finditer(upper)}
    allowed = {name.upper() for name in (allowed_functions or DEFAULT_FUNCTIONS)}
    forbidden = functions & FORBIDDEN
    unknown = functions - allowed
    if forbidden:
        raise ValueError(f"forbidden functions: {sorted(forbidden)}")
    if unknown:
        raise ValueError(f"functions not on allowlist: {sorted(unknown)}")
    references = []
    for match in _REF.finditer(upper):
        column = column_index_from_string(match.group(1))
        row = int(match.group(2))
        if not (min_row <= row <= max_row and min_column <= column <= max_column):
            raise ValueError(f"cell reference {match.group(0)} is outside the selected range")
        if target_column is not None and column == target_column:
            raise ValueError("formula references its output column")
        references.append(match.group(0))
    try:
        Tokenizer(formula)
        workbook = Workbook()
        workbook.active["A1"] = formula
        stream = BytesIO()
        workbook.save(stream)
    except Exception as error:
        raise ValueError("OpenPyXL could not serialize the formula") from error
    return {"status": "syntax_verified", "references": references, "calculated": False}
