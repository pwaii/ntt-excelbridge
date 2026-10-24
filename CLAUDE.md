# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Implementation complete.** `backend/`, `frontend/`, and `infra/` all exist. AI Tools 1–5, three Step Functions segments, Cognito auth, multi-input workbook support (up to 8 slots), and all human review gates are implemented and tested. The active branch is `frontend`. Backend: `cd backend && python -m pytest`; Frontend: `cd frontend && npm test`. See `README.md` for quick-start.

## What this is

A human-gated, event-driven workflow that takes an XLSX workbook plus a natural-language "prompt" describing a column to add, detects data-quality problems, uses Bedrock to propose interpretations/mappings, requires explicit human approval at two gates, and emits a new workbook + JSON audit + review summary. Stack: React/Vite, FastAPI on Lambda, OpenPyXL, Step Functions Standard, S3, DynamoDB, Bedrock, Cognito. AWS-only.

## Architecture big picture

The spine is a **Step Functions Standard** state machine (`infra/statemachine.asl.json`) that walks a job through the states in plan §6 (`DRAFT` → … → `COMPLETED`/`FAILED`). The state machine holds only S3 pointers, hashes, IDs, and small review metadata — **never workbook bytes, row arrays, or prompts** (those live in S3). Human approval gates are execution boundaries: a segment ends at a pending review status, and the winning review submission starts the next short execution. There are no task tokens or paused executions.

Three cooperating layers, split across `backend/app/`:

- **API (`api/`, `main.py`, `auth.py`)** — FastAPI on Lambda behind API Gateway HTTP API with a Cognito JWT authorizer. Does job CRUD, presigned S3 URLs, status, review decisions, download URLs. Never processes workbooks synchronously; never receives workbook bytes (browser uploads directly to S3 via presigned URL).
- **Workers (`workers/`)** — one bounded, idempotent Lambda per responsibility: `inspect_workbook`, `quality_rules`, `apply_changes`, `validate_output`. OpenPyXL runs here, always writing to a **new** S3 object.
- **AI (`ai/`)** — `bedrock_client.py` (Converse API) plus `tool1_semantics` … `tool5_update`. Each tool returns JSON validated against a Pydantic schema in `domain/schemas.py`.

State/config/decisions persist in a **single DynamoDB table** (`xlsx-workflow`, single-table design, plan §7.6) keyed `PK=JOB#<id>` / `SK=META|ISSUE#|PROPOSAL#|REVIEW#|EVENT#`. Every state transition is a **conditional update on `revision`** so a stale browser gets `409 REVIEW_REVISION_CONFLICT` instead of clobbering newer decisions.

The **rule engine (`workers/quality_rules.py`)** is the source of truth for structural errors (duplicates, blank rows/columns, type mismatches) and runs **before any LLM call**. Bedrock only supplements interpretation. Human gates are execution boundaries: a segment ends at a pending review status, and the winning review submission starts the next short execution. There are no task tokens or paused executions.

## Non-negotiable invariants

These are the point of the project — do not relax them for convenience:

1. **LLM output is an untrusted proposal, never executed.** No LLM-generated Python runs. Every tool response is validated against a Pydantic schema + allowlists; unknown row IDs / headers / canonical values are rejected. Models may only *select* from candidate IDs supplied in the prompt, never invent them.
2. **Two mandatory human review gates** (data-quality, transformation). Nothing mutates data until a gate is submitted — no auto-apply path, even at high confidence. `ambiguous` proposals require explicit human selection.
3. **Source workbooks are immutable.** Always write output to a new S3 object; reopen and reconcile (`validate_output`) before marking `COMPLETED`.
4. **Formulas are allowlisted** (plan §10.4 / §6 State 8): must start with `=`, functions on allowlist, references in-range, no external links / macros / `INDIRECT` / `OFFSET` / `WEBSERVICE` / `HYPERLINK` / volatile functions. Labeled "syntax verified," not "calculated" — OpenPyXL does not evaluate formulas.
5. **Data minimization in prompts and logs.** Send bounded samples + IDs + type summaries, never whole workbooks. Log hashes/IDs/counts/redacted samples only — never raw cell values, prompts with sensitive data, or full model responses.
6. **USD 350 hard cap.** Enforce token/sample/candidate/row caps, cache by input hash, honor a `COST_GUARD_REACHED` stop state. No NAT Gateway, provisioned throughput, always-on compute, or Marketplace models.

## Constraints

- `.xlsx` only (reject `.xls`, `.xlsm`, password-protected). ~~One input + optional one main workbook~~ **Up to 8 input workbooks (slots `input`, `input_2`…`input_8`) + optional one main workbook** (Pilotxl redesign); one sheet each. Header row within first 20 rows. Demo limits: 25 MB / 50k rows — reject over-limit rather than time out.
- AWS regions limited to `us-east-1` (default), `ap-southeast-1`, `ap-southeast-7` — one region per deployed environment, selected at deploy time.
- Bedrock model must be verified non-Marketplace; resolve the exact model/inference-profile ID at deploy via the preflight script, do not hardcode.
- Jobs are idempotent by input hash (uploaded object version + config); workers check for an existing artifact with the same hash before writing.
