"""Generate the §16.3 sample workbook fixtures: sample-data/current.xlsx + main.xlsx.

Intentionally-messy FAKE customer records used by tests and the demo — not real data.
Each row/column exercises one data-quality / standardization / update-matching case; see
docs/superpowers/specs/2026-10-15-ai-day2-fixtures-design.md and sample-data/README.md.

    cd backend && python -m scripts.make_fixtures
"""
from pathlib import Path

from openpyxl import Workbook

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE_DATA_DIR = REPO_ROOT / "sample-data"

CURRENT_HEADERS = ["CustomerID", "FullName", "Country", "SignupDate",
                   "Active", "Quantity", "UnitPrice", "Notes"]

# None = genuinely empty cell. CustomerID / SignupDate / Active are kept as text strings
# so leading zeros and raw date formats survive — detecting/normalizing them is the
# pipeline's job, not Excel's. Row comments map to the spec §3 table.
CURRENT_ROWS = [
    ("000100", "Acme Corp",    "United States",  "2023-01-15", "Y",   2, 10.00, None),  # R1 exact match
    ("000100", "Acme Corp",    "United States",  "2023-01-15", "Y",   2, 10.00, None),  # R2 duplicate of R1
    ("000200", "Globex LLC",   "U.S.A.",         "15/02/2023", "Yes", 3, 5.50,  None),  # R3 needs normalization
    ("000300", "Initech",      "United Kingdom", "2023-13-45", "No",  1, 20.00, None),  # R4 invalid date
    ("000400", "Hooli",        "Wakanda",        "2023-03-01", "N",   4, 2.25,  None),  # R5 unmapped country
    (None,     "Jane Smith",   "United States",  "2023-04-10", "Y",   1, 99.00, None),  # R6 ambiguous match
    ("000500", "Umbrella Inc", "United States",  "2023-05-01", "Yes", 2, 15.00, None),  # R7 -> main 000500
    ("000500", "Umbrella Inc", "United States",  "2023-06-01", "No",  5, 15.00, None),  # R8 -> same main, conflict
    (None,     None,           None,             None,         None,  None, None, None), # R9 completely blank (interior)
    ("000600", "Soylent Co",   "United States",  "2023-07-20", None,  3, 8.00,  None),  # R10 Active blank
]

MAIN_HEADERS = ["CustomerID", "FullName", "Country"]

MAIN_ROWS = [
    ("000100", "Acme Corp",    "United States"),   # M1 exact target for R1/R2
    ("000200", "Globex LLC",   "United States"),   # M2 normalization target for R3
    ("000300", "Initech",      "United Kingdom"),  # M3 target for R4
    ("000500", "Umbrella Inc", "United States"),   # M4 single row R7 and R8 both map to
    ("000700", "Jane Smith",   "United States"),   # M5 ambiguous pair for R6
    ("000701", "Jane Smith",   "Canada"),          # M6 ambiguous pair for R6
]


def _build(headers: list[str], rows: list[tuple], sheet_title: str) -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title
    ws.append(headers)
    for row in rows:
        ws.append(list(row))
    return wb


def write_fixtures(out_dir: Path) -> tuple[Path, Path]:
    """Write current.xlsx + main.xlsx into out_dir; return their paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    current_path = out_dir / "current.xlsx"
    main_path = out_dir / "main.xlsx"
    _build(CURRENT_HEADERS, CURRENT_ROWS, "Customers").save(current_path)
    _build(MAIN_HEADERS, MAIN_ROWS, "CanonicalCustomers").save(main_path)
    return current_path, main_path


def main() -> None:
    current_path, main_path = write_fixtures(SAMPLE_DATA_DIR)
    print(f"wrote {current_path}")
    print(f"wrote {main_path}")


if __name__ == "__main__":
    main()
