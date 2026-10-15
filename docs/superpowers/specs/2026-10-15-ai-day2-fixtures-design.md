# AI Engineer — Day 2 Sample Workbook Fixtures

**Date:** 2026-10-15
**Scope:** The remaining Day-2 deliverable from `docs/ai-plan.md` / `design.md` §16.3 — the sample `current.xlsx` + `main.xlsx` workbook fixtures. The Bedrock Converse client and Tool #1 adapter (the other two Day-2 items) are already done and tested (`test_ai_day2.py`).

**Source of truth:** `design.md` §16.3 (the 12 required conditions) and the §18 RACI — *"AI publishes versioned schemas and fixtures."* Fixtures are AI-owned.

---

## 1. Goal & scope

Produce a realistic, intentionally-messy pair of workbooks that exercise every data-quality / standardization / update-matching case the pipeline must handle, so Tool adapters, the rule engine, and (later) the full E2E run all have a shared, documented input.

**In scope**
- `sample-data/current.xlsx` — the messy incoming workbook.
- `sample-data/main.xlsx` — the canonical master to reconcile against.
- `backend/scripts/make_fixtures.py` — the generator (source of truth for the data).
- `sample-data/README.md` — manifest mapping each row/column to its §16.3 condition.
- `backend/app/tests/test_fixtures.py` — self-check that the generated workbooks satisfy all 12 conditions.

**Out of scope (deferred, per scope decision)**
- `sample-data/expected-result.xlsx` and the semantic cell-assertion harness — these depend on Tools #2–#5 and the `apply_changes` / `validate_output` workers, which do not exist yet.
- Any inspection-manifest loader that turns the fixture into bounded Tool samples — BE owns inspection; Tool tests currently use inline dicts.

## 2. Domain

Customer records being reconciled against a canonical customer master. Chosen because it naturally carries every §16.3 case: a `CustomerID` key (leading zeros + update matching), `Country` (standardization), `SignupDate` (date-format mess), and `Quantity`/`UnitPrice` (a sensible formula-based new column).

## 3. `current.xlsx` — sheet `Customers`

Columns (left to right):

| Column | Type stored | Role / condition |
|---|---|---|
| `CustomerID` | **text** | identifier with **leading zeros** (`"000100"`) — must be stored as text so zeros survive |
| `FullName` | text | match / ambiguity driver |
| `Country` | text | **standardization** source (non-canonical + one **unmapped** value) |
| `SignupDate` | **text** | **date column**, stored as strings so format variants + invalid value are preserved verbatim |
| `Active` | text | **boolean-like**: `Y` / `Yes` / `N` / `No` / blank |
| `Quantity` | number | numeric — feeds the formula-based new column |
| `UnitPrice` | number | numeric — feeds the formula-based new column |
| `Notes` | — | **completely blank column** (header only, all cells empty) |

> All date and ID values are stored as **text strings**, not Excel date/number types. The messy-input cases (two date formats, one invalid date, leading zeros) only exist if the raw strings are preserved — detecting and normalizing them is the pipeline's job, not Excel's.

Data rows (header is row 1):

| Row | CustomerID | FullName | Country | SignupDate | Active | Qty | UnitPrice | Condition carried |
|---|---|---|---|---|---|---|---|---|
| R1 | `000100` | Acme Corp | United States | `2023-01-15` | `Y` | 2 | 10.00 | **exact match** to main M1 |
| R2 | `000100` | Acme Corp | United States | `2023-01-15` | `Y` | 2 | 10.00 | **exact duplicate of R1** |
| R3 | `000200` | Globex LLC | `U.S.A.` | `15/02/2023` | `Yes` | 3 | 5.50 | **needs normalization** (country + `DD/MM/YYYY` date); matches M2 after normalizing |
| R4 | `000300` | Initech | United Kingdom | `2023-13-45` | `No` | 1 | 20.00 | **invalid date value** |
| R5 | `000400` | Hooli | `Wakanda` | `2023-03-01` | `N` | 4 | 2.25 | **unmapped standardization value** (no canonical for `Wakanda`); no main match |
| R6 | *(blank)* | Jane Smith | United States | `2023-04-10` | `Y` | 1 | 99.00 | **ambiguous match** — name matches both M5 and M6, no ID to disambiguate |
| R7 | `000500` | Umbrella Inc | United States | `2023-05-01` | `Yes` | 2 | 15.00 | pair that maps to the **same main row** M4 |
| R8 | `000500` | Umbrella Inc | United States | `2023-06-01` | `No` | 5 | 15.00 | second of the pair — **conflicting fields** vs R7 → conflict policy needed |
| R9 | *(blank)* | *(blank)* | *(blank)* | *(blank)* | *(blank)* | *(blank)* | *(blank)* | **completely blank row** — written **interior** (not last), so openpyxl retains it |
| R10 | `000600` | Soylent Co | United States | `2023-07-20` | *(blank)* | 3 | 8.00 | **boolean blank** case |

Condition coverage check:
- two exact duplicate rows → R1 = R2 ✓
- one completely blank row → R10 ✓
- one blank column → `Notes` ✓
- date column, two valid formats + one invalid → `2023-01-15` (ISO, R1), `15/02/2023` (`DD/MM/YYYY`, R3), `2023-13-45` (invalid, R4) ✓
- boolean-like `Y`/`Yes`/`N`/`No`/blank → R1 `Y`, R3 `Yes`, R4 `No`, R5 `N`, R9 blank ✓
- identifier with leading zeros → all `CustomerID` text `000xxx` ✓
- one row matching main exactly → R1 ↔ M1 ✓
- one row requiring normalization → R3 ✓
- one ambiguous match → R6 ✓
- one current row duplicated against the same main row → R7 + R8 → M4 ✓
- one unmapped standardization value → R5 `Wakanda` ✓
- one formula-based new-column example → `Quantity` × `UnitPrice` present in every row supports a proposed `Total` column (Tool #3) ✓

## 4. `main.xlsx` — sheet `CanonicalCustomers`

Canonical master. Key column = `CustomerID`.

| Column | Type | Notes |
|---|---|---|
| `CustomerID` | text | leading-zero key |
| `FullName` | text | |
| `Country` | text | canonical values only |

Rows:

| Row | CustomerID | FullName | Country | Role |
|---|---|---|---|---|
| M1 | `000100` | Acme Corp | United States | exact target for R1/R2 |
| M2 | `000200` | Globex LLC | United States | normalization target for R3 |
| M3 | `000300` | Initech | United Kingdom | target for R4 (except its date is invalid) |
| M4 | `000500` | Umbrella Inc | United States | the single row R7 **and** R8 both map to |
| M5 | `000700` | Jane Smith | United States | one of the ambiguous pair for R6 |
| M6 | `000701` | Jane Smith | Canada | other of the ambiguous pair for R6 |

(Note: `000400` / Hooli is intentionally absent from main — R5 has no update match, which is correct for the unmapped case.)

## 5. Generation mechanics

- **Generator:** `backend/scripts/make_fixtures.py`, using `openpyxl` (already a backend dependency). Data lives as Python literals (the two tables above). Writes both files to the repo-root `sample-data/` directory.
- **Invocation:** `cd backend && python -m scripts.make_fixtures` — same module pattern as the existing `scripts/smoke_tool1.py`.
- **Committed artifacts:** the generator script, the produced `current.xlsx` + `main.xlsx`, and `sample-data/README.md`. The script is the diffable source of truth; the committed `.xlsx` files let BE / frontend / demo consume ready files without running Python.
- **Writing rules that matter:** `CustomerID`, `SignupDate`, and `Active` cells are written as Python `str` so openpyxl stores them as text (leading zeros and raw date strings preserved). `Quantity` / `UnitPrice` written as numbers. Blank cells are left unset (not `""` where it would matter for "completely blank row/column" detection — the generator will leave them `None`). The completely blank row (R9) is written **between** populated rows, not as the last row, because openpyxl does not retain a trailing all-empty row.

## 6. Self-check — `backend/app/tests/test_fixtures.py`

The fixture *is* the deliverable, so the test verifies it matches §16.3 rather than testing generator internals. The test calls the generator into a `tmp_path`, reopens both workbooks with openpyxl, and asserts:

- `CustomerID` cells are strings and R1 is exactly `"000100"` (leading zeros preserved).
- `Notes` column is entirely empty (blank column).
- Exactly one fully blank row exists (blank row).
- R1 and R2 are identical across all data columns (exact duplicates).
- `SignupDate` contains at least two distinct valid-looking formats and at least one unparseable value.
- `Active` column contains all of `{"Y","Yes","N","No"}` and at least one blank.
- `main.xlsx` contains two rows with `FullName == "Jane Smith"` (ambiguity source) and exactly one row with `CustomerID == "000500"` while `current.xlsx` has two such rows (shared-main-row pair).
- `current.xlsx` has a `Country` value (`"Wakanda"`) absent from `main.xlsx`'s canonical set (unmapped value).

## 7. Handoff

- BE consumes these as the inspection / E2E input; the fixture's `CustomerID` key column and sheet names (`Customers`, `CanonicalCustomers`) are the contract.
- When Tools #2–#5 and the workers land, `expected-result.xlsx` + the semantic-assertion harness get built against this same input (separate spec).

## 8. Open items / risk

- **Date storage as text** is a deliberate choice to preserve the messy-input cases. If BE's inspector expects Excel-typed dates in some columns, we may later add a second date column that *is* date-typed — not needed for the §16.3 conditions, so deferred.
- The exact business names/values (`Acme`, `Wakanda`, dates) are illustrative; only the *conditions* they carry are contractual.
