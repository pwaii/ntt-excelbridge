# Multi-input pipeline — design

**Date:** 2026-10-22
**Status:** Approved (brainstorming); ready for implementation plan.

## Goal

Let a single job process **up to 8 input workbooks** (slots `input`, `input_2`…`input_8`)
through the real reviewed workflow (`backend/app/lambda_handlers.py`), each inspected,
quality-checked, and transformed **independently**, behind **one combined** pair of human
review gates. The legacy pass-through `demo_pipeline.py` is removed.

Today every handler is hardwired to one workbook (`files["input"]`, single artifact keys,
single `ISSUE#`/`PROPOSAL#` children, single `artifacts["output"]`). This design threads a
**slot dimension** through every per-input handler and fans the work out in the state machine.

## Decisions (from brainstorming)

- **Semantics:** process each input independently (not merged, not fan-in-only).
- **Review gates:** one combined quality gate and one combined transformation gate, with
  issues/proposals grouped by filename. One state machine per job.
- **Target:** the real pipeline (`lambda_handlers.py`). `demo_pipeline.py` is deleted.
- **No-ARN path:** assume the Step Functions state machine exists. With no ARN configured,
  job-start returns `503` (no synchronous fallback).
- **Main handling (update/both):** all inputs merge **sequentially into one shared main**
  (slot order), not N divergent copies.
- **Download:** N artifact entries (`output`, `output_2`…), not a zip.
- **Max inputs:** 8 (existing `schemas.py` `max_length=8` / slot regex `input_[2-8]`).
- **Approach:** slot-parameterized handlers + a `Map` fan-out in the ASL (not an internal
  loop per handler — that would break the bounded-worker invariant and the per-invocation
  25 MB / 50k-row caps).

## Output policy → outputs

| Policy | Outputs | Detail |
|---|---|---|
| `neither` | **N** | N current workbooks (quality fixes + requested column) |
| `standardize_only` | **N** | N standardized current workbooks |
| `update_only` | **1** | merged main; currents are update sources only, discarded |
| `both` | **N + 1** | N standardized currents **+** 1 merged main |

`both` = `standardize_only`'s N outputs **plus** `update_only`'s 1 output. The standardized
currents are both emitted *and* fed into the merge. (This intentionally diverges from today's
single-input `both`, which emits only the main.)

## 1. Slot dimension & namespacing

Each per-input handler gains a `slot` (default `input` for back-compat) and derives everything
from it:

- **Source bytes:** `files[slot]["key"]`.
- **Per-input sheet / header_row / key_column:** read from `workbook_selections[slot]`
  (`WorkbookSelection` already carries `sheet_name`, `header_row`, `key_column`,
  `workbook_version`) — **not** global `config`. Global `config` keeps only the shared
  transformation intent: `comment_name`, `output_header`, `standardize`, `update`,
  `conflict_policy`.
- **Artifacts:** child items `ARTIFACT#<slot>#inspection`, `ARTIFACT#<slot>#quality` (see §4).
- **Issues / proposals:** `ISSUE#<slot>#<id>`, `PROPOSAL#<slot>#<id>`, each carrying a `slot`
  field for grouping. `all_children(..., "ISSUE#")` still returns them all.

**Assumption:** the N inputs are schema-compatible — same `output_header` target and, for
update, the same `key_column` present in each. A file missing the key column fails *its*
segment and is reported in the combined gate; it does not abort the others.

`SaveWorkbookConfiguration.selections` widens from `Literal["input","main"]` to also accept
`input_2`…`input_8`.

## 2. State machine topology (assumed ASL)

```
INSPECTING
  └─ Map over input slots ──┬─ inspect(slot)
                            └─ quality(slot)        → ISSUE#<slot>#…
  └─ Join → QUALITY_REVIEW_PENDING                  ← ONE combined gate
  └─ Map over input slots ──┬─ bedrock(slot, tool1/2/3)
                            └─ bedrock(slot, tool4/5 if standardize/update)
  └─ Join → TRANSFORMATION_REVIEW_PENDING           ← ONE combined gate
  └─ apply   (Choice on policy → Map and/or reduce, see §3)
  └─ Map over outputs ── validate(output_slot)
  └─ COMPLETED
```

- Gates stay single: each `Map` is followed by a `Join` that flips the job to one
  `*_REVIEW_PENDING` status. `state_machine.py` `ORDER` is unchanged — parallelism lives
  *within* a status, not in new statuses.
- Review resume is unchanged in shape: a gate submission ends one execution and starts the
  next segment (`reviews.py` → `workflow.start_segment`); the decisions dict now spans all
  slots and each downstream `apply`/segment filters to its own slot.

## 3. `apply` — Map + reduce, chosen by policy

A `Choice` on the output policy picks which path(s) run.

### Map path (outputs the current workbook): `neither`, `standardize_only`, and `both`

`apply_slot(slot)` — one invocation per input slot, run as a `Map`:

- Reads `files[slot]`; filters to `ISSUE#<slot>#…` / `PROPOSAL#<slot>#…` and that slot's
  decisions.
- Calls `apply_accepted_changes(source_slot, …, standardization_mappings = mappings if
  standardize else [], formula = formula_slot)` (scoped to the slot).
- Emits its own output: slot `input` → `artifacts["output"]`, `input_2` → `output_2`, …,
  plus a slot-scoped change-report.

### Reduce path (outputs the single main): `update_only`, `both`

`apply_main_reduce()` — one invocation looping slots in order, carrying cross-file conflict
state:

```
main_bytes = main_source
seen_destinations = set()
for slot in ordered_input_slots:                 # input, input_2, …
    current = apply_accepted_changes(source_slot, standardize=True, formula=None) \
              if policy == "both" else source_slot
    main_bytes, audit_slot, seen_destinations = apply_accepted_updates(
        main_bytes, current, matches_slot, decisions_slot,
        key_column=…, conflict_policy=…,
        prior_destinations=seen_destinations,      # ← cross-file conflict guard
    )
output = apply_workbook_changes(main_bytes, formula=output_formula) if formula else main_bytes
```

Emits a single `artifacts["output_main"]`.

### Cross-file conflict handling (the reason for `prior_destinations`)

`apply_accepted_updates` today scopes conflict detection (`destination_groups`,
`used_destinations`) to a **single call** = one input file. The sequential merge chains N
separate calls, so two files targeting the same main row currently resolve as **silent
last-file-wins** — `conflict_policy` never sees it.

Fix: add a `prior_destinations: set[tuple[str,int]]` parameter (default empty = today's
behavior). Each file seeds it with the destinations every earlier file wrote; a later file
hitting one is a genuine cross-file conflict resolved by the same `conflict_policy`
(`reject_all` → skipped + audited `"cross-file conflict"`, `latest_wins` → overwrite, `merge`
→ fill only blanks). The call returns the updated set so the reduce accumulates. Sequential-
with-shared-state is kept (not one combined call) because `current_row_id` is `Sheet!row` and
two files whose sheet is both `Customers` would collide on row IDs.

### Audit & validation

Each output carries its own `change-report.json` + `validation.json` (namespaced by output
slot). One job-level `review-summary.md` aggregates counts across all outputs with a per-file
breakdown. The final `Map` runs `validate(output_slot)` over however many outputs exist
(N for the Map path, 1 for `update_only`, N+1 for `both`).

## 4. Concurrency: per-input artifacts as child items

The `Map` runs N `inspect(slot)` + `quality(slot)` in parallel. Today each writes the job
**META** item (`item["artifacts"]` via CAS on `revision`) — N parallel writers = a
`RevisionConflictError` storm.

Fix (single-table design):

- `inspect(slot)` / `quality(slot)` write **child items** (`ARTIFACT#<slot>#…`,
  `ISSUE#<slot>#…`) at distinct SKs under one `PK=JOB#<id>` — contention-free unconditional
  `put_child`, no CAS retries. They do **not** touch `item["artifacts"]`.
- The **join** step is the only CAS'd META write in a fan-out: it flips the single status to
  the gate. Exactly one writer at the join; the existing transition guard suffices.
- META `artifacts` holds only final job-level outputs (`output`, `output_2`…, `output_main`,
  `audit`, `review_summary`, `validation`), written by `apply`/`validate` / the terminal join.
- `review_report`/`all_children` already globs children by SK prefix, so `ARTIFACT#`,
  `ISSUE#`, `PROPOSAL#` come back and are grouped by their `slot` field.

## 5. Review, download, API, frontend

- **Combined gate (`reviews.py` / `review_report`):** payload built from all children grouped
  by `slot`/filename. `submit_review` takes one decisions dict keyed by slot-namespaced IDs;
  `validate_decisions` checks each submitted ID exists; one `REVIEW#` artifact stores combined
  decisions; `workflow.start_segment` resumes. No new gate statuses.
- **Download (`download_artifact`):** META `artifacts` now holds `output`, `output_2`…,
  `output_main`, each with its own `audit`/`validation`. The result screen enumerates
  `output*` entries → one download button per file.
- **Frontend:** create flow already multi-selects inputs (Pilotxl); the two review workspaces
  group issues/proposals by filename; `ResultWorkspace` lists N (or N+1) downloads.
- **Config/schema:** `SaveWorkbookConfiguration.selections` widens to `input_2`…`input_8`;
  per-slot sheet/header/key from each `WorkbookSelection`.

## Testing

- Handlers are plain functions → integration test drives `inspect/quality/bedrock/apply/
  validate` with `slot` events directly (no Step Functions). A multi-input `playtest` variant
  proves the reduce + cross-file conflict end-to-end against the `sample-data/multi/` fixtures.
- Unit test `apply_accepted_updates(prior_destinations=…)` for the cross-file conflict matrix
  (`reject_all` / `latest_wins` / `merge`).
- Existing single-input tests must still pass with `slot` defaulting to `input`.

## Out of scope / assumed

- Authoring the `Map`-based ASL (`infra/statemachine.asl.json`) and its deployment are
  assumed. The code deliverable is handlers + stores + API + frontend.
- `demo_pipeline.py` and its test are deleted; the no-ARN job-start path returns `503`.
- Raising the 8-input cap, zip packaging, and N+1 for `update_only` are explicitly not done.
