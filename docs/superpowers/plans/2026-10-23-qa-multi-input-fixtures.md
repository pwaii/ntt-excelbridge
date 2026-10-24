# QA Multi-Input Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-source QA scenarios with realistic jobs containing two, two, three, and four current workbooks respectively.

**Architecture:** Split each current-workbook dataset into deterministic channel or regional exports while retaining one master workbook for standardize and update policies. Add an explicit scenario manifest to the generator so the test suite and README share the current-input group sizes without relying on file-name conventions.

**Tech Stack:** Python 3.12, openpyxl, pytest, Ruff.

---

### Task 1: Add multi-input scenarios and generated source exports

**Files:**
- Modify: `backend/scripts/make_qa_fixtures.py`
- Generate: `sample-data/qa/**/*.xlsx`

- [x] **Step 1: Define the explicit current-input manifest**

Add `SCENARIO_CURRENT_INPUTS`:

```python
SCENARIO_CURRENT_INPUTS = {
    "retail": ("retail/orders_online.xlsx", "retail/orders_store.xlsx"),
    "hr": ("hr/employees_corporate.xlsx", "hr/employees_field.xlsx"),
    "inventory": ("inventory/shipment_north.xlsx", "inventory/shipment_south.xlsx", "inventory/shipment_west.xlsx"),
    "clinic": ("clinic/visits_north.xlsx", "clinic/visits_south.xlsx", "clinic/visits_east.xlsx", "clinic/visits_west.xlsx"),
}
```

- [x] **Step 2: Replace source fixture specs**

Replace the old current-file entries with 11 files: two 600-row retail sources, two
300-row HR sources, three 300-row shipments, and four 250-row visits. Keep the HR,
catalog, and registry masters unchanged.

- [x] **Step 3: Split bulk rows and place every stress case in the final source file**

Make online retail, corporate HR, north/south inventory, and north/south/east clinic
exports clean. Keep stress cases in store retail, field HR, west shipment, and west
visits. Preserve current total row counts and deterministic `_save_workbook` output.

- [x] **Step 4: Generate all fixtures**

Run:

```powershell
cd backend
..\.venv312\python.exe -m scripts.make_qa_fixtures
```

Expected: 14 workbooks are written: 11 current sources and three masters.

### Task 2: Update test coverage and the README matrix

**Files:**
- Modify: `backend/app/tests/test_qa_fixtures.py`
- Modify: `sample-data/qa/README.md`

- [x] **Step 1: Assert source-set sizes and paths**

Add the four expected tuples above to `test_qa_fixtures.py`. Assert equality with
`SCENARIO_CURRENT_INPUTS`, and assert every tuple length is in `range(2, 5)`.

- [x] **Step 2: Move stress-marker assertions**

Use rows 592–601 for `orders_store.xlsx`, rows 294–301 for
`employees_field.xlsx`, rows 296–301 for `shipment_west.xlsx`, and rows 245–251 for
`visits_west.xlsx`. Retain catalog and registry ambiguity markers.

- [x] **Step 3: Document upload sets**

Update each domain matrix with a `job input set` column, list the main workbook
separately, and name the 2/2/3/4 input counts. Give clean source files an empty stress
entry and document stress cases on the final source export.

### Task 3: Verify deterministic, aligned deliverables

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-qa-sample-fixtures-design.md`
- Verify: generator, README, test, and all generated workbooks

- [x] **Step 1: Check spec path and count alignment**

Verify the spec names the same 14 files, source counts, policies, configuration, and
stress locations as the generator and README.

- [x] **Step 2: Run fixture tests and lint**

Run:

```powershell
cd backend
..\.venv312\python.exe -m pytest app/tests/test_qa_fixtures.py -q --basetemp ..\.tmp-pytest -p no:cacheprovider
..\.venv312\python.exe -m ruff check scripts/make_qa_fixtures.py app/tests/test_qa_fixtures.py
```

Expected: all tests pass and Ruff reports no findings.

- [x] **Step 3: Verify repeatable outputs and commit**

Generate twice, compare SHA-256 hashes for all 14 workbooks, then commit the spec,
plan, generator, test, README, and generated files with:

```bash
git commit -m "feat: make QA fixtures multi-input scenarios"
```
