# Decision 0017: Keep upload completion idempotent during multi-file uploads

## Context

Jobs that require both an input workbook and a main workbook remain in
`UPLOADING` after the first file is verified. The upload-completion endpoint was
writing `status=UPLOADING` again, but the state machine correctly rejects a
same-status write as not forward. The S3 uploads had succeeded, but both API
completion calls returned a configuration error.

## Decision

When upload completion verifies a file but the calculated status is unchanged,
update only the file manifest, hashes, and revision metadata. Write the status
only when it advances from `UPLOADING` to `UPLOADED`. This also makes repeated
completion calls safe for an already-uploaded slot.

## Consequences

- The first file in a two-file job can be completed successfully.
- The second file advances the job to `UPLOADED`.
- Upload completion remains retryable without weakening the strictly-forward
  workflow state machine.
