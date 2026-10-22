# Decision 28: Send bounded exact values for Tool 4 mappings

## Context

The live standardization workflow used redacted inspection samples as Tool 4
`source_value` values. The model could propose a mapping, but the apply worker
could not find the redacted value in the original workbook, so no cells changed.

## Decision

- Tool 4 receives bounded exact source values only for fields shared by the
  current and main workbooks.
- The prompt requires the model to return each source value exactly as supplied.
- Redacted samples remain available as supporting evidence, and raw values are
  not written to logs. Proposal artifacts remain private and ownership-checked.
- Canonical values remain strictly allowlisted from the main workbook.

## Consequence

Approved mappings can be applied deterministically to the original workbook while
the prompt remains bounded to shared fields and the system does not log raw
values. This is a deliberate exception to the generic redacted-sample rule
because exact source identity is required for a safe mutation.
