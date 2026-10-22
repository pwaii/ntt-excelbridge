# Multi-input Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process up to 8 input workbooks per job through the real reviewed workflow (`backend/app/lambda_handlers.py`), each inspected/quality-checked/transformed independently, behind one combined pair of review gates.

**Architecture:** Thread a `slot` dimension through every per-input handler (default `input`); the ASL runs a `Map` over the input slots and joins into one gate status. `apply` splits into a per-slot Map (current outputs) and a sequential reduce into one main (update/both), with cross-file conflict handling via a shared destination set. Per-input artifacts/issues/proposals become slot-namespaced DynamoDB child items so the parallel Map doesn't contend on the job META item.

**Tech Stack:** Python 3 / FastAPI / openpyxl / DynamoDB single-table / S3 / Step Functions. Spec: `docs/superpowers/specs/2026-10-22-multi-input-pipeline-design.md`.

**Execution reality:** Tasks 1–2 are pure logic / additive and are inline-testable with pytest. Tasks 3–7 are only exercised once the `Map`-based ASL exists (out of scope) and/or touch the frontend; Task 8 (delete `demo_pipeline`) breaks the only working local path and must wait for ASL deploy. Run from `backend/` with `../.venv/Scripts/python.exe -m pytest`.

---

### Task 1: Cross-file conflict guard in `apply_accepted_updates`

The sequential main merge chains N separate `apply_accepted_updates` calls, feeding each output back as `main_source`. Conflict detection today is scoped to one call, so a later file silently overwrites a row an earlier file wrote. Fix: let the caller pass the running `used_destinations` set so the existing "destination already matched" skip (line 280) fires across files.

**Files:**
- Modify: `backend/app/workers/apply_changes.py:175-203`
- Test: `backend/app/tests/test_backend_days1_4.py`

- [ ] **Step 1: Write the failing test**

```python
def test_apply_accepted_updates_prior_destinations_blocks_cross_file_overwrite():
    from openpyxl import Workbook

    def _book(title, rows):
        book = Workbook(); ws = book.active; ws.title = title
        for row in rows: ws.append(row)
        stream = BytesIO(); book.save(stream); return stream.getvalue()

    main = _book("Main", [["CustomerID", "Status"], ["A-1", "Old"]])
    file_a = _book("Current", [["CustomerID", "Status"], ["A-1", "FromA"]])
    file_b = _book("Current", [["CustomerID", "Status"], ["A-1", "FromB"]])
    match = lambda did: [{"decision_id": did, "current_row_id": "Current!2", "selected_main_row_id": "Main!2"}]
    accept = lambda did: {did: {"decision": "accept"}}

    seen = set()
    merged, _ = apply_accepted_updates(main, file_a, match("a"), accept("a"),
        key_column="CustomerID", main_sheet="Main", current_sheet="Current", prior_destinations=seen)
    merged, audit_b = apply_accepted_updates(merged, file_b, match("b"), accept("b"),
        key_column="CustomerID", main_sheet="Main", current_sheet="Current", prior_destinations=seen)

    # File A won; File B's collision was skipped, not silently applied.
    assert load_workbook(BytesIO(merged), data_only=False)["Main"]["B2"].value == "FromA"
    assert any(item["action"] == "skipped" for item in audit_b)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_backend_days1_4.py::test_apply_accepted_updates_prior_destinations_blocks_cross_file_overwrite -v`
Expected: FAIL — `apply_accepted_updates() got an unexpected keyword argument 'prior_destinations'`

- [ ] **Step 3: Add the parameter and seed `used_destinations`**

In the signature (after `conflict_policy: str = "reject_all",`):
```python
    prior_destinations: set[tuple[str, int]] | None = None,
```
Replace `used_destinations: set[tuple[str, int]] = set()` with:
```python
    used_destinations: set[tuple[str, int]] = prior_destinations if prior_destinations is not None else set()
```

- [ ] **Step 4: Run the whole apply test module to verify pass + no regression**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest app/tests/test_backend_days1_4.py -v`
Expected: PASS (new test + the two existing `apply_accepted_updates` tests unchanged)

- [ ] **Step 5: Commit**

```bash
git add backend/app/workers/apply_changes.py backend/app/tests/test_backend_days1_4.py
git commit -m "feat: cross-file conflict guard for sequential main merge"
```

---

### Task 2: Thread `slot` through the per-input handlers (additive)

Each handler reads `slot = event.get("slot", "input")` and derives `files[slot]`, slot-namespaced artifact keys (`inspection/<slot>`, `quality/<slot>`), and slot-namespaced children (`ISSUE#<slot>#…`, `PROPOSAL#<slot>#…` with a `slot` field). Default `"input"` keeps single-input behavior and all existing tests green. Per-slot sheet/header/key come from `workbook_selections[slot]` when present, else global `config`.

**Files:**
- Modify: `backend/app/lambda_handlers.py` — `inspect_handler`, `quality_handler`, `bedrock_handler`, `_tool_inputs`, `apply_handler`, `validate_handler`
- Test: `backend/app/tests/test_frontend_review_integration.py` (extend fakes with an `input_2` slot)

- [ ] **Step 1: Write a failing test** that drives `inspect_handler({"job_id": j, "slot": "input_2"})` against a fake store whose `files` has an `input_2` entry, asserting a child/artifact under `input_2` is written and `files["input"]` is untouched. (Mirror the fake-store setup already in `test_frontend_review_integration.py`.)

- [ ] **Step 2: Run to verify it fails** (`KeyError`/assertion).

- [ ] **Step 3: Implement** — in each handler replace hardcoded `item["files"]["input"]` with `item["files"][event.get("slot", "input")]`; replace `artifact_key(job_id, "inspection", …)` with `artifact_key(job_id, f"inspection/{slot}", …)` (the `/` is allowed since `artifact_key` only forbids the filename being a path); prefix child SKs with `f"{slot}#"`; read sheet/header from `item.get("workbook_selections", {}).get(slot, config)`.

- [ ] **Step 4: Run the full backend suite** — `cd backend && ../.venv/Scripts/python.exe -m pytest` — expected PASS (defaults preserve single-input).

- [ ] **Step 5: Commit** `feat: slot-parameterize pipeline handlers`.

---

### Task 3: Split `apply_handler` into Map (`apply_slot`) + reduce (`apply_main_reduce`)

- `apply_slot(slot)` runs the existing `apply_accepted_changes` branch for one slot and writes `artifacts["output" if slot=="input" else "output_"+n]`. Used for `neither`, `standardize_only`, and `both`.
- `apply_main_reduce()` loops the job's ordered input slots, carrying `seen_destinations` (Task 1), merging each (standardized, for `both`) current into the main, and writes `artifacts["output_main"]`. Used for `update_only`, `both`. Formula lands once on the final main (existing lines 465-477).

**Files:** Modify `backend/app/lambda_handlers.py:314-539`. Test: new `backend/app/tests/test_multi_input_apply.py` driving both handlers against multi-slot fakes; assert output counts per policy (`neither`→N, `standardize_only`→N, `update_only`→1 `output_main`, `both`→N+1).

Steps follow the Task-1 TDD shape (failing test → implement → full-suite green → commit `feat: map/reduce apply for multi-input`).

---

### Task 4: Widen config/selection schemas

**Files:** Modify `backend/app/domain/workbooks.py:18` — `selections: dict[Literal["input","main"], WorkbookSelection]` → allow `input_2`…`input_8`. Test: `backend/app/tests/test_schemas.py` — a selection dict with an `input_2` key validates; an `input_9` key rejects. TDD shape; commit `feat: allow input_2..input_8 workbook selections`.

---

### Task 5: Combined-gate review aggregation

**Files:** Modify `backend/app/services/review_report.py` (or `build_report`) to group issues/proposals by their `slot` field; ensure `submit_review`/`validate_decisions` (`backend/app/api/reviews.py`) accept the union of slot-namespaced IDs. Test: `test_frontend_review_integration.py` — issues from two slots appear grouped; a combined decisions dict validates and resumes. Commit `feat: combined review gate across input slots`.

---

### Task 6: Download enumerates all outputs

**Files:** Modify `backend/app/api/` download route to serve any `output*` artifact key; modify `frontend/src/components/job/result-workspace.tsx` to list one download per `output*` entry. Test: backend route test for `output_2`/`output_main`; frontend test asserting N buttons. Commit `feat: multi-output download`.

---

### Task 7: Frontend multi-input create + grouped review

**Files:** `frontend/src/components/job/` create flow (confirm Pilotxl multi-select wires `input_filenames`), `QualityReviewWorkspace`/transformation review (group by filename). Vitest coverage. Commit `feat: multi-input frontend`.

---

### Task 8: Remove `demo_pipeline` (DEPLOY-GATED — do not run until the ASL is deployed)

**Files:** Delete `backend/app/workers/demo_pipeline.py` + `backend/app/tests/test_demo_pipeline.py`; in `backend/app/api/jobs.py:279` remove the fallback so a missing state-machine ARN returns `503`. This disables the only working local execution path; only do it once `infra/statemachine.asl.json` exists and is deployed. Commit `chore: remove demo pipeline fallback`.

---

## Self-review

- **Spec coverage:** slot/namespacing → T2/T4; topology/gates → T2/T5; apply map/reduce + N/N+1 → T3; cross-file conflict → T1; concurrency child items → T2; download/API/frontend → T5/T6/T7; demo removal + no-ARN 503 → T8. ASL authoring is out of scope per spec.
- **Placeholder scan:** T1 is fully concrete; T2–T8 give exact files + the mechanical transform, not full code, because they are repetitive renames/additive edits and are gated on infra/frontend that cannot be verified inline.
- **Type consistency:** `prior_destinations: set[tuple[str,int]]`, artifact keys `output`/`output_<n>`/`output_main`, child SK prefix `<slot>#` used consistently.
