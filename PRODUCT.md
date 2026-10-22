# ExcelBridge

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are financial teams, working mainly with financial statements
in Excel. The project owner confirmed this audience on 2026-10-21.

Users need to inspect workbook data, understand proposed changes, and approve
those changes before obtaining a new output workbook. Their exact job titles,
accounting expertise, frequency of use, and organization sizes are not yet
confirmed.

## Product Purpose

Help financial teams prepare and review changes to Excel workbooks through a
traceable workflow. Users upload a current workbook, describe a requested output
column, optionally provide a trusted reference workbook, review findings and
proposals, and download the resulting workbook and supporting reports.

Successful use means that users can understand the proposed changes, make
informed decisions, and obtain output that preserves the original uploaded files.
Financial-statement suitability and accounting correctness must be established
from the user's business rules and real acceptance evidence; the application's
generic workbook pipeline does not establish them by itself.

## Product Mechanism

Deterministic workbook inspection and validation are combined with AI-generated
proposals and explicit human review gates. AI responses are proposals, not
permission to apply changes. The backend validates decisions and applies approved
changes to a separate output workbook, with review and audit artifacts.

No competitive superiority, accounting certification, customer adoption, or
measured time-saving claim has been confirmed.

## Operating Context

The implemented workflow is:

1. Sign in and create a job.
2. Select the current workbook and describe the column to add; provide its exact
   output header.
3. Optionally select standardization, update, or both and provide the main/master
   reference workbook when required.
4. Upload files, select worksheets, and explicitly confirm header rows and
   required matching keys.
5. Start processing and review data-quality findings.
6. Review transformation proposals, including formulas, standardization mappings,
   and update matches, as applicable.
7. Submit review decisions, follow processing, and download the output and
   published reports.

The frontend is an existing React/Vite/TypeScript application. Backend services
use FastAPI, OpenPyXL, and AWS services including S3, DynamoDB, Step Functions,
Lambda, Bedrock, and Cognito. The browser uses backend APIs and short-lived S3
URLs; developer AWS login and end-user Cognito login serve different purposes.

Local-development access uses a clearly labeled `local-user` identity. It is
development access, not a real Cognito login or proof of authentication readiness.

## Capabilities and Constraints

### Existing implementation

- Workbook configuration, upload, progress, quality review, transformation review,
  results, and artifact downloads are implemented frontend surfaces.
- Standardization and update are separate options, supporting four combinations.
- A main/master workbook is required when standardization or update is selected.
- Source workbooks are preserved. Update output is a new main-derived workbook;
  other output follows the selected processing policy.
- Unmatched update rows are skipped and reported rather than inserted
  automatically.
- Review choices are drafts until submitted. Bulk acceptance creates drafts and
  does not replace final review submission.
- Bulk acceptance uses confidence and eligibility rules; confidence alone does
  not establish correctness.
- Revision checks prevent stale decisions from overwriting newer job state.
- Downloads are offered according to published artifacts, not assumed availability.

### Current limits

- `.xlsx` workbooks; one current workbook and an optional main/master workbook per
  job.
- One selected worksheet per supplied workbook.
- A 25 MB workbook limit, a 50,000-data-row limit, and header selection within the
  first 20 rows.
- Formula verification is not formula calculation. The browser does not calculate
  formula results, and serialization/syntax checks do not prove business meaning.
- The current formula verifier rejects bracketed references such as `[@Value]`.
  A generated proposal can therefore be rejected as unsupported even if its
  notation is meaningful in an Excel table. Do not advertise support that is not
  implemented.
- The current frontend has no aggregate dashboard, job-history listing screen,
  or financial-statement-specific reporting surface. Backend job listing exists.
- Test fixtures and synthetic integration tests do not prove deployed end-to-end
  behavior or financial accuracy.

### Open product decisions

- Which financial statements and accounting workflows should receive dedicated
  support first.
- Accounting rules, reporting standards, currencies, units, periods, rounding,
  sign conventions, and reconciliation requirements.
- How users should supply or confirm the business definition of a generated
  financial column; a positive-value filter must not be assumed to define profit.
- User roles, approval authority, and whether any multi-person approval workflow
  is required.
- Product-specific accessibility requirements beyond the existing web controls.

These are open decisions, not requirements already approved or capabilities
already implemented.

## Language and Terminology

English is the primary application language, confirmed by the project owner on
2026-10-21. Do not infer a Thai UI requirement from the language used in chat.

Keep terminology consistent:

- **Current workbook:** the uploaded data being inspected or transformed.
- **Main/master workbook:** the trusted reference used for standardization and
  updates; it is not overwritten.
- **Proposal:** a suggested change awaiting a decision.
- **Draft decision:** a local review choice that has not been submitted.
- **Applied change:** a change actually applied by backend processing.
- **Confidence:** a reported proposal score, not a correctness guarantee.
- **Syntax verified:** formula checks passed within supported constraints, not a
  calculated or financially validated result.

The visible application currently uses the name `Pilotxl`; the
repository is named `ntt-excelbridge`. A new marketing name or brand positioning
has not been approved.

## Evidence on Hand

- Owner-confirmed audience and language from the init interview on 2026-10-21.
- Existing routes and components under `frontend/src/` and backend implementation
  under `backend/app/`.
- `README.md`, `frontend/README.md`, and `docs/design.md` describe architecture
  and workflow. Implementation and later decisions must be checked when older
  planning text differs from current behavior.
- `docs/decisions/` records implementation choices and constraints.
- `docs/frontend-ui-redesign.md` records the existing UI refresh and its
  verification limits; it is not financial acceptance evidence.
- `sample-data/README.md`, `sample-data/current.xlsx`, and
  `sample-data/main.xlsx` document synthetic customer-data fixtures. These are
  not real customer records, financial statements, or proof of accounting support.
- No approved customer testimonials, benchmarks, pricing, or financial validation
  evidence was supplied during init. Future surfaces must not fabricate them.

## Product Principles

1. Preserve original workbooks and make applied changes traceable.
2. Keep proposals, draft decisions, submitted decisions, and applied results
   distinguishable.
3. Make review actions depend on validated evidence and the actual job state;
   explain unavailable actions and the next useful step.
4. Require financial business meaning to come from confirmed rules and evidence,
   rather than treating AI confidence or a column name as financial truth.
5. Present actual capabilities, results, and limitations in clear English;
   never substitute demonstration data or unsupported claims for real evidence.
