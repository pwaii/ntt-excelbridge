# ADR 0005: Reconcile stale tests with the merged backend contract

## Status

Accepted for the demo implementation.

## Context

After the backend branch was merged with the upstream AI Day 5–7 work, four
tests failed because their fixtures or expectations described the earlier
implementation rather than the merged contract.

## Decisions

1. The Tool #5 default candidate limit is five, as required by ADR D6. The
   matching helper's defensive maximum of 25 remains available for controlled
   experiments; it is not the deployed default.
2. The empty-object Tool #5 parser test uses an unresolved row. When all rows
   are already deterministically matched, the adapter intentionally skips
   Bedrock and returns an empty model-match list.
3. Update API tests provide `key_column`, because update configuration is
   rejected by `JobConfig` without an explicit business key.
4. Quality-rule fixtures include their selected sheet. The apply worker does
   not apply a sheet-scoped issue to another sheet.

## Consequences

The tests now validate the behavior that is deployed and documented, rather
than weakening the safety guards or reintroducing an unnecessary model call.
