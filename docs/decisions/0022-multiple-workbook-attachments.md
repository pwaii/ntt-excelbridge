# Decision 0022: Multiple workbook uploads

## Context

The workflow previously accepted only the primary input workbook and, for standardization or updates, one master workbook. Users also need to provide supporting workbooks such as history, reference, or prior-period files.

The backend and AI workflow must remain unambiguous: the AI tools have defined primary roles, while extra workbooks should not silently become additional AI inputs with unclear semantics.

## Decision

- Keep `input_filename` as the primary current workbook.
- Keep `main_filename` as the optional master workbook used by standardization and update workflows.
- Add `additional_filenames`, limited to eight files, mapped deterministically to `attachment_1` through `attachment_8`.
- Return upload instructions for every declared file and require every file to be uploaded and server-confirmed before the job can enter `UPLOADED`.
- Store supporting workbooks in S3 and retain their metadata with the job.
- Keep the AI boundary explicit: Tool 1 receives the primary input, and the configured master remains the master. Supporting attachments are available as retained job inputs but are not automatically injected into AI prompts or treated as a master.
- Treat repeated upload completion as idempotent when the job remains in `UPLOADING`.

## Rationale

This preserves backward compatibility for existing clients, makes the upload contract deterministic for the frontend, and prevents an attachment from changing AI behavior merely because it was uploaded. Future AI features can opt into specific attachment roles deliberately.

## Verification

- Backend schema and API tests cover multiple attachment metadata and upload instructions.
- Frontend tests cover request serialization and attachment upload mapping.
- The local UI exposes a supporting-workbook picker and displays each upload separately.
