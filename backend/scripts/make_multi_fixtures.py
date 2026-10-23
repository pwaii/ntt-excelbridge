"""Generate a multi-input demo set for the 'both' (standardize + update) policy:
four current workbooks (regional branches) + one shared canonical main.

FAKE data. Key = CustomerID. Each input carries standardize cases (messy Country
that normalizes to main's canonical, plus one unmapped) and update-matching cases
(exact / duplicate / conflict / ambiguous-blank-key / unmatched key). Headers match
make_fixtures.CURRENT_HEADERS so the existing pipeline + key column work unchanged.

    cd backend && python -m scripts.make_multi_fixtures
"""
from pathlib import Path

from scripts.make_fixtures import CURRENT_HEADERS, MAIN_HEADERS, _build

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = REPO_ROOT / "sample-data" / "multi"

# One shared canonical master (key = CustomerID).
MAIN_ROWS = [
    ("000100", "Acme Corp",    "United States"),   # exact target for region1 R1
    ("000200", "Globex LLC",   "United States"),   # normalization target for region1 R2
    ("000300", "Initech",      "United Kingdom"),  # normalization target for region2 R1
    ("000500", "Umbrella Inc", "United States"),   # single row region3 both rows map to
    ("000700", "Jane Smith",   "United States"),   # ambiguous pair for region4 blank-key row
    ("000701", "Jane Smith",   "Canada"),          # ambiguous pair for region4 blank-key row
]

# cols: CustomerID, FullName, Country, SignupDate, Active, Quantity, UnitPrice, Notes
INPUTS: dict[str, list[tuple]] = {
    "region1.xlsx": [  # North America — clean matches, country needs normalizing
        ("000100", "Acme Corp",  "U.S.A.", "2023-01-15", "Y",   2, 10.00, None),  # standardize -> US; exact update
        ("000200", "Globex LLC", "USA",    "2023-02-01", "Yes", 3, 5.50,  None),  # standardize -> US; update
    ],
    "region2.xlsx": [  # Europe — one normalizes, one is unmapped + unmatched
        ("000300", "Initech", "U.K.",    "2023-03-10", "No", 1, 20.00, None),  # standardize -> UK; update
        ("000400", "Hooli",   "Wakanda", "2023-03-01", "N",  4, 2.25,  None),  # unmapped country + key absent from main
    ],
    "region3.xlsx": [  # duplicate + conflict on the same key
        ("000500", "Umbrella Inc", "united states", "2023-05-01", "Yes", 2, 15.00, None),  # standardize (case); update
        ("000500", "Umbrella Inc", "United States", "2023-06-01", "No",  5, 15.00, None),  # same key, conflicting fields
    ],
    "region4.xlsx": [  # ambiguous match (blank key) + clean match
        (None,     "Jane Smith", "US",     "2023-04-10", "Y",  1, 99.00, None),  # standardize -> US; ambiguous (000700/000701)
        ("000701", "Jane Smith", "canada", "2023-07-01", "Y",  2, 12.00, None),  # standardize -> Canada; update 000701
    ],
}


def write_fixtures(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, rows in INPUTS.items():
        path = out_dir / name
        _build(CURRENT_HEADERS, rows, "Customers").save(path)
        written.append(path)
    main_path = out_dir / "main.xlsx"
    _build(MAIN_HEADERS, MAIN_ROWS, "CanonicalCustomers").save(main_path)
    written.append(main_path)
    return written


if __name__ == "__main__":
    for path in write_fixtures(OUT_DIR):
        print(f"wrote {path}")
