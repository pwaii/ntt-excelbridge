# Varied-Domain Sample Workbook Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three single-workbook sample fixtures (finance, HR, inventory) that each exercise a distinct Tool #3 formula flavor plus a distinct mix of data-quality problems and guardrail edge cases.

**Architecture:** One new generator script `backend/scripts/make_samples.py` mirroring the proven `make_fixtures.py` pattern — module-level `*_ROWS` constants with per-row comments, a `SAMPLES` registry, and a `write_samples(out_dir)` writer. A `_build` helper stores any cell whose value starts with `=` as literal text (`data_type="s"`) so formula-injection cells are data, never formulas. A mirror test `test_samples.py` reopens each generated workbook and asserts its labeled conditions. The README gets a documenting section.

**Tech Stack:** Python, openpyxl, pytest. Run from `backend/`; venv at repo-root `.venv`.

**Spec:** `docs/superpowers/specs/2026-10-20-varied-sample-fixtures-design.md`

---

### Task 1: Finance fixture + generator skeleton

**Files:**
- Create: `backend/scripts/make_samples.py`
- Test: `backend/app/tests/test_samples.py`

- [ ] **Step 1: Write the failing finance tests**

Create `backend/app/tests/test_samples.py`:

```python
"""Self-check: generated varied-domain samples carry their labeled problems.
Tests the fixtures (the deliverable), not generator internals — generate into a
tmp dir, reopen, assert each condition. See
docs/superpowers/specs/2026-10-20-varied-sample-fixtures-design.md."""
from datetime import datetime

import pytest
from openpyxl import load_workbook

from scripts.make_samples import write_samples


@pytest.fixture
def books(tmp_path):
    """filename -> loaded Workbook for every generated sample."""
    return {p.name: load_workbook(p) for p in write_samples(tmp_path)}


def _rows(ws):
    """Row tuples below the header, values only."""
    return list(ws.iter_rows(min_row=2, values_only=True))


def _formula_text_cells(ws):
    """Cells whose stored value starts with '=' (injection / formula-as-data)."""
    return [c for row in ws.iter_rows(min_row=2) for c in row
            if isinstance(c.value, str) and c.value.startswith("=")]


# --- finance.xlsx / Invoices ---

def test_finance_duplicate_and_blank_row(books):
    rows = _rows(books["finance.xlsx"]["Invoices"])
    assert rows[0] == rows[1]                                      # F1 == F2
    assert sum(1 for r in rows if all(c is None for c in r)) == 1  # one blank row


def test_finance_memo_is_blank_column(books):
    rows = _rows(books["finance.xlsx"]["Invoices"])
    assert all(r[7] is None for r in rows)                         # Memo (index 7)


def test_finance_unitprice_type_mismatch(books):
    prices = [r[4] for r in _rows(books["finance.xlsx"]["Invoices"]) if r[4] is not None]
    assert any(isinstance(p, float) for p in prices)
    assert any(isinstance(p, str) for p in prices)


def test_finance_injection_cell_stored_as_text(books):
    cells = _formula_text_cells(books["finance.xlsx"]["Invoices"])
    assert cells and all(c.data_type == "s" for c in cells)
```

- [ ] **Step 2: Run the finance tests to verify they fail**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_samples.py -v`
Expected: FAIL at import — `ModuleNotFoundError: No module named 'scripts.make_samples'`.

- [ ] **Step 3: Create the generator with the finance domain**

Create `backend/scripts/make_samples.py`:

```python
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
FINANCE_ROWS = [
    ("INV001", "2023-01-10", "Acme",     2, 10.00,      0.07, None,                        None),  # F1 baseline
    ("INV001", "2023-01-10", "Acme",     2, 10.00,      0.07, None,                        None),  # F2 duplicate of F1
    ("INV003", "2023-01-12", "Globex",   3, "1,200.50", 0.07, None,                        None),  # F3 thousands-sep text price
    ("INV004", "13/01/2023", "Initech",  1, "$5.50",    "7%", None,                        None),  # F4 currency text + percent text
    ("INV005", "2023-01-14", "Hooli",    4, "(3.00)",   None, None,                        None),  # F5 neg-paren text + TaxRate blank
    ("INV006", "2023-01-15", "Umbrella", 1, 8.00,       0.07, '=WEBSERVICE("http://x")',   None),  # F6 formula-as-data in Notes
    (None,     None,         None,    None, None,       None, None,                        None),  # F7 completely blank row
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
```

- [ ] **Step 4: Run the finance tests to verify they pass**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_samples.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/make_samples.py backend/app/tests/test_samples.py
git commit -m "feat(fixtures): add finance sample workbook + generator skeleton"
```

---

### Task 2: HR fixture

**Files:**
- Modify: `backend/scripts/make_samples.py` (add `HR_*` constants + registry entry)
- Test: `backend/app/tests/test_samples.py` (add HR tests)

- [ ] **Step 1: Write the failing HR tests**

Append to `backend/app/tests/test_samples.py`:

```python
# --- hr.xlsx / Employees ---

def test_hr_duplicate_and_blank_row(books):
    rows = _rows(books["hr.xlsx"]["Employees"])
    assert rows[0] == rows[1]                                      # H1 == H2
    assert sum(1 for r in rows if all(c is None for c in r)) == 1  # one blank row


def test_hr_salary_type_mismatch(books):
    salaries = [r[5] for r in _rows(books["hr.xlsx"]["Employees"]) if r[5] is not None]
    assert any(isinstance(s, int) for s in salaries)
    assert "N/A" in salaries


def test_hr_fulltime_boolean_like(books):
    ft = {r[6] for r in _rows(books["hr.xlsx"]["Employees"]) if r[6] is not None}
    assert {"TRUE", "Yes", 1, "N"}.issubset(ft)


def test_hr_hiredate_has_invalid_value(books):
    dates = [r[4] for r in _rows(books["hr.xlsx"]["Employees"]) if r[4] is not None]

    def parseable(s):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                datetime.strptime(s, fmt)
                return True
            except ValueError:
                pass
        return False

    assert any(not parseable(d) for d in dates)                    # "2023-13-45"


def test_hr_unicode_and_nonlatin_names(books):
    firsts = {r[1] for r in _rows(books["hr.xlsx"]["Employees"]) if r[1]}
    assert "José" in firsts                                        # accented
    assert "李" in firsts                                          # non-latin
```

- [ ] **Step 2: Run the HR tests to verify they fail**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_samples.py -v -k hr`
Expected: FAIL with `KeyError: 'hr.xlsx'` (fixture not generated yet).

- [ ] **Step 3: Add the HR domain to the generator**

In `backend/scripts/make_samples.py`, add after the `FINANCE_ROWS` block:

```python
HR_HEADERS = ["EmpID", "FirstName", "LastName", "Department",
              "HireDate", "Salary", "FullTime"]
HR_ROWS = [
    ("E01", "Jane",    "Doe",   "Sales", "2023-02-01", 50000, "TRUE"),  # H1 baseline
    ("E01", "Jane",    "Doe",   "Sales", "2023-02-01", 50000, "TRUE"),  # H2 duplicate of H1
    ("E03", "  jane ", "SMITH", "Ops",   "2023-02-03", 55000, "Yes"),   # H3 whitespace + casing noise
    ("E04", "José",    "Núñez", "Eng",   "04/02/2023", 60000, 1),       # H4 accented name, DD/MM date, int FullTime
    ("E05", "李",      "雷",    "Eng",   "2023-02-05", 62000, "N"),     # H5 non-latin name
    ("E06", "Bob",     "Lee",   "Sales", "2023-02-06", "N/A", "Yes"),   # H6 Salary "N/A" (type mismatch)
    ("E07", "Amy",     "Fox",   "Ops",   "2023-13-45", None,  "Yes"),   # H7 invalid date + Salary blank
    (None,  None,      None,    None,    None,         None,  None),    # H8 completely blank row
]
```

Then add this entry to the `SAMPLES` list (after the finance entry):

```python
    {"filename": "hr.xlsx", "sheet": "Employees",
     "headers": HR_HEADERS, "rows": HR_ROWS,
     "prompt": "Add a DisplayName column: last name uppercased, comma, first name",
     "output_header": "DisplayName"},
```

- [ ] **Step 4: Run all sample tests to verify they pass**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_samples.py -v`
Expected: 9 passed (4 finance + 5 HR).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/make_samples.py backend/app/tests/test_samples.py
git commit -m "feat(fixtures): add HR sample workbook"
```

---

### Task 3: Inventory fixture

**Files:**
- Modify: `backend/scripts/make_samples.py` (add `INVENTORY_*` constants + registry entry)
- Test: `backend/app/tests/test_samples.py` (add inventory tests)

- [ ] **Step 1: Write the failing inventory tests**

Append to `backend/app/tests/test_samples.py`:

```python
# --- inventory.xlsx / Products ---

def test_inventory_duplicate_and_blank_row(books):
    rows = _rows(books["inventory.xlsx"]["Products"])
    assert rows[0] == rows[1]                                      # I1 == I2
    assert sum(1 for r in rows if all(c is None for c in r)) == 1  # one blank row


def test_inventory_sku_type_mismatch(books):
    skus = [r[0] for r in _rows(books["inventory.xlsx"]["Products"]) if r[0] is not None]
    assert any(isinstance(s, str) and s.startswith("0") for s in skus)  # leading-zero text
    assert any(isinstance(s, int) for s in skus)                        # numeric SKU


def test_inventory_stockqty_edges(books):
    qty = [r[2] for r in _rows(books["inventory.xlsx"]["Products"])]
    present = [q for q in qty if q is not None]
    assert None in qty                                             # blank
    assert any(isinstance(q, int) and q < 0 for q in present)      # negative
    assert any(isinstance(q, str) for q in present)                # text "12"
    assert 1_000_000_000 in present                                # huge


def test_inventory_discontinued_is_blank_column(books):
    rows = _rows(books["inventory.xlsx"]["Products"])
    assert all(r[5] is None for r in rows)                         # Discontinued (index 5)


def test_inventory_injection_cell_stored_as_text(books):
    cells = _formula_text_cells(books["inventory.xlsx"]["Products"])
    assert cells and all(c.data_type == "s" for c in cells)
```

- [ ] **Step 2: Run the inventory tests to verify they fail**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_samples.py -v -k inventory`
Expected: FAIL with `KeyError: 'inventory.xlsx'`.

- [ ] **Step 3: Add the inventory domain to the generator**

In `backend/scripts/make_samples.py`, add after the `HR_ROWS` block:

```python
INVENTORY_HEADERS = ["SKU", "ProductName", "StockQty",
                     "ReorderPoint", "Price", "Discontinued"]
INVENTORY_ROWS = [
    ("00045", "Widget",               100,            20, 9.99,   None),  # I1 leading-zero SKU, baseline
    ("00045", "Widget",               100,            20, 9.99,   None),  # I2 duplicate of I1
    (9001,    "Gadget",               "12",           15, 12.50,  None),  # I3 numeric SKU + text StockQty
    ("00046", "Gizmo",                None,           10, 4.00,   None),  # I4 StockQty blank
    ("00047", "Doohickey",            -5,             10, 3.50,   None),  # I5 negative StockQty
    ("00048", "Thingamajig",          1_000_000_000,   5, "$9.99", None), # I6 huge StockQty + currency-text Price
    ("00049", "=cmd|' /c calc'!A1",   50,              5, 7.00,   None),  # I7 injection string in ProductName
    (None,    None,                   None,         None, None,   None),  # I8 completely blank row
]
```

Then add this entry to the `SAMPLES` list (after the HR entry):

```python
    {"filename": "inventory.xlsx", "sheet": "Products",
     "headers": INVENTORY_HEADERS, "rows": INVENTORY_ROWS,
     "prompt": "Add a Reorder column: Yes when StockQty is below ReorderPoint",
     "output_header": "Reorder"},
```

- [ ] **Step 4: Run all sample tests to verify they pass**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_samples.py -v`
Expected: 14 passed (4 finance + 5 HR + 5 inventory).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/make_samples.py backend/app/tests/test_samples.py
git commit -m "feat(fixtures): add inventory sample workbook"
```

---

### Task 4: Generate the files, document them, and smoke-test the demo path

**Files:**
- Create (generated): `sample-data/finance.xlsx`, `sample-data/hr.xlsx`, `sample-data/inventory.xlsx`
- Modify: `sample-data/README.md`

- [ ] **Step 1: Generate the three workbooks into sample-data/**

Run: `cd backend && ../.venv/Scripts/python.exe -m scripts.make_samples`
Expected: three `wrote .../sample-data/<file>.xlsx` lines.

- [ ] **Step 2: Smoke-test one domain through the real pipeline**

Run (Bedrock creds in env):
```bash
cd backend && ../.venv/Scripts/python.exe -m scripts.playtest \
  --input ../sample-data/finance.xlsx --prompt "Add a Total column = Quantity * UnitPrice * (1 + TaxRate), rounded to 2 decimals" --header Total \
  --out ../playtest-finance-out.xlsx --main ../sample-data/finance.xlsx
```
Expected: quality rules report lists a duplicate_rows, a blank_row, a blank_column (Memo), and a type_mismatch (UnitPrice); an output workbook is written. (A Tool #3 rejection is an acceptable guardrail outcome — the script proceeds with quality fixes only.) Delete the scratch output after: `rm ../playtest-finance-out.xlsx ../playtest-finance-out-main.xlsx 2>/dev/null || true`.

- [ ] **Step 3: Append the documenting section to the README**

Append to `sample-data/README.md`:

```markdown
## Varied-domain samples

**Fake** data generated by `backend/scripts/make_samples.py` (companion to
`make_fixtures.py`); regenerate with `cd backend && python -m scripts.make_samples`.
Each is a single workbook (no paired master) exercising quality rules + Tool #1/#2/#3.
Spec: `docs/superpowers/specs/2026-10-20-varied-sample-fixtures-design.md`.

### finance.xlsx — sheet `Invoices`

Demo prompt: *"Add a Total column = Quantity × UnitPrice × (1 + TaxRate), rounded to 2 decimals"* → header `Total` (arithmetic).
Columns: `InvoiceID, Date, Customer, Quantity, UnitPrice, TaxRate, Notes, Memo`.

| Row | Carries |
|---|---|
| F1 | baseline clean row |
| F2 | exact duplicate of F1 |
| F3 | `UnitPrice` thousands-separated text `"1,200.50"` |
| F4 | `UnitPrice` currency text `"$5.50"`; `TaxRate` percent text `"7%"` |
| F5 | `UnitPrice` negative-paren text `"(3.00)"`; `TaxRate` blank |
| F6 | `Notes` holds literal `=WEBSERVICE("http://x")` (formula-as-data / injection) |
| F7 | completely blank row |

`Memo` is a fully blank column. `UnitPrice` → type_mismatch (float + text encodings).

### hr.xlsx — sheet `Employees`

Demo prompt: *"Add a DisplayName column: last name uppercased, comma, first name"* → header `DisplayName` (text).
Columns: `EmpID, FirstName, LastName, Department, HireDate, Salary, FullTime`.

| Row | Carries |
|---|---|
| H1 | baseline clean row |
| H2 | exact duplicate of H1 |
| H3 | whitespace `"  jane "` + casing `"SMITH"` |
| H4 | accented name `José Núñez`, `DD/MM/YYYY` date, int `FullTime` |
| H5 | non-latin name `李 雷` |
| H6 | `Salary` `"N/A"` (type_mismatch driver) |
| H7 | invalid `HireDate` `2023-13-45`; `Salary` blank |
| H8 | completely blank row |

`FullTime` boolean-like spread: `TRUE` / `Yes` / `1` / `N`.

### inventory.xlsx — sheet `Products`

Demo prompt: *"Add a Reorder column: Yes when StockQty is below ReorderPoint"* → header `Reorder` (IF logic).
Columns: `SKU, ProductName, StockQty, ReorderPoint, Price, Discontinued`.

| Row | Carries |
|---|---|
| I1 | leading-zero SKU `"00045"`, baseline |
| I2 | exact duplicate of I1 |
| I3 | numeric SKU `9001` + text `StockQty` `"12"` |
| I4 | `StockQty` blank |
| I5 | `StockQty` negative `-5` |
| I6 | `StockQty` huge `1000000000`; `Price` currency text `"$9.99"` |
| I7 | `ProductName` injection string `=cmd\|' /c calc'!A1` |
| I8 | completely blank row |

`Discontinued` is a fully blank column. `SKU` → type_mismatch (text identifiers + one int).
```

- [ ] **Step 4: Verify the full test suite still passes**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_samples.py app/tests/test_fixtures.py -v`
Expected: all passed (14 sample + existing fixture tests).

- [ ] **Step 5: Commit**

```bash
git add sample-data/finance.xlsx sample-data/hr.xlsx sample-data/inventory.xlsx sample-data/README.md
git commit -m "feat(fixtures): generate finance/hr/inventory workbooks + document them"
```
```

---

## Self-review notes

- **Spec coverage:** §3 finance → Task 1; §4 HR → Task 2; §5 inventory → Task 3; §6 generator structure → Tasks 1–3; §7 self-check → test steps in each task; §8 README → Task 4. Deferred items (paired masters, rejection fixtures) are out of scope and have no tasks, as intended.
- **Placeholder scan:** none — every code/test step shows full content; commands have expected output.
- **Type consistency:** `write_samples` / `_build` / `SAMPLES` / `_rows` / `_formula_text_cells` names and the column indexes used in tests match the headers defined in the generator across all tasks.
- **Known risk (verified):** openpyxl stores a `=`-leading string as text when `cell.data_type = "s"` is set after assignment; confirmed round-trips as `data_type == "s"` with the literal value, so the injection tests are sound.
