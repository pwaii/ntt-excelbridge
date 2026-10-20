# Varied-Domain Sample Workbook Fixtures

**Date:** 2026-10-20
**Scope:** A second, broader fixture set alongside the existing §16.3 customers pair — three single-workbook domains (finance, HR, inventory) that each exercise a different Tool #3 formula flavor and a distinct mix of data-quality problems + guardrail edge cases. Serves demo, guardrail stress, and regression at once.

**Source of truth:** This spec. Builds on the proven pattern in `backend/scripts/make_fixtures.py` + `backend/app/tests/test_fixtures.py` (the §16.3 fixture). Fixtures are AI-owned per `design.md` §18 RACI.

---

## 1. Goal & scope

Produce a small library of realistic-but-messy single-sheet workbooks spanning different business domains, so the pipeline can be demoed on variety, the invariants can be stress-tested on nasty inputs, and pytest has deterministic fixtures to assert on.

**In scope**
- `sample-data/finance.xlsx` — invoice line items (arithmetic formula column).
- `sample-data/hr.xlsx` — employee roster (text formula column).
- `sample-data/inventory.xlsx` — product stock (IF-logic formula column).
- `backend/scripts/make_samples.py` — generator (source of truth for the data).
- `backend/app/tests/test_samples.py` — self-check that each generated workbook carries its labeled problems.
- `sample-data/README.md` — append a section per domain: columns, demo prompt, per-row "carries" table.

**Out of scope (deferred)**
- Paired `main.xlsx` workbooks for the new domains — these three are single-workbook (inspect + quality rules + Tool #1/#2/#3 formula). Tool #4 standardize / Tool #5 match stay demonstrated by the existing customers pair only.
- Oversized (25 MB / 50k-row) and non-`.xlsx` (`.xls`, `.xlsm`, password-protected) rejection fixtures — those test API intake limits, not the generator. Add a separate rejection-fixture set later if wanted.
- `expected-result.xlsx` / semantic cell assertions — same deferral as the §16.3 spec.

## 2. Why these three domains

Each has a natural new-column request that maps to a *different* Tool #3 formula category, and a column set that naturally carries a distinct problem mix — so the three together broaden coverage rather than repeat the customers case.

| Domain | File | Demo prompt → new header | Tool #3 flavor |
|---|---|---|---|
| Finance | `finance.xlsx` | "Add a Total column = Quantity × UnitPrice × (1 + TaxRate), rounded to 2 decimals" → `Total` | arithmetic (`ROUND`, `*`, `+`) |
| HR | `hr.xlsx` | "Add a DisplayName column: last name uppercased, comma, first name" → `DisplayName` | text (`UPPER`, `CONCAT`/`&`, `TRIM`) |
| Inventory | `inventory.xlsx` | "Add a Reorder column: Yes when StockQty is below ReorderPoint" → `Reorder` | logic (`IF`, comparison) |

All three prompts stay inside the `playtest.py` `ALLOWED_FUNCTIONS` allowlist.

## 3. `finance.xlsx` — sheet `Invoices`

Columns: `InvoiceID, Date, Customer, Quantity, UnitPrice, TaxRate, Notes, Memo`

| Row | Carries |
|---|---|
| F1 | baseline clean row |
| F2 | exact duplicate of F1 |
| F3 | `UnitPrice` as thousands-separated text `"1,200.50"` |
| F4 | `UnitPrice` as currency text `"$5.50"`; `TaxRate` as percent text `"7%"` |
| F5 | `UnitPrice` as negative-paren text `"(3.00)"`; `TaxRate` blank |
| F6 | `Notes` holds literal `=WEBSERVICE("http://x")` (formula-as-data / injection edge) |
| F7 | interior completely-blank row |

Column-level: `UnitPrice` → **type_mismatch** (float vs several text encodings). `TaxRate` → mixed `0.07` / `"7%"` / blank. `Memo` → **blank_column** (empty every data row). `Notes` → mostly blank, one injection string.

## 4. `hr.xlsx` — sheet `Employees`

Columns: `EmpID, FirstName, LastName, Department, HireDate, Salary, FullTime`

| Row | Carries |
|---|---|
| H1 | baseline clean row |
| H2 | exact duplicate of H1 |
| H3 | `FirstName` leading/trailing whitespace `"  jane "`; `LastName` casing `"SMITH"` |
| H4 | unicode name `José` / `Núñez` |
| H5 | non-latin name `李` / `雷` |
| H6 | `Salary` as `"N/A"` (type_mismatch driver) |
| H7 | `HireDate` invalid `2023-13-45`; `Salary` blank |
| H8 | interior completely-blank row |

Column-level: `Salary` → **type_mismatch** (ints + `"N/A"` + blank). `HireDate` → mixed `YYYY-MM-DD` / `DD/MM/YYYY` + one invalid. `FullTime` → **boolean-like** spread `TRUE` / `Yes` / `1` / `N`.

## 5. `inventory.xlsx` — sheet `Products`

Columns: `SKU, ProductName, StockQty, ReorderPoint, Price, Discontinued`

| Row | Carries |
|---|---|
| I1 | `SKU` leading-zero text `"00045"`, baseline |
| I2 | exact duplicate of I1 (duplicate SKU) |
| I3 | `SKU` as number `9001` (identifier type_mismatch); `StockQty` text `"12"` |
| I4 | `StockQty` blank |
| I5 | `StockQty` negative `-5` |
| I6 | `StockQty` huge `1_000_000_000`; `Price` currency text `"$9.99"` |
| I7 | `ProductName` injection string `=cmd|' /c calc'!A1` |
| I8 | interior completely-blank row |

Column-level: `SKU` → **type_mismatch** (text identifiers + one int). `StockQty` → blanks + negative + text + huge. `Price` → mixed float / currency text. `Discontinued` → **blank_column**.

## 6. Generator structure (`backend/scripts/make_samples.py`)

Mirrors `make_fixtures.py`: a module-level constant per domain (headers + a `ROWS` list of tuples, each row commented with its F#/H#/I# label as in `CURRENT_ROWS`), plus a `SAMPLES` registry list where each entry is a small dict:

```python
{"filename": "finance.xlsx", "sheet": "Invoices", "headers": [...], "rows": [...],
 "prompt": "...", "output_header": "Total", "carries": [...]}  # carries: human labels for README/tests
```

- `_build(headers, rows, sheet_title)` — same 8-line helper as `make_fixtures.py` (duplicated, keeps the script self-contained; no cross-import of a private helper).
- **Injection / formula-as-data cells must be stored as text, not formulas.** openpyxl treats a string starting with `=` as a formula. The generator sets those cells so the leading `=` survives as a literal string (write the value, then overwrite `cell.data_type = "s"`, or use the documented openpyxl escape). The test asserts the stored value is the literal string and `data_type == "s"`.
- `write_samples(out_dir) -> list[Path]` — writes all three, returns paths.
- `main()` — writes into `sample-data/` and prints paths.
- Run: `cd backend && python -m scripts.make_samples`.

## 7. Self-check (`backend/app/tests/test_samples.py`)

Mirrors `test_fixtures.py`: generate into `tmp_path`, reopen each workbook, assert its labeled conditions — not generator internals. Minimum assertions:

- **finance:** F1==F2 (duplicate); exactly one all-`None` row; `Memo` all `None`; `UnitPrice` column contains both a float and text encodings; the `=WEBSERVICE(...)` cell is stored as a literal string (`data_type == "s"`, value starts with `=`).
- **hr:** H1==H2; one blank row; `Salary` set includes an int and `"N/A"`; `FullTime` set ⊇ `{TRUE, "Yes", 1, "N"}`; a `HireDate` value fails both known date formats; unicode + non-latin names present.
- **inventory:** I1==I2; one blank row; `SKU` column has both leading-zero text and an int; `StockQty` has a blank, a negative, and the huge value; `Discontinued` all `None`; `ProductName` injection cell stored as literal string.

Optionally (not required) a smoke assertion that each domain's `prompt`'s needed functions ⊆ `ALLOWED_FUNCTIONS`.

## 8. README

Append a top-level section to `sample-data/README.md` ("## Varied-domain samples") noting these are fake data generated by `make_samples.py`, then one subsection per file with its columns, demo prompt, and the per-row "carries" table from §3–§5 above. This doubles as the live-demo script (`playtest.py --input sample-data/<file>.xlsx --prompt "..." --header <header>`) and the regression contract.
