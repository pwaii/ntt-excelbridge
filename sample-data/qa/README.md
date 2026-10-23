# QA sample fixtures

Synthetic workbooks for upload, pipeline, model-quality, and review-gate testing.
Regenerate them with `cd backend && python -m scripts.make_qa_fixtures` (use the
project virtual environment if `python` is not configured). The generator is
`backend/scripts/make_qa_fixtures.py`; it fixes all row positions below.

Each stated row is an Excel row number, including the header and the two intro rows
in `hr/employees.xlsx`. All values are invented for testing.

## Retail orders: add column

| File | Data rows | Prompt | Config (JSON) | Stress rows (Excel row -> case -> expected) | Expected per-tool proposal |
|---|---:|---|---|---|---|
| `retail/orders.xlsx` | 1,200 | Add a Line Total column = Qty x UnitPrice x (1 - DiscountPct) | `{"output_header":"Line Total","standardize":false,"update":false}` | 1192–1194 -> known answers -> 20.00, 10.20, 89.991; 1195–1196 -> duplicate `OrderID`; 1197 -> blank row; 1198 -> bad date; 1199 -> `Qty="two"`; 1200 -> HYPERLINK formula in Notes; 1201 -> prompt injection in Notes | Tool1 identifies Qty, UnitPrice, DiscountPct. Tool3 proposes the allowlisted row formula `=Qty*UnitPrice*(1-DiscountPct)`; structural rows are flagged before model use. |

The known answers are `(2, 10.00, 0)`, `(3, 4.25, 0.20)`, and `(1, 99.99,
0.10)`. OpenPyXL does not calculate formulas, so this fixture only verifies the
syntax and expected arithmetic for Excel or human confirmation. Notes values are
inert input data for the workflow.

## HR employees: standardize

Canonical master: `hr/hr_master.xlsx`. Its Department values are Engineering, Sales,
Finance, Human Resources, Marketing, Operations, Legal, and Support; its Status
values are Active, Inactive, and On Leave.

| File | Data rows | Prompt | Config (JSON) | Stress rows (Excel row -> case -> expected) | Expected per-tool proposal |
|---|---:|---|---|---|---|
| `hr/employees.xlsx` | 600 | Add a Normalized Department column | `{"standardize":true,"update":false}` | Header at row 3; 596 -> `Service` -> ambiguous; 597 -> `R&D` -> unmapped; 598 -> SQL-like value -> unmapped/rejected; 599–600 -> duplicate `EmpID`; 601 -> blank row; 602 -> bad StartDate; 603 -> valid control row | Tool4 may map safe department variants only to master canonical values. `Service` requires human selection; `R&D` and the injection string cannot invent a canonical value. |
| `hr/hr_master.xlsx` | 30 | Canonical source for employees | `{"standardize":true,"update":false}` | Canonical Department and Status coverage | Supplies the canonical allowlist. |

## Inventory parts: update

Master: `inventory/catalog.xlsx`; key column: `PartNo`.

| File | Data rows | Prompt | Config (JSON) | Stress rows (Excel row -> case -> expected) | Expected per-tool proposal |
|---|---:|---|---|---|---|
| `inventory/shipment.xlsx` | 900 | Update on-hand quantities in the master catalog | `{"update":true,"key_column":"PartNo","conflict_policy":"reject_all"}` | 896–897 -> `P-00777` conflicting updates -> rejected; 898 -> blank PartNo + duplicate catalog description -> ambiguous; 899 -> `P-99999` -> skipped; 900 -> `OnHand="n/a"`; 901 -> blank row | Tool5 may select only supplied catalog row IDs. Exact keys update; duplicate-key conflict is rejected; blank key queues human choice; unmatched key is skipped. |
| `inventory/catalog.xlsx` | 1,500 | Canonical update target | `{"update":true,"key_column":"PartNo","conflict_policy":"reject_all"}` | 43–44 -> repeated `Universal Filter Assembly` descriptions -> two candidates | Provides unique canonical PartNo values and the intentional description ambiguity. |

## Clinic visits: standardize and update

Master: `clinic/registry.xlsx`; key column: `MRN`. Canonical providers are Blue
Cross Blue Shield, UnitedHealthcare, Aetna, Cigna, and Medicare.

| File | Data rows | Prompt | Config (JSON) | Stress rows (Excel row -> case -> expected) | Expected per-tool proposal |
|---|---:|---|---|---|---|
| `clinic/visits.xlsx` | 1,000 | Normalize the insurance provider and update the patient registry | `{"standardize":true,"update":true,"key_column":"MRN"}` | 995 -> `United` -> ambiguous; 996 -> `SelfPay` -> unmapped; 997 -> blank MRN + duplicate patient name -> ambiguous; 998–999 -> duplicate MRN conflict; 1000 -> bad VisitDate; 1001 -> prompt injection in Notes | Tool4 produces a standardization gate before Tool5. Safe provider variants map to registry values; exact MRNs update; conflicts are rejected; blank MRN queues selection. |
| `clinic/registry.xlsx` | 800 | Canonical update target | `{"standardize":true,"update":true,"key_column":"MRN"}` | 42–43 -> `Taylor Morgan` duplicate names -> matching ambiguity | Supplies canonical provider values and candidate registry IDs. |

## Pipeline expectations

Structural rules run before any LLM request: duplicate rows/keys, blank rows, type
mismatches, and malformed dates must be surfaced for review. Tool4 returns only
canonical values already present in the matching master workbook; ambiguous proposals
need a human decision, and unknown values remain unmapped or rejected. Tool5 can only
select backend-provided candidate IDs. Rows without a matching update key are skipped;
inserting new master rows is deferred.
