"""Generate varied-domain sample workbooks: finance / hr / inventory.

Intentionally-messy FAKE data — not real records. Each row/column carries one
labeled data-quality or guardrail edge case; see
docs/superpowers/specs/2026-10-20-varied-sample-fixtures-design.md and
sample-data/README.md. Companion to make_fixtures.py (the §16.3 customers pair).

    cd backend && python -m scripts.make_samples
"""
from pathlib import Path

from openpyxl import Workbook

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE_DATA_DIR = REPO_ROOT / "sample-data"

# None = genuinely empty cell. Numeric-looking values kept as text strings where the
# point is that detection/normalization is the pipeline's job, not Excel's.
FINANCE_HEADERS = ["InvoiceID", "Date", "Customer", "Quantity",
                   "UnitPrice", "TaxRate", "Notes", "Memo"]
# Whole-number floats reload as int, and a *trailing* all-None row is dropped by
# openpyxl — so prices are non-whole and the blank row sits before a non-blank one.
FINANCE_ROWS = [
    ("INV001", "2023-01-10", "Acme",     2, 10.50,      0.07, None,                        None),  # F1 baseline
    ("INV001", "2023-01-10", "Acme",     2, 10.50,      0.07, None,                        None),  # F2 duplicate of F1
    ("INV003", "2023-01-12", "Globex",   3, "1,200.50", 0.07, None,                        None),  # F3 thousands-sep text price
    ("INV004", "13/01/2023", "Initech",  1, "$5.50",    "7%", None,                        None),  # F4 currency text + percent text
    ("INV005", "2023-01-14", "Hooli",    4, "(3.00)",   None, None,                        None),  # F5 neg-paren text + TaxRate blank
    (None,     None,         None,    None, None,       None, None,                        None),  # F7 completely blank row (interior)
    ("INV006", "2023-01-15", "Umbrella", 1, 8.25,       0.07, '=WEBSERVICE("http://x")',   None),  # F6 formula-as-data, anchors blank row
]

SAMPLES = [
    {"filename": "finance.xlsx", "sheet": "Invoices",
     "headers": FINANCE_HEADERS, "rows": FINANCE_ROWS,
     "prompt": "Add a Total column = Quantity * UnitPrice * (1 + TaxRate), rounded to 2 decimals",
     "output_header": "Total"},
]


def _build(headers: list[str], rows: list[tuple], sheet_title: str) -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title
    ws.append(headers)
    for row in rows:
        ws.append(list(row))
    # Store any "=..."-leading string as text, not a formula: these are injection /
    # formula-as-data edge cases and the pipeline must never treat them as formulas.
    for cell_row in ws.iter_rows(min_row=2):
        for cell in cell_row:
            if isinstance(cell.value, str) and cell.value.startswith("="):
                cell.data_type = "s"
    return wb


def write_samples(out_dir: Path) -> list[Path]:
    """Write every sample workbook into out_dir; return their paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for sample in SAMPLES:
        path = out_dir / sample["filename"]
        _build(sample["headers"], sample["rows"], sample["sheet"]).save(path)
        paths.append(path)
    return paths


def main() -> None:
    for path in write_samples(SAMPLE_DATA_DIR):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
