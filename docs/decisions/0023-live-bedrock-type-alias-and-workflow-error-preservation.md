# Decision 23: Normalize safe type aliases and preserve workflow failure input

## Context

The live Bedrock smoke test reached Tool 2 successfully, but the model returned
`target_type: "int"`. The backend vocabulary is `integer`, so strict validation
rejected the response. The same execution then failed to mark the job because the
deployed Step Functions definition discarded the original input before `MarkFailed`
read `job_id`.

## Decision

- Keep the canonical backend vocabulary strict: `string`, `integer`, `number`,
  `date`, `datetime`, and `boolean`.
- Normalize only unambiguous model aliases (`int`, `float`, `double`, `decimal`,
  `bool`, `str`, and `text`) at the Tool 2 trust boundary. Unknown values remain
  validation errors.
- State machine catches must write the service error to `$.error`, preserving the
  original workflow input so `MarkFailed` can always update the correct job.
- The deployment verification must inspect the deployed state machine, not only the
  repository JSON, before accepting an end-to-end result.

## Consequences

This tolerates predictable model vocabulary drift without weakening the safety gate
for unknown types. A failed worker can now be recorded as `FAILED` instead of
leaving the job in an intermediate state. The existing deployed stack must be
updated before the fix is effective in AWS.
