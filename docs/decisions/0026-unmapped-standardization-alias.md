# Decision 26: Normalize the unmapped standardization alias

## Context

After Tool 4 input bounding fixed the response truncation, Bedrock returned an
unmapped record with `canonical_value: "unmapped"`. The backend contract uses an
empty canonical value for unmapped records so no literal status word can be
written into the workbook.

## Decision

At the Tool 4 trust boundary, normalize `canonical_value: "unmapped"` to an
empty string only when `cardinality` is already `unmapped`. Continue rejecting
that value in mapped records and continue rejecting all other canonical values
that were not supplied by the main workbook.

## Consequence

The model may use the natural-language unmapped label without weakening the
canonical-value allowlist or creating a fabricated workbook value.
