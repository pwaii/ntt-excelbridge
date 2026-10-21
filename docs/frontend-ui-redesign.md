# Frontend UI refresh — 2026-10-20

## Product and direction

The application is a workbook processing and review workspace. Users configure an
Excel job, upload workbooks, confirm worksheets and headers, review proposed
changes, and download the output and supporting reports.

The design uses white and neutral `#F7F7F8` surfaces, Helvetica Neue / Helvetica /
Arial, one blue accent (`#002FA7`), and thin grid rules. Green, amber, and red
identify success, attention, and errors. Gradients, decorative effects, oversized
page headings, and the frontend-preview label have been removed from active pages.

## Implemented changes

- Shared navigation, page headings, button sizes, fields, panels, notices, and
  status badges use common tokens. The desktop header remains visible on creation.
- Creation has a numbered setup rail that reflects the current setup phase. It
  does not imply that processing has run or that an unobserved phase completed.
- Submitted configuration collapses into an expandable summary so upload and
  worksheet confirmation remain the focus. Original settings remain accessible.
- Pre-upload worksheet settings explain the later steps instead of showing
  unusable dropdowns. The functional post-upload selectors are retained.
- Worksheet selection explains why the header controls are not yet visible.
  Header confirmation includes actual backend column labels when they correspond
  to the entered header row. Nothing is auto-confirmed.
- The metadata action bar wraps and separates reload from save/start. Blockers
  use readable workbook names, and successful saves show readiness feedback.
- Job progress uses a compact list and actual status badge instead of nested
  cards. Observations remain explicitly limited to statuses received this visit.
- Reviews have a compact count strip, severity labels, filters, a scrollable
  findings table, and a neighboring details panel on wide screens. Bulk acceptance
  and final submission keep their existing separate confirmations.
- Results use a download list and real outcome counts. Unpublished artifacts stay
  unavailable; download links still require an explicit request and expire.
- Outdated validation/copy-demo and missing-contract claims were removed from
  active workflow copy. Local-development authentication remains clearly labeled.

## Main implementation files

| Area | Files under `frontend/src/` |
| --- | --- |
| Tokens and primitives | `index.css`, `components/ui/button.tsx` |
| Layout and headings | `components/layout/app-layout.tsx`, `components/layout/page-header.tsx`, `auth/session-actions.tsx` |
| Job setup | `pages/create-job-page.tsx`, `components/job/form-section.tsx`, `job-form-actions.tsx`, `workflow-steps.tsx`, `workbook-file-picker.tsx`, `connected-create-flow.tsx` |
| Metadata | `components/job/post-upload-configuration.tsx`, `header-row-confirmation.tsx`, `large-file-warning.tsx` |
| Progress | `pages/job-progress-page.tsx`, `components/job/connected-job-status.tsx`, `job-timeline.tsx`, `job-status-badge.tsx` |
| Reviews | `pages/quality-review-page.tsx`, `pages/transformation-review-page.tsx`, `components/job/quality-review-workspace.tsx` |
| Results | `pages/result-page.tsx`, `components/job/result-workspace.tsx` |
| Authentication and errors | `pages/sign-in-page.tsx`, `pages/auth-callback-page.tsx`, `pages/not-found-page.tsx` |
| Updated expectations | `tests/create-job.test.tsx` |

## Responsive and accessible behavior

- Mobile navigation retains its toggle, expanded state, Escape handling, and focus
  return. Skip-to-content and route-change focus are retained.
- Buttons permit wrapping text; action groups wrap rather than overflow. Mobile
  fields use 16 px text, and all layout columns can shrink.
- Review tables scroll within their own containers. At the wide-screen
  breakpoint the details panel is adjacent and independently scrollable; smaller
  screens keep it below the table.
- Inputs retain labels, errors, and described-by relationships. Worksheet selection
  adds context-specific help. Status and errors keep their live-region roles.
- Reduced-motion preferences, visible focus outlines, native controls, and
  text labels alongside semantic colors are retained.

## Verification and limits

Final verification:

- Complete Vitest suite: 348 tests passed in 25 files.
- TypeScript and production build: passed.
- ESLint: passed.
- Git whitespace check: passed.
- Local frontend, Vite CSS/creation modules, and backend health: HTTP 200.
- Existing nonblocking React Router notices, dependency annotations, and the
  approximately 505 kB JavaScript chunk advisory remain.

The existing integration/component tests cover upload, metadata confirmation,
reviews, results, authentication, and route navigation. External services in the
automated tests remain mocked boundaries.

Real browser visual checks were not completed. The Computer Use approval review
rejected capturing a Chrome window because the target URL could not be established
safely and unrelated personal tabs might be exposed. The Computer Use session then
stopped. Desktop/tablet/mobile screenshots and real-browser review of scrolling,
focus, and wrapping remain acceptance items; source changes and passing builds
alone do not certify visual readiness or deployed end-to-end behavior.

No backend, API contracts, AWS infrastructure, or authentication verification
logic changed. No cloud jobs were created for this UI refresh. Existing local
development configuration is retained. This change has not been deployed.
