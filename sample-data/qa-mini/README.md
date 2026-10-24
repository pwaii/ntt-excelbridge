# QA mini fixtures

Reduced-row versions of `sample-data/qa/` for fast smoke tests (~40–80 data rows each).
Same stress rows; fewer normal rows.
Regenerate with `cd backend` then `.venv312/python.exe -m scripts.make_qa_mini_fixtures`.

Scenarios, prompts, and expected proposals are identical to `sample-data/qa/README.md`.
Row numbers below are Excel data rows (header excluded).

## Feature coverage at a glance

| Scenario | Feature | Prompt | Config |
|---|---|---|---|
| Retail orders | **Add computed column** (formula) | "Add a Line Total column = Qty x UnitPrice x (1 - DiscountPct)" | `{"output_header":"Line Total","standardize":false,"update":false}` |
| HR employees | **Standardize only** (map messy values → canonical) | "Add a Normalized Department column" | `{"standardize":true,"update":false}` |
| Inventory shipments | **Update only** (patch master from inputs by key) | "Update on-hand quantities in the master catalog" | `{"update":true,"key_column":"PartNo","conflict_policy":"reject_all"}` |
| Clinic visits | **Standardize + Update** (both gates) | "Normalize the insurance provider and update the patient registry" | `{"standardize":true,"update":true,"key_column":"MRN"}` |

---

## Retail orders — Add computed column

Upload: `retail/orders_online.xlsx`, `retail/orders_store.xlsx`. No main workbook.

Tool3 proposes `=Qty*UnitPrice*(1-DiscountPct)`. Structural errors (duplicate OrderID, blank row, bad date, bad Qty) are flagged before the model runs. Formula and injection values in Notes are inert data.

| File | Data rows | Stress rows |
|---|---:|---|
| `retail/orders_online.xlsx` | 50 | — clean source |
| `retail/orders_store.xlsx` | 60 | 51–53 known answers (20.00, 10.20, 89.991); 54–55 duplicate OrderID; 56 blank; 57 bad date; 58 Qty="two"; 59 HYPERLINK note; 60 prompt injection |

---

## HR employees — Standardize only

Upload: `hr/employees_corporate.xlsx`, `hr/employees_field.xlsx`. Main: `hr/hr_master.xlsx`.

Tool4 maps dirty department variants (Eng, ENGINEERING, sales dept, …) to canonical values from `hr_master.xlsx`. Ambiguous and unmapped values queue for human selection; no canonical value is invented.

| File | Data rows | Stress rows |
|---|---:|---|
| `hr/employees_corporate.xlsx` | 50 | — clean; header row is 3 (exercises header detection) |
| `hr/employees_field.xlsx` | 48 | 41 "Service" ambiguous; 42 "R&D" unmapped; 43 SQL injection value; 44–45 duplicate EmpID; 46 blank; 47 bad date; 48 control row |
| `hr/hr_master.xlsx` | 30 | canonical departments (Engineering, Sales, Finance, …) and statuses |

---

## Inventory shipments — Update only

Upload: `inventory/shipment_north.xlsx`, `inventory/shipment_south.xlsx`, `inventory/shipment_west.xlsx`. Main: `inventory/catalog.xlsx`.

Tool5 patches `OnHand` in the catalog by `PartNo` key. Conflicts are rejected; unmatched keys are skipped; only backend-supplied candidate IDs are used.

| File | Data rows | Stress rows |
|---|---:|---|
| `inventory/shipment_north.xlsx` | 50 | — clean |
| `inventory/shipment_south.xlsx` | 50 | — clean |
| `inventory/shipment_west.xlsx` | 45* | 41–42 P-00777 conflict; 43 blank PartNo + "Universal Filter Assembly" ambiguity; 44 P-99999 unmatched; 45 OnHand="n/a"; (+blank trailing row) |
| `inventory/catalog.xlsx` | 80 | rows 42–43 repeat "Universal Filter Assembly" (catalog-side ambiguity) |

\* Trailing all-None blank row written but excluded from openpyxl `max_row`.

---

## Clinic visits — Standardize + Update

Upload: `clinic/visits_north.xlsx`, `clinic/visits_south.xlsx`, `clinic/visits_east.xlsx`, `clinic/visits_west.xlsx`. Main: `clinic/registry.xlsx`.

Tool4 standardization gate runs first (BCBS, Blue Cross, UHC → canonical spelling), then Tool5 update gate patches the registry by `MRN`. Ambiguous providers queue for human selection; conflicting MRN updates are rejected.

| File | Data rows | Stress rows |
|---|---:|---|
| `clinic/visits_north.xlsx` | 50 | — clean |
| `clinic/visits_south.xlsx` | 50 | — clean |
| `clinic/visits_east.xlsx` | 50 | — clean |
| `clinic/visits_west.xlsx` | 47 | 41 "United" ambiguous; 42 SelfPay unmapped; 43 blank MRN; 44–45 MRN-00777 conflict; 46 bad date; 47 prompt injection |
| `clinic/registry.xlsx` | 60 | rows 41–42 repeat "Taylor Morgan" (registry-side ambiguity) |
