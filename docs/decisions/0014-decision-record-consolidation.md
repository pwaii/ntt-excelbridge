# Decision 0014: Consolidate repetitive backend decision records

Date: 2026-10-18

## Decision

Keep decision records focused on durable architecture and current deployment
behavior. Remove superseded, historical, or duplicate backend records.

## Consolidation

- Deleted 0004 because its proposal-artifact route and audit behavior are
  already covered by 0003 and the backend deployment documentation.
- Deleted 0005 because it documented a one-time test-fixture reconciliation,
  not a durable system decision.
- Replaced 0006, 0007, and 0008 with 0006
  (`0006-backend-runtime-correctness.md`), which keeps their three active
  runtime decisions in one place.
- Replaced 0009, 0010, and 0011 with 0009
  (`0009-deployment-tooling.md`), which records only the current host-based
  SAM build path. The superseded Docker/container approach is removed.

The active backend records that remain are 0001, 0002, 0003, 0006, 0009,
0012, and 0013. This consolidation record is 0014.

## Consequence

The decision directory is shorter, links point only to current records, and
historical implementation attempts no longer compete with the active backend
deployment instructions.
