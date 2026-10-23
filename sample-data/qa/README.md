# QA sample fixtures

Synthetic, deterministic XLSX files for testing realistic multi-file uploads.
Regenerate with `cd backend` then `..\.venv312\python.exe -m scripts.make_qa_fixtures`.
Each job uploads every listed current file together; its main workbook is selected
separately. All stated row numbers are Excel rows, including headers.

## Retail orders — two current exports

Upload set: `retail/orders_online.xlsx`, `retail/orders_store.xlsx`. No main workbook.

| File | Data rows | Prompt | Config (JSON) | Stress rows | Expected proposal |
|---|---:|---|---|---|---|
| `retail/orders_online.xlsx` | 600 | Add a Line Total column = Qty x UnitPrice x (1 - DiscountPct) | `{"output_header":"Line Total","standardize":false,"update":false}` | — | Clean online-channel source for Tool1 and Tool3. |
| `retail/orders_store.xlsx` | 600 | Same job input | Same config | 592–594 known answers: 20.00, 10.20, 89.991; 595–596 duplicate OrderID; 597 blank row; 598 bad date; 599 `Qty="two"`; 600 HYPERLINK-like Notes; 601 prompt injection Notes | Tool3 proposes `=Qty*UnitPrice*(1-DiscountPct)`. Decimals remain intact; structural cases are flagged before model use; Notes are inert data. |

OpenPyXL verifies formula syntax but does not calculate it. The three expected numbers
require Excel or human arithmetic confirmation.

## HR employees — two current exports plus canonical master

Upload set: `hr/employees_corporate.xlsx`, `hr/employees_field.xlsx`. Main workbook:
`hr/hr_master.xlsx`.

| File | Data rows | Prompt | Config (JSON) | Stress rows | Expected proposal |
|---|---:|---|---|---|---|
| `hr/employees_corporate.xlsx` | 300 | Add a Normalized Department column | `{"standardize":true,"update":false}` | Header row is 3 | Clean corporate source; exercises header detection. |
| `hr/employees_field.xlsx` | 300 | Same job input | Same config | 294 `Service` ambiguous; 295 `R&D` unmapped; 296 SQL-like value rejected; 297–298 duplicate EmpID; 299 blank row; 300 bad StartDate; 301 control row | Tool4 maps safe variants only to master canonical values; no canonical value is invented. |
| `hr/hr_master.xlsx` | 30 | Canonical source | Same config | Canonical Departments and Statuses | Provides Engineering, Sales, Finance, Human Resources, Marketing, Operations, Legal, Support; and Active, Inactive, On Leave. |

## Inventory parts — three shipment exports plus catalog

Upload set: `inventory/shipment_north.xlsx`, `inventory/shipment_south.xlsx`,
`inventory/shipment_west.xlsx`. Main workbook: `inventory/catalog.xlsx`.

| File | Data rows | Prompt | Config (JSON) | Stress rows | Expected proposal |
|---|---:|---|---|---|---|
| `inventory/shipment_north.xlsx` | 300 | Update on-hand quantities in the master catalog | `{"update":true,"key_column":"PartNo","conflict_policy":"reject_all"}` | — | Clean northern warehouse export. |
| `inventory/shipment_south.xlsx` | 300 | Same job input | Same config | — | Clean southern warehouse export. |
| `inventory/shipment_west.xlsx` | 300 | Same job input | Same config | 296–297 conflicting `P-00777`; 298 blank PartNo + repeated description; 299 `P-99999` skipped; 300 `OnHand="n/a"`; 301 blank row | Tool5 updates exact keys, rejects conflict, queues ambiguity, skips unmatched key, and selects only supplied catalog IDs. |
| `inventory/catalog.xlsx` | 1,500 | Canonical update target | Same config | 43–44 repeat `Universal Filter Assembly` | Provides unique PartNo values and the intentional matching ambiguity. |

## Clinic visits — four regional exports plus registry

Upload set: `clinic/visits_north.xlsx`, `clinic/visits_south.xlsx`,
`clinic/visits_east.xlsx`, `clinic/visits_west.xlsx`. Main workbook:
`clinic/registry.xlsx`.

| File | Data rows | Prompt | Config (JSON) | Stress rows | Expected proposal |
|---|---:|---|---|---|---|
| `clinic/visits_north.xlsx` | 250 | Normalize the insurance provider and update the patient registry | `{"standardize":true,"update":true,"key_column":"MRN"}` | — | Clean regional source. |
| `clinic/visits_south.xlsx` | 250 | Same job input | Same config | — | Clean regional source. |
| `clinic/visits_east.xlsx` | 250 | Same job input | Same config | — | Clean regional source. |
| `clinic/visits_west.xlsx` | 250 | Same job input | Same config | 245 `United` ambiguous; 246 `SelfPay` unmapped; 247 blank MRN + duplicate name; 248–249 duplicate MRN conflict; 250 bad VisitDate; 251 Notes injection | Tool4 standardization gate runs before Tool5 update gate. Exact MRNs update; ambiguous rows queue human selection; conflicts reject. |
| `clinic/registry.xlsx` | 800 | Canonical update target | Same config | 42–43 repeat `Taylor Morgan` | Supplies canonical provider spellings and candidate registry IDs. |

Structural checks run before any LLM call. Tool4 maps only to canonical values that
exist in the main workbook; Tool5 can only choose backend-provided candidate IDs.
Unmatched update rows are skipped rather than inserted. All fixtures contain invented
data only.
