# AI Day-2 Sample Workbook Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `sample-data/current.xlsx` + `main.xlsx` — intentionally-messy fake customer workbooks that exercise all 12 §16.3 data-quality / standardization / update-matching conditions — via a committed, self-verified generator.

**Architecture:** A single openpyxl generator script holds the fixture data as Python literals and writes both workbooks. A self-check test regenerates into a tmp dir and asserts each §16.3 condition holds. The generated `.xlsx` files and a manifest README are committed so BE/frontend/demo can use ready files.

**Tech Stack:** Python 3.12, openpyxl (already a backend dependency), pytest.

**Spec:** `docs/superpowers/specs/2026-10-15-ai-day2-fixtures-design.md`

---

## File Structure

- Create: `backend/scripts/make_fixtures.py` — fixture data (literals) + generator functions + `__main__`. Sole source of truth for the data.
- Create: `backend/app/tests/test_fixtures.py` — self-check that the generated workbooks satisfy §16.3.
- Create: `sample-data/current.xlsx`, `sample-data/main.xlsx` — generated, committed artifacts.
- Create: `sample-data/README.md` — manifest explaining each row/column.

All commands run from `backend/` (matches the existing `python -m scripts.smoke_tool1` pattern; `pyproject.toml` sets `pythonpath = ["."]` so `scripts.*` imports resolve in pytest).

---

## Task 1: Generator + self-check test (TDD)

**Files:**
- Create: `backend/app/tests/test_fixtures.py`
- Create: `backend/scripts/make_fixtures.py`

- [ ] **Step 1: Write the failing test**

Create `backend/app/tests/test_fixtures.py`:

```python
"""Self-check: the generated §16.3 fixtures actually carry all 12 conditions.
Tests the fixture (the deliverable), not generator internals — generate into a tmp
dir, reopen, and assert each condition. See
docs/superpowers/specs/2026-10-15-ai-day2-fixtures-design.md."""
from datetime import datetime

import pytest
from openpyxl import load_workbook

from scripts.make_fixtures import write_fixtures


@pytest.fixture
def workbooks(tmp_path):
    current_path, main_path = write_fixtures(tmp_path)
    cur = load_workbook(current_path)["Customers"]
    main = load_workbook(main_path)["CanonicalCustomers"]
    return cur, main


def _data_rows(ws):
    """Row tuples below the header, values only."""
    return list(ws.iter_rows(min_row=2, values_only=True))


def test_customer_id_leading_zeros_preserved(workbooks):
    cur, _ = workbooks
    first = _data_rows(cur)[0]
    assert first[0] == "000100"
    assert isinstance(first[0], str)


def test_notes_column_is_blank(workbooks):
    cur, _ = workbooks
    assert all(row[7] is None for row in _data_rows(cur))


def test_exactly_one_completely_blank_row(workbooks):
    cur, _ = workbooks
    blanks = [r for r in _data_rows(cur) if all(c is None for c in r)]
    assert len(blanks) == 1


def test_two_exact_duplicate_rows(workbooks):
    cur, _ = workbooks
    rows = _data_rows(cur)
    assert rows[0] == rows[1]


def test_date_column_has_two_formats_and_one_invalid(workbooks):
    cur, _ = workbooks
    dates = [r[3] for r in _data_rows(cur) if r[3] is not None]
    assert "2023-01-15" in dates      # ISO variant
    assert "15/02/2023" in dates      # DD/MM/YYYY variant

    def parseable(s):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                datetime.strptime(s, fmt)
                return True
            except ValueError:
                pass
        return False

    assert any(not parseable(d) for d in dates)   # "2023-13-45" is invalid


def test_boolean_like_column_variants(workbooks):
    cur, _ = workbooks
    rows = _data_rows(cur)
    actives = {r[4] for r in rows if r[4] is not None}
    assert {"Y", "Yes", "N", "No"}.issubset(actives)
    # a populated row whose Active is blank (not the fully-blank row)
    assert any(r[4] is None and r[1] is not None for r in rows)


def test_ambiguous_and_shared_main_row_pairs(workbooks):
    cur, main = workbooks
    main_rows = _data_rows(main)
    cur_rows = _data_rows(cur)
    # ambiguity source: two identical names in main
    assert sum(1 for r in main_rows if r[1] == "Jane Smith") == 2
    # shared-main-row pair: two current rows, one main row, same key
    assert sum(1 for r in cur_rows if r[0] == "000500") == 2
    assert sum(1 for r in main_rows if r[0] == "000500") == 1


def test_unmapped_standardization_value(workbooks):
    cur, main = workbooks
    main_countries = {r[2] for r in _data_rows(main)}
    cur_countries = {r[2] for r in _data_rows(cur) if r[2] is not None}
    assert "Wakanda" in cur_countries
    assert "Wakanda" not in main_countries
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest app/tests/test_fixtures.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'scripts.make_fixtures'` (feature missing, not a typo).

- [ ] **Step 3: Write minimal implementation**

Create `backend/scripts/make_fixtures.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest app/tests/test_fixtures.py -q`
Expected: `8 passed`.

Then confirm nothing else broke and lint is clean:
Run: `cd backend && python -m pytest -q && python -m ruff check scripts/make_fixtures.py app/tests/test_fixtures.py`
Expected: full suite passes (24 passed); ruff reports no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/make_fixtures.py backend/app/tests/test_fixtures.py
git commit -m "feat(ai): §16.3 sample workbook fixture generator + self-check

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Generate and commit the workbook artifacts + manifest

**Files:**
- Create: `sample-data/current.xlsx`, `sample-data/main.xlsx` (generated)
- Create: `sample-data/README.md`

- [ ] **Step 1: Generate the committed workbooks**

Run: `cd backend && python -m scripts.make_fixtures`
Expected output (paths will be absolute):
```
wrote .../sample-data/current.xlsx
wrote .../sample-data/main.xlsx
```

- [ ] **Step 2: Write the manifest**

Create `sample-data/README.md`:

```markdown
# Sample workbook fixtures

**Fake** customer data — not real records. Generated by `backend/scripts/make_fixtures.py`
(the source of truth); regenerate with `cd backend && python -m scripts.make_fixtures`.
Each row/column intentionally carries one data-quality / standardization / update-matching
case from `design.md` §16.3. Spec: `docs/superpowers/specs/2026-10-15-ai-day2-fixtures-design.md`.

## current.xlsx — sheet `Customers`

Columns: `CustomerID` (text, leading zeros), `FullName`, `Country` (standardization source),
`SignupDate` (text — raw date strings), `Active` (boolean-like), `Quantity`, `UnitPrice`
(numeric, feed a formula-based `Total` column), `Notes` (blank column).

| Row | CustomerID | Carries |
|---|---|---|
| R1 | 000100 | exact match to main |
| R2 | 000100 | exact duplicate of R1 |
| R3 | 000200 | needs normalization (`U.S.A.`, `15/02/2023`) |
| R4 | 000300 | invalid date `2023-13-45` |
| R5 | 000400 | unmapped country `Wakanda` (absent from main) |
| R6 | *(blank)* | ambiguous match — `Jane Smith`, two main candidates |
| R7 | 000500 | maps to main 000500 |
| R8 | 000500 | maps to same main row, conflicting fields |
| R9 | *(blank)* | completely blank row (interior) |
| R10 | 000600 | `Active` blank |

Boolean-like `Active` spread: `Y` (R1), `Yes` (R3/R7), `No` (R4/R8), `N` (R5), blank (R10).
Date formats: ISO `2023-01-15`, `DD/MM/YYYY` `15/02/2023`, invalid `2023-13-45`.

## main.xlsx — sheet `CanonicalCustomers`

Canonical master; key = `CustomerID`. Columns: `CustomerID`, `FullName`, `Country` (canonical).

| Row | CustomerID | FullName | Country |
|---|---|---|---|
| M1 | 000100 | Acme Corp | United States |
| M2 | 000200 | Globex LLC | United States |
| M3 | 000300 | Initech | United Kingdom |
| M4 | 000500 | Umbrella Inc | United States |
| M5 | 000700 | Jane Smith | United States |
| M6 | 000701 | Jane Smith | Canada |

`000400` (Hooli) is intentionally absent — R5 has no update match (the unmapped case).

## Deferred

`expected-result.xlsx` + the semantic cell-assertion harness wait for Tools #2–#5 and the
`apply_changes` / `validate_output` workers (separate spec).
```

- [ ] **Step 3: Verify the artifacts open and carry the conditions**

Run: `cd backend && python -c "from openpyxl import load_workbook; w=load_workbook('../sample-data/current.xlsx'); ws=w['Customers']; print(ws.max_row, ws['A2'].value, type(ws['A2'].value).__name__)"`
Expected: `11 000100 str` (header + 10 data rows; leading-zero ID preserved as text).

- [ ] **Step 4: Commit**

```bash
git add sample-data/current.xlsx sample-data/main.xlsx sample-data/README.md
git commit -m "feat(ai): generate §16.3 sample workbooks + manifest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **openpyxl `append` with an all-`None` row (R9):** `append` always advances the row pointer, so R10 lands on the row after R9, leaving a genuine interior blank row. On reload, `iter_rows` yields R9 as a tuple of all-`None` values because R10 extends the sheet dimension past it. This is why the blank row is placed mid-data, never last.
- **Running location:** everything runs from `backend/`. `write_fixtures` takes an explicit `out_dir`, so the test writes to `tmp_path` and only `main()` touches the real `sample-data/`.
- **Line-ending warnings** from git on the committed `.md` are harmless on Windows.
