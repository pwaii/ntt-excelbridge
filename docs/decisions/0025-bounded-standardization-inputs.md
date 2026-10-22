# Decision 25: Bound Tool 4 to shared workbook fields

## Context

The live standardization workflow sent every sampled value from the current
workbook and every value from every main-workbook column to Bedrock. Tool 4 then
returned truncated JSON at the configured output limit, causing a retryable
workflow failure before any output workbook was written.

## Decision

- Build Tool 4 inputs only from fields present in both the current and main
  workbooks.
- Send source samples as `{field, value}` pairs so the model cannot confuse
  values from unrelated columns.
- Send canonical candidates from the shared main fields only.
- Keep the existing Bedrock output cap and trust-boundary validation rather than
  accepting truncated or repaired JSON.

## Consequence

Standardization prompts are smaller, semantically scoped to fields that can be
standardized into the main representation, and less likely to exceed the model
output limit. A malformed or truncated model response is still rejected safely.
