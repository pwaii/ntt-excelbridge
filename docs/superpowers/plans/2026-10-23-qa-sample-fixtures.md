# QA Sample Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate deterministic, upload-ready XLSX fixtures across retail, HR, inventory, and clinic domains, with a README test matrix and a self-check that locks down their structure and stress cases.

**Architecture:** Add one flat generator at `backend/scripts/make_qa_fixtures.py`, reusing `_build` from `scripts.make_fixtures` and writing all workbook content from fixed inline pools and documented row placements. Add a pytest self-check under `backend/app/tests` that regenerates into `tmp_path`, then opens every workbook and verifies sheet headers, row counts, and stress markers. Document prompts, configurations, expected behavior, and Excel-only formula checks in `sample-data/qa/README.md`.

**Tech Stack:** Python 3.12, openpyxl, pytest (all already used by the backend).

---

## File map

- Create: `backend/scripts/make_qa_fixtures.py` — deterministic workbook data and generator functions; `main()` writes to `sample-data/qa/`.
- Create: `backend/app/tests/test_qa_fixtures.py` — generates into a temporary directory and validates every fixture's expected layout and stress rows.
- Create: `sample-data/qa/README.md` — per-domain matrix with workbook paths, data row counts, prompt/config, stress Excel row numbers, and expected proposal behavior.
- Generate: `sample-data/qa/**/*.xlsx` — 7 workbooks: retail orders; HR employees and master; inventory shipment and catalog; clinic visits and registry.

Run commands from `backend/`; pytest config sets `pythonpath = ["."]` and `testpaths = ["app/tests"]`. Use `python -m scripts.make_qa_fixtures` to generate committed sample workbooks.

## Conventions and fixed locations

- `sample-data/qa/` is the sole output root. Generator functions accept an output directory, so tests never modify checked-in fixtures.
- Fixture sizes below are data rows, excluding headers and any introductory rows. Excel row number is `header_row + data_row_index`, with the first data row indexed 1.
- Fixed stress cases must land on the exact rows listed in the README and in the test expectations. Bulk rows use deterministic arithmetic/cycles or a local `random.Random(seed)`; do not use process-global random state.
- Use header row 1 everywhere except `hr/employees.xlsx`, whose two intro rows place headers on row 3.
- Main/master workbooks contain the canonical values and identifiers needed by their matching fixture. Do not add noncanonical department/status/provider values to masters.
- Keep formulas out of generated values: Tool3 proposals are syntax-verified and Excel/human inspection confirms the known-answer results.

### Task 1: Build deterministic QA fixture generator

**Files:**
- Create: `backend/scripts/make_qa_fixtures.py`

- [x] **Step 1: Add reusable fixed-data helpers and retail generator**

Import `random`, `Path`, `Workbook` only if needed, and `_build` from `scripts.make_fixtures`. Define `REPO_ROOT`, `OUT_DIR`, and a helper that writes an ordered mapping of relative paths to `(headers, rows, sheet_title)` via `_build(...).save(...)`. Generate 1,200 data rows in `retail/orders.xlsx`, with nine bulk rows followed by fixed stress cases padded by bulk rows before/after as needed. Use a local seed for plausible SKU, quantity, decimal price, discount, and 2024 date values. Document these Excel data-row positions (header row 1): known answers at 1191–1193, duplicate OrderID at 1194–1195, blank row 1196, invalid date 1197, `Qty="two"` 1198, HYPERLINK note 1199, prompt-injection note 1200. Known answers are `(2,10.00,0)`, `(3,4.25,0.2)`, `(1,99.99,0.1)` with expected totals `20.00`, `10.20`, `89.991` (Excel display may round by cell format; formula result is unrounded).

- [x] **Step 2: Add HR employees and canonical master generation**

Write 600 employee data rows to `hr/employees.xlsx`, with two intro rows, headers on Excel row 3, and stress records at Excel rows 596–603: ambiguous `Service`, unmapped `R&D`, SQL-like injection department, duplicate EmpID, blank interior row, invalid date. The remaining rows cycle through safe department and status variants from the spec using a deterministic local seed. Write 30 canonical rows to `hr/hr_master.xlsx` whose Department values cover exactly Engineering, Sales, Finance, Human Resources, Marketing, Operations, Legal, Support and whose Status values cover Active, Inactive, On Leave. Use first data rows to provide those canonical combinations; fill remaining rows with deterministic valid combinations.

- [x] **Step 3: Add inventory shipment and catalog generation**

Write 900 shipment data rows to `inventory/shipment.xlsx` and 1,500 master rows to `inventory/catalog.xlsx`. Use unique catalog keys `P-00001` through `P-01500`; shipment clean rows reference existing keys. Reserve shipment data rows 895–900 for two rows with one duplicated PartNo and conflicting OnHand values, one blank-PartNo row whose Description matches two catalog records, one absent key `P-99999`, one `OnHand="n/a"`, and one completely blank interior row. Give the two candidate master rows identical descriptions and distinct PartNo values so ambiguity is deterministic.

- [x] **Step 4: Add clinic visits and registry generation**

Write 1,000 visit rows to `clinic/visits.xlsx` and 800 registry rows to `clinic/registry.xlsx`. Keep registry MRNs unique and provider names canonical (`Blue Cross Blue Shield`, `UnitedHealthcare`, `Aetna`, `Cigna`, `Medicare`); include two patients with the same name for blank-MRN ambiguity. Reserve visit data rows 994–1000 for provider `United`, provider `SelfPay`, blank-MRN duplicate-name visit, two rows with a duplicate MRN conflict, invalid VisitDate, and prompt-injection Notes. Use canonical matching MRNs in normal visits. Cycle safe provider variants (`BCBS`, `Blue Cross`, `UHC`, `aetna`, and canonical values) through the clean bulk rows.

- [x] **Step 5: Add generator entry point and verify generated paths**

Expose `write_fixtures(out_dir: Path) -> list[Path]` and `main()`. `write_fixtures` creates parent directories and returns every workbook path in stable order. Run `cd backend; python -m scripts.make_qa_fixtures` and confirm exactly the ten expected `.xlsx` paths are created under `sample-data/qa/`.

- [x] **Step 6: Commit generator and generated workbooks**

```bash
git add backend/scripts/make_qa_fixtures.py sample-data/qa
git commit -m "feat: add deterministic QA workbook fixtures"
```

### Task 2: Document QA test matrix

**Files:**
- Create: `sample-data/qa/README.md`

- [x] **Step 1: Write the complete domain matrix**

Document each scenario using tables with columns `file | data rows | prompt | config (JSON) | stress rows (Excel row → case → expected) | expected per-tool proposal`. Include the exact prompts and config values from `docs/superpowers/specs/2026-10-23-qa-sample-fixtures-design.md`, including `output_header`, `key_column`, `conflict_policy`, and standardize/update booleans. For each domain, identify master workbook paths and canonical values. State that Excel rows include headers/intros and row numbers are fixed by the generator.

- [x] **Step 2: Record expected behavior and limitations**

Explain Tool1/Tool3 for retail; Tool4 canonical-only mappings and ambiguous/unmapped rows; Tool5 candidate-ID-only matching, duplicate conflict policy, and skipped unmatched keys; structural quality checks before LLM calls. Include the three retail known-answer inputs and formula expectations, clarify that openpyxl does not calculate formulas, and note that unmatched update rows are skipped rather than inserted. Mark all values as synthetic.

- [x] **Step 3: Commit README**

```bash
git add sample-data/qa/README.md
git commit -m "docs: add QA fixture test matrix"
```

### Task 3: Add fixture self-check

**Files:**
- Create: `backend/app/tests/test_qa_fixtures.py`

- [x] **Step 1: Write the structural and stress marker test**

Create one parameterized test over the generator's returned fixture paths. Generate to `tmp_path / "qa"`. For each workbook assert `load_workbook(..., read_only=True)` succeeds, the sole sheet title matches the expected title, the expected header row exactly matches the schema, and `max_row - header_row` equals the target data row count. Assert every documented stress cell marker at its fixed Excel row (including fully blank rows, duplicate identifiers/keys, bad values, injection strings, and the HR row-3 header) and close each workbook in `finally`.

- [x] **Step 2: Run focused self-check**

Run: `cd backend; python -m pytest app/tests/test_qa_fixtures.py -q`
Expected: all fixture self-check cases pass.

- [x] **Step 3: Run formatter/lint on new Python files**

Run: `cd backend; python -m ruff check scripts/make_qa_fixtures.py app/tests/test_qa_fixtures.py`
Expected: no lint findings.

- [x] **Step 4: Commit test**

```bash
git add backend/app/tests/test_qa_fixtures.py
git commit -m "test: validate QA workbook fixture layout"
```

### Task 4: Final regeneration and verification

**Files:**
- Verify: `backend/scripts/make_qa_fixtures.py`
- Verify: `backend/app/tests/test_qa_fixtures.py`
- Verify: `sample-data/qa/README.md`
- Verify: `sample-data/qa/**/*.xlsx`

- [x] **Step 1: Regenerate committed fixture outputs**

Run `cd backend; python -m scripts.make_qa_fixtures` twice; confirm both runs complete and deterministic workbook content is unchanged (compare SHA-256 hashes from both generated runs).

- [x] **Step 2: Run focused test and lint**

Run: `cd backend; python -m pytest app/tests/test_qa_fixtures.py -q; python -m ruff check scripts/make_qa_fixtures.py app/tests/test_qa_fixtures.py`
Expected: all self-check cases pass and ruff reports no findings.

- [x] **Step 3: Review delivered files**

Confirm seven workbook files exist under the four domain folders, the README references every fixture exactly, all output sizes are below 25 MB, and generated paths match the test and README. Preserve unrelated working-tree changes.

---

## Spec coverage self-review

- Four domains and all requested policy combinations: Task 1 Steps 1–4; Task 2 Step 1.
- Fixed stress markers and deterministic generation: conventions; Task 1 Steps 1–4; Task 3.
- Canonical-only and model security invariants: HR, inventory, clinic layouts; Task 2 Step 2.
- Numeric formula examples and known limitations: Task 1 Step 1; Task 2 Step 2.
- Seven upload-ready outputs and README test matrix: File map; Tasks 1, 2, and 4.
- Self-check opens files, checks headers, row counts, and stress rows: Task 3.
