# ADR 0003: Backend correctness and privacy hardening

## Status

Accepted for the demo implementation.

## Decisions

### 1. DynamoDB proposal summaries contain metadata only

Tool #2 and Tool #5 proposal payloads remain private S3 artifacts. Their
DynamoDB child records contain only safe list-view metadata such as item kind,
match type, confidence, and recommended action. Workbook values, model reasons,
examples, and patterns are not copied into DynamoDB or operational logs.

### 2. S3 existence checks distinguish missing objects from AWS failures

`head_object` returns `False` only for documented not-found errors. Permission,
authentication, throttling, and transport failures are re-raised so a failed
AWS dependency cannot be mistaken for a missing artifact.

### 3. Update output requires an explicit business key

`update_only` and `both` reject configuration during job creation, and the
apply layer repeats the guard before writing an output workbook, when
`key_column` is absent. Treating every row as a match would be unsafe and could
overwrite unrelated main-workbook rows.

### 4. Decision event keys distinguish issue and proposal records

Operational decision events use `EVENT#decision#issue#...` and
`EVENT#decision#proposal#...` keys. This prevents an issue ID and proposal ID
with the same text from overwriting one another in the DynamoDB job partition.

### 5. Candidate blocking is explicit

Tool #5 candidate blocking groups by shared first key character or a small key
length difference. Parentheses make the intended OR condition explicit before
similarity ranking and the candidate limit are applied.

The deployed default candidate limit is five per unresolved current row, as
specified by ADR D6. It remains configurable for controlled experiments, while
the matching helper keeps a defensive maximum of 25.

When there are no unresolved rows, Tool #5 emits the deterministic exact-match
proposal without invoking Bedrock. This preserves the same audit envelope and
avoids an unnecessary model call.

### 6. One artifact-download route is authoritative

The earlier download router registered the same URL as the newer artifact
router. The older registration was removed from the FastAPI application so the
authoritative route provides ownership checks, key-prefix validation, existence
checks, and the complete artifact allowlist (including review, input, and main
files).

### 7. Update conflicts use an explicit, safe policy

Job configuration defaults to `reject_all` when multiple accepted current rows
target one main row. The apply worker also supports `latest_wins` and `merge`
when explicitly configured. `keep_both` is not exposed because it requires
unmatched-row insertion and is still governed by ADR D7.

## Consequences

The frontend must fetch full proposal artifacts when it needs explanations or
sample values. Update policies are safer but require the configuration field
`key_column`. These changes do not remove the existing demo limitation that
unmatched rows are skipped instead of inserted.
