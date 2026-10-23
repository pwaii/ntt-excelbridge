# AI and pipeline QA bugs

QA run: 2026-10-23. Fixture corpus: `sample-data/qa`.

## AI-001 — Single malformed values bypass type-mismatch detection

- **Severity:** High
- **Status:** Fixed — `quality_rules.py` now flags any value whose type is incompatible with the dominant type's group (int/decimal/percentage share a "number" group), so an isolated poison value is caught. Regex-valid-but-invalid dates (e.g. `2024-13-45`) still pass as `date` — semantic date-range validation is out of scope here.
- **Area:** deterministic quality gate before Tool 2 / Bedrock
- **Reproduction:** Run `inspect_bytes()` followed by `run_quality_rules()` for the checked-in QA workbooks.
- **Expected:** The malformed values documented in `sample-data/qa/README.md` are structural cases that should be flagged before model use. In particular: `orders_store.xlsx` has `Qty="two"` and `OrderDate="2024-13-45"`; `employees_field.xlsx` has a malformed `StartDate`; `shipment_west.xlsx` has `OnHand="n/a"`; and `visits_west.xlsx` has a malformed `VisitDate`.
- **Actual:** No `type_mismatch` issue is emitted for any of those columns. For example, the inspected retail manifest reports `Qty: {"int": 598, "text": 1}`, but its quality report contains only `blank_row` and `duplicate_rows`.
- **Root cause:** `backend/app/workers/quality_rules.py` only emits `type_mismatch` when the minority type exceeds 20% of populated values. A single poisoned/invalid value in the 300–600-row QA exports is therefore suppressed.
- **Impact:** Tool 2 is not invoked for isolated malformed values, so they cannot reach the review gate for normalization or rejection. This contradicts the QA fixture contract and leaves common spreadsheet corruption unreviewed.
- **Suggested fix:** Emit a row-level invalid-value finding for every value incompatible with a strongly dominant inferred type (with a low-volume/noise policy that is explicit), rather than using the aggregate 20% threshold as the sole gate. Add regression coverage for the four QA examples above.

## AI-002 — Review-gate regression test expects a decision for a no-op Tool 2 rule

- **Severity:** Medium (test-suite correctness)
- **Status:** Fixed — fixture rule changed to a mutating normalization (`"2.0"` → `"2"`) so `build_report()` no longer skips it; the 422 gate-completeness assertion now reproduces a genuinely incomplete decision set.
- **Area:** `backend/app/tests/test_frontend_review_integration.py::test_gate_requires_complete_decisions_and_ignore_reasons`
- **Reproduction:** `python -m pytest -q --basetemp <writable-dir> -p no:cacheprovider` from `backend`.
- **Expected:** The suite should pass, or the fixture should create a genuine normalization proposal that needs a decision.
- **Actual:** 172 tests pass and this one fails because the API returns 200 where the test expects 422.
- **Cause:** The fixture adds Tool 2 rule `example_original="2"`, `normalized_form="2"`. `build_report()` deliberately skips no-op normalization rules, so the submitted Tool 1 decision set is complete. The test's premise is false; it does not reproduce an incomplete decision set.
- **Suggested fix:** Change the fixture to a mutating rule (for example, `"2.0"` to `"2"`) and retain the 422 assertion. This preserves the intended gate-completeness coverage.

## Live Bedrock execution blockers — resolved

Both blockers from the 2026-10-23 run are resolved. `ChallengerAccess-453995432289` is now present and authenticated; `.venv312\python.exe` is used throughout.

---

QA run: 2026-10-24. Full live Bedrock run against all four QA fixture sets using `scripts/eval_tools.py` + `scripts/playtest.py`.

## AI-003 — eval_tools T5 fixture missing `candidate_main_row_ids` per row

- **Severity:** Medium (eval harness only)
- **Status:** Fixed — `T5["current_rows"]` now carries `candidate_main_row_ids` per row (`c1→["m1"]`, `c2→["m2","m3"]`, `c3→[]`), matching real `build_tool5_inputs` output.
- **Area:** `backend/scripts/eval_tools.py` — `T5` fixture constant
- **Reproduction:** `AWS_PROFILE=ChallengerAccess-453995432289 AWS_REGION=us-east-1 ..\.venv312\python.exe -m scripts.eval_tools` — last line of output is `tool5_update: PARSE FAIL Tool #5 returned candidates not supplied for c1`.
- **Expected:** Tool #5 eval passes: the model selects `m1` for `c1` (exact email match), marks `c2` ambiguous (`m2`/`m3`), and leaves `c3` unmatched.
- **Actual:** `_validate_against_inputs` raises `ValueError` because `candidate_map["c1"]` is an empty set (no `candidate_main_row_ids` in the fixture's current row), but the model's response includes `candidate_main_row_ids: ["m1"]`.
- **Root cause:** The `T5` fixture in `eval_tools.py` uses simplified current-row dicts (`{"current_row_id": "c1", "fields": {...}}`) without the `candidate_main_row_ids` key that `_validate_against_inputs` expects from real `build_tool5_inputs` output.
- **Suggested fix:** Update `T5["current_rows"]` to match the real format — add `"candidate_main_row_ids": ["m1"]` to c1, `["m2", "m3"]` to c2, and `[]` to c3.

## AI-004 — Tool #5 truncated at 2048 max_tokens for large unresolved sets

- **Severity:** High
- **Status:** Fixed — `run_tool5` now pages unresolved rows `max_tool5_rows` (25) at a time, each page using `bedrock_max_tokens_tool5` (8192), and merges + guardrails the combined matches. Audit meta sums tokens/latency across pages. Single-page (small) inputs keep identical hashes/tokens.
- **Area:** `backend/app/settings.py` (`bedrock_max_tokens = 2048`), `backend/app/ai/tool5_update.py` `run_tool5`
- **Reproduction:** Run `scripts/playtest.py` with the HR fixture: 300 rows, 0 exact matches → "300 unresolved, 30 candidates" → `Tool #5 REJECTED/failed: ValidationError: 1 validation error for Tool5Output matches Field required`.
- **Expected:** Tool #5 returns match decisions for all (or a batched subset of) unresolved rows.
- **Actual:** 300-row output requires ~60–90k output tokens; the 2048 cap truncates the JSON mid-array. `_extract_json` finds the first complete dict inside the partial response (a single match object) and returns it. `Tool5Output(**data)` then fails because a bare match dict has no `matches` key.
- **Root cause:** `run_tool5` sends all unresolved rows to the model with no cap. `max_candidate_matches=5` limits candidates per row but not total rows. `bedrock_max_tokens=2048` is far too low for batch row output.
- **Impact:** Any scenario where key-column normalization leaves many unresolved rows (e.g. HR field employees with no pre-existing EmpID in master) silently loses all Tool #5 matching.
- **Suggested fix:** Either (a) raise `bedrock_max_tokens` to ≥8192 for Tool #5, or (b) add a `MAX_TOOL5_ROWS` cap in `run_tool5` and page unresolved rows across multiple calls if the set exceeds it.

## AI-005 — Tool #3 generates doubled `{row}` placeholder (inventory scenario)

- **Severity:** High (formula verifier blocks it; pipeline degrades gracefully)
- **Status:** Fixed — `_normalize_formula_references` collapses any run of `{row}` tokens to a single `{row}` before validation, and the v1 prompt now states "use `{row}` exactly once per cell reference."
- **Area:** Model output from `run_tool3` for update-mode prompts; `backend/app/ai/tool3_formulas.py`
- **Reproduction:** Run playtest with `inventory/shipment_west.xlsx` and prompt "Update on-hand quantities in the master catalog". Tool #3 returns `=IFERROR(C{row}{row} + 1, C{row}{row})`.
- **Expected:** A valid formula template using `{row}` exactly once per cell reference.
- **Actual:** The model emits `C{row}{row}` — two back-to-back `{row}` tokens. After substitution (e.g. row=10) this becomes `C1010`, which is outside the data range. The formula verifier in `apply_changes` correctly rejects it (`cell reference C1010 is outside the selected range`) and the pipeline retries without a formula.
- **Root cause:** The prompt gives the model full latitude to craft the template. For an update-mode prompt ("update on-hand quantities") the model guesses at an increment formula and makes a template error.
- **Impact:** No data corruption (verifier catches it), but the formula column is silently dropped. The user sees a blank column instead of the expected update values.
- **Confirmed systematic:** All five clean files that triggered a Tool #3 call for an update/standardize prompt produced the same doubled-placeholder pattern — inventory north (`=IFERROR(IF(ISNUMBER(C{row}{row}), C{row}{row}, "N/A"), "N/A")`), inventory south (same with 0), clinic north/south/east (`=TRIM(UPPER(IFERROR(CONCAT("Normalized ", C{row}{row}), "")))`). Every instance was rejected by the formula verifier.
- **Suggested fix:** Tighten the Tool #3 prompt to require exactly one `{row}` per cell reference and/or add a post-parse regex check on the template before the formula verifier runs.

## AI-006 — Tool #3 applies wrong formula for standardize/update scenarios

- **Severity:** Medium
- **Status:** Fixed (playtest) — playtest now skips Tool #3 entirely when a main workbook is present (standardize/update intent), matching its documented "neither policy only" scope. The deployed pipeline is unaffected and correct: it already drops the formula for `update`/`both`, and `standardize_only` intentionally keeps a formula column (asserted by `test_upload_configuration_both_review_gates_and_download_all_modes`).
- **Area:** `backend/scripts/playtest.py` pipeline order; `backend/app/ai/tool3_formulas.py`
- **Reproduction:**
  - HR: prompt "Add a Normalized Department column" → Tool #3 returns `=TRIM(UPPER(C{row}))` — uppercasing is not the same as mapping to a canonical department name.
  - Clinic: prompt "Normalize the insurance provider" → Tool #3 returns `=IFERROR(CONCAT(UPPER(TRIM(C{row})), " - ", LOWER(TRIM(B{row}))), "Normalization Failed")` — this concatenates the provider with the patient name, which is nonsensical.
- **Expected:** For `standardize=true` scenarios, the output column should reflect canonical values resolved by Tool #4, not a formula transformation.
- **Actual:** Tool #3 always runs and its formula is always applied if the verifier accepts it. The clinic formula passes verification and writes 250 wrong formula cells to the output workbook.
- **Root cause:** The playtest (and the pipeline in general) does not skip Tool #3 when `output_policy=standardize` or `output_policy=update`. Tool #3's prompt has no awareness of whether a canonical lookup was already performed.
- **Impact:** For standardize/update jobs, the output workbook contains a formula column with semantically wrong values. This is a correctness failure visible to the end user.
- **Suggested fix:** Gate Tool #3 on `output_policy == "formula"` (or equivalent). For standardize/update jobs, the new column should be populated by applying Tool #4 mappings directly, not by a formula.

## AI-007 — Quality rules do not flag blank key-column values in otherwise-filled rows

- **Severity:** Medium
- **Status:** Fixed — added a `blank_key_field` rule: a non-blank row whose first column (heuristic key) is blank is flagged for manual review. Marked as a shortcut until the worker receives the configured `key_column`.
- **Area:** `backend/app/workers/quality_rules.py` — `blank_row` rule
- **Reproduction:** `run_quality_rules` on `inventory/shipment_west.xlsx` (row 298: blank `PartNo`, non-blank `Description`/`OnHand`/`Location`) and `clinic/visits_west.xlsx` (row 247: blank `MRN`, non-blank other fields). In both cases, quality rules report 0 issues for those rows.
- **Expected:** Rows where a key-identifying column (e.g. `PartNo`, `MRN`) is blank while other fields are populated should be flagged. These rows cannot be matched or updated and reaching Tool #5 just marks them `unmatched`.
- **Actual:** The `blank_row` rule fires only when `all(normalize_text(cell) == "" for cell in row)` — entirely blank rows. Rows with a blank key field but other data pass through silently.
- **Root cause:** The quality rules treat "blank row" as all cells empty. There is no "blank key field" rule.
- **Impact:** Partially-filled rows with blank keys flow into Tool #5, which correctly returns `unmatched` for them, but the user sees no explanation in the quality report about why those rows were skipped.
- **Suggested fix:** After header detection, add a rule: if a row has data in at least one non-key column but its inferred key column is blank, emit a `blank_key_field` issue. This requires knowing the key column, which the worker does not receive today — either pass it as config or emit a best-effort heuristic (e.g. first column).

## AI-008 — Tool #4 invents abbreviated canonical values not in the candidate list

- **Severity:** Medium (guardrail blocks it every time; pipeline falls back correctly)
- **Status:** Fixed — (1) playtest now scopes `source_values` to columns shared with the main workbook (mirrors the deployed `_tool_inputs`), so numeric quantity columns no longer pollute the candidate match; (2) the v1 prompt now instructs the model to copy `canonical_value` character-for-character. The deployed pipeline already scoped source values to shared fields and was not affected by the playtest root cause.
- **Area:** `backend/app/ai/tool4_standardize.py`; `backend/app/prompts/tool4_standardize.v1.md`
- **Reproduction:** Run playtest with any file that has a main workbook — observed on every scenario: HR corporate → model proposes `'HR'` instead of `'Human Resources'`; inventory north/south/west → model proposes `'11'` (a quantity value) as a canonical mapping target.
- **Expected:** The model selects canonical values verbatim from the `canonical_candidates` list only.
- **Actual:** The model returns abbreviated or numerically-invented `canonical_value` strings (`'HR'`, `'11'`) that are not in the provided candidates. The validator in `_validate_against_inputs` raises `ValueError: canonical_value 'HR' not in candidates`, blocking the proposal.
- **Root cause (playtest):** The playtest collects source values from ALL columns (`source_values = sorted({str(v) for c in columns for v in c.get("samples", []) ...})`), including numeric quantity columns. When these are matched against a canonical list of part numbers or department names, the model attempts spurious mappings and abbreviates.
- **Root cause (model):** Even in the correct case (one column, proper candidates), the model sometimes abbreviates canonical names rather than copying them verbatim. The prompt instructs "select from candidate IDs supplied" but does not explicitly state "copy the canonical value exactly as given."
- **Impact:** Tool #4 is rejected for every run where this occurs. No standardization is applied even for clearly correct mappings in the same call.
- **Suggested fix:** (1) Narrow the `source_values` in playtest to the target column's samples only rather than all columns. (2) Add explicit prompt instruction: "Copy the canonical_value string character-for-character from the list; do not abbreviate or paraphrase."

## AI-009 — playtest `load_canonical_rows` ignores detected header_row for Tool #5

- **Severity:** Low (playtest only; results in silent skip, not data corruption)
- **Status:** Fixed — playtest reads `header_row` from `manifest["sheets"][0]` (and inspects the main workbook for its own header row) and passes both to every `load_canonical_rows` call for Tool #4 and Tool #5.
- **Area:** `backend/scripts/playtest.py` — Tool #5 section
- **Reproduction:** Run playtest on `hr/employees_corporate.xlsx` (header row 3) with `--key EmpID`. Output: `Tool #5 skipped: key 'EmpID' not found in current headers`.
- **Expected:** Tool #5 reads the file using the same `header_row` that `inspect_bytes` detected (row 3) and finds `EmpID`.
- **Actual:** The Tool #5 section calls `load_canonical_rows(source)` without the `header_row` argument, so it defaults to row 1. Row 1 of `employees_corporate.xlsx` contains title text, not the column headers. The returned dicts have no `EmpID` key and Tool #5 is silently skipped.
- **Root cause:** `inspect_bytes` detects `header_row` per sheet and stores it in the manifest, but the playtest's `load_canonical_rows` calls at the bottom of `main()` don't pass it through.
- **Impact:** For any clean or stress run on the HR corporate file, Tool #5 is never exercised. For this specific scenario (standardize-only, no update), skipping is actually the correct outcome — but for the wrong reason, and this would silently break any update scenario with a non-row-1 header.
- **Suggested fix:** Read `header_row` from the `manifest["sheets"][0]` result and pass it to every `load_canonical_rows` call in playtest.
