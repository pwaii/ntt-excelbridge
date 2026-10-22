# Handoff: running the multi-input pipeline with real S3 + DynamoDB

This branch (`feat/multi-input-pipeline`) makes a job process **up to 8 input
workbooks** (slots `input`, `input_2`…`input_8`) plus one optional `main`, through
the real reviewed pipeline with two human gates. The backend is complete and tested
(157 passing). This doc is what you need to run it against live AWS.

Design/plan background: `docs/superpowers/specs/2026-10-22-multi-input-pipeline-design.md`
and `docs/superpowers/plans/2026-10-22-multi-input-pipeline.md`.

## 1. No Step Functions required

When `STATE_MACHINE_ARN` is empty (the default), the API drives the pipeline
**in-process** via `app/workers/orchestrator.py`, stopping at each human gate. You do
**not** need to build or deploy an ASL. The three segments:

| Segment | Runs | Model? | Ends at |
|---|---|---|---|
| 1 | inspect + quality for every input slot | no | `QUALITY_REVIEW_PENDING` |
| 2 | Bedrock tools (tool1–5) per slot | **yes** | `TRANSFORMATION_REVIEW_PENDING` |
| 3 | apply + validate | no | `COMPLETED` |

## 2. Infrastructure to provision

- **S3 bucket** → set `APP_DATA_BUCKET`. Objects live under `s3_prefix` (default `jobs`).
  Versioning recommended (source workbooks are treated as immutable).
- **DynamoDB table** named `xlsx-workflow` (override with `DYNAMO_TABLE`), single-table:
  `PK=JOB#<id>`, `SK=META|ISSUE#…|PROPOSAL#…|REVIEW#…|EVENT#…`. Every state transition
  is a **conditional update on `revision`**, so the table must support condition
  expressions (any standard on-demand table does).
- **AWS credentials** with Bedrock access in **`us-east-1`**. Bedrock uses the bare Nova
  model ids `amazon.nova-lite-v1:0` and `amazon.nova-pro-v1:0` (see `app/settings.py`).
  Inference-profile ids are known to hit an org SCP deny — use the bare ids.
- Leave `STATE_MACHINE_ARN` **unset**.

### Environment (`.env` at repo root, or deployment env)

```
AWS_REGION=us-east-1
AWS_PROFILE=<your-sso-or-iam-profile>     # or standard AWS_ACCESS_KEY_* vars
APP_DATA_BUCKET=<your-bucket>
DYNAMO_TABLE=xlsx-workflow
# STATE_MACHINE_ARN intentionally empty -> in-process orchestrator
```

Auth: the API sits behind a Cognito JWT authorizer (`COGNITO_USER_POOL_ID`,
`COGNITO_APP_CLIENT_ID`). For a local smoke test you can override the auth dependency
the way the tests do (`app.dependency_overrides[current_user_id]`).

## 3. Run sequence (drive via API — there is no frontend yet)

1. `POST /v1/jobs` with `{"config": {...}, "input_filenames": [...≤8...], "main_filename": "main.xlsx"}`
   (`main_filename` only when `standardize` or `update` is on).
2. Upload each slot — presigned PUT (preferred) or `POST /v1/jobs/{id}/uploads/file/{slot}`.
3. For each uploaded slot: `GET /v1/jobs/{id}/workbooks/{slot}/metadata`, then one
   `PUT /v1/jobs/{id}/configuration` with a `selections` entry for **every** input slot
   (and `main` when required). Keys accepted: `input`, `input_2`…`input_8`, `main`.
4. `POST /v1/jobs/{id}/start` → segment 1 → `QUALITY_REVIEW_PENDING`.
5. `GET /v1/jobs/{id}/review-report?stage=quality` → decide, `POST /v1/jobs/{id}/reviews`
   → segment 2 (Bedrock) → `TRANSFORMATION_REVIEW_PENDING`.
6. `GET /v1/jobs/{id}/review-report?stage=transformation` → decide, `POST .../reviews`
   → segment 3 → `COMPLETED`.
7. Download outputs via `GET /v1/jobs/{id}/artifacts/{name}`:
   - `neither` / `standardize_only` → `output`, `output_2`, … (one current workbook per input)
   - `update_only` → `output` (the merged main)
   - `both` → `output` (merged main) + `output_current`, `output_current_2`, … (standardized currents)

The full artifact list is in the job record's `artifacts` map
(`GET /v1/jobs/{id}`), so a client can enumerate every `output*` key.

### Review decision keys (important)

The combined gate presents items from all slots, grouped by filename. Decision keys for
the **primary** `input` slot are the bare issue/proposal id; keys for **secondary** slots
are **slot-qualified**: `input_2::<id>`. Submit decisions with exactly those ids (the
review-report response gives you each row's `id` and `slot`/`filename`).

## 4. Known limitations (all commented in code)

- **Segment 2 is the only path not run against real infra in this branch.** The Bedrock
  tools were verified live single-input via `backend/scripts/playtest.py`; the per-slot
  orchestration loop is unit-tested structurally. Watch segment 2 on your first real run.
- **Only the primary `output` is re-validated** by `validate_output`; the extra
  `output_2…` / `output_current_*` workbooks are written but not reconciled.
- **Secondary inputs share the primary's sheet/header/key** from global config; per-slot
  selections are stored in `workbook_selections` but processing reads the shared values.
- **Same-sheet-named inputs** are handled: issue ids are slot-qualified so they don't
  collide, and cross-file update conflicts (two inputs writing the same main row) are
  resolved by `conflict_policy` (`reject_all` default / `latest_wins` / `merge`).

## 5. Quick local confidence check

```
cd backend
../.venv/Scripts/python.exe -m pytest -q          # 157 passing, no AWS needed

# Real Bedrock, single input, no S3/Dynamo (proves the tools + apply + validate):
AWS_PROFILE=<profile> AWS_REGION=us-east-1 \
  ../.venv/Scripts/python.exe -m scripts.playtest \
  --prompt "Total price: Quantity times UnitPrice" --header Total --key CustomerID
```

Sample multi-input fixtures to exercise the `both` policy live in
`sample-data/fourfile/` — `region1.xlsx`…`region4.xlsx` (the four input slots) plus
`main.xlsx`. Generator: `backend/scripts/make_multi_fixtures.py` (adjust its `OUT_DIR`
if you regenerate).
