# Decision 0022: Multiple current workbook uploads

## Context

The workflow previously accepted only one current input workbook and, for standardization or updates, one master workbook. Users need to select several current workbooks in one upload operation.

The backend and AI workflow must remain unambiguous: the existing AI tools have one primary current-workbook role, so the first selected current workbook remains the primary source while the other current files travel with the same job.

## Decision

- Keep `input_filename` as a compatibility field for older clients.
- Add `input_filenames`, limited to eight current workbooks, with the first item mapped to `input` and later items mapped to `input_2` through `input_8`.
- Keep `main_filename` as the optional master workbook used by standardization and update workflows.
- Return upload instructions for every declared file and require every file to be uploaded and server-confirmed before the job can enter `UPLOADED`.
- Store all selected current workbooks in S3 and retain their metadata with the job.
- Keep the AI boundary explicit: the first current workbook is the primary input consumed by the existing AI tools, and the configured master remains the master. Additional current files are uploaded with the job but are not silently injected into AI prompts or treated as a master.
- Treat repeated upload completion as idempotent when the job remains in `UPLOADING`.

## Rationale

This preserves backward compatibility for existing clients, makes the upload contract deterministic for the frontend, and avoids changing AI behavior merely because more current files were selected. Future AI features can deliberately add batch processing semantics.

## Verification

- Backend schema and API tests cover multiple current-workbook metadata and upload instructions.
- Frontend tests cover request serialization and current-workbook upload mapping.
- The local UI exposes one current-workbook picker with multi-file selection and displays each upload separately.
