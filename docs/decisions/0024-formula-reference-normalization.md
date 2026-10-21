# Decision 24: Normalize AI formulas to row-relative A1 references

## Context

The live add-column test reached the transformation review gate, but Bedrock
returned an Excel table formula using `[@Quantity]` and `[@UnitPrice]`. The
sample workbook is a plain worksheet, not an Excel table, so the formula was
correctly rejected and no new column was written.

## Decision

- Tool 3 prompts must request ordinary A1-style references with the literal
  `{row}` placeholder.
- At the Tool 3 trust boundary, references to headers explicitly supplied in
  `source_headers` are converted to row-relative A1 references. This includes
  safe conversion of structured references such as `[@Quantity]`.
- The existing function allowlist, formula parser, range checks, and human review
  gate remain mandatory after normalization.

## Consequence

Formula proposals work on ordinary worksheets while remaining deterministic and
reviewable. The backend still rejects unknown headers, external links, forbidden
functions, and formulas outside the selected range.
