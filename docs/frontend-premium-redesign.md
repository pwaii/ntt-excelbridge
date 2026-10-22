# Full frontend redesign

Implemented directly in the existing React 18, Vite, TypeScript, Tailwind CSS,
and Radix Slot frontend. No framework, API client, backend schema, upload
transport, authentication adapter, processing controller, or approval contract
was replaced. No production dependency was added.

## Product inventory and constraints

1. The principal objects are workflow jobs and their current/main workbook files.
2. Each file has its real name, size, selected state, transfer state, and
   server-confirmed upload state; `.xlsx` and 25 MB limits remain enforced.
3. A new column has a user instruction and a separate exact output header.
4. Standardization and update remain independent operations with four combinations.
5. Worksheet metadata supplies sheets, data-row counts, headers, and physical key
   column IDs. It is never inferred from uploaded bytes in the browser.
6. Matching keys and duplicate handling remain subject to the backend's rules.
7. Findings carry actual evidence, confidence, severity, permitted decisions,
   and a distinction between proposal, draft, submission, and application.
8. Formulas carry syntax verification, not calculated or financially certified results.
9. Job revisions protect review submission and configuration from stale state.
10. Artifacts are available only when published; download URLs expire and remain
    tied to the expected artifact key.
11. Financial teams use the application to inspect evidence and approve changes;
    frequent use and smaller screens require readable, stable controls.
12. An account with no current job gets the real creation form, not invented
    history, dashboards, totals, activity, members, or usage numbers.

## Direction and signature

Chosen from the installed Taste app-screen draw: **Framed sheet**, seed
`223990742`. A muted green-grey frame, white working sheet, self-hosted IBM Plex
Sans, and one teal accent replace the previous blue, centred form presentation.
The face comes from workbook paper and the custom sheet/arrow mark. The product
signature is the visible source-to-reviewed-output relationship, expressed with
real configuration values in creation and before/proposed values in review.

No photographic assets or third-party artwork are used. The font distribution
and its license are included under `frontend/public/fonts`.

## Screen questions

| Screen | Question answered first |
| --- | --- |
| Sign in | How do I enter the workbook workspace? |
| Create workflow | Which workbook and column am I preparing, and what will the output be based on? |
| Upload | Have my selected files transferred and been verified? |
| Worksheet setup | Which sheets, header rows, and matching keys must I confirm? |
| Progress | Where is this job, and does it need my input? |
| Quality review | Which correction should I approve, based on what evidence? |
| Transformation review | Does this formula, mapping, or row match implement my instructions? |
| Result | Which published workbook can I download, and what was reported? |

## Implementation

- New responsive application frame and custom workbook mark; existing routes and
  keyboard/mobile navigation remain available.
- A three-state setup rail replaces the redundant separate Start setup step.
- Builder composition pairs fields with actual processing/output context.
- Shared typography, surface, border, radius, disabled-state, and motion tokens.
- Redesigned upload selection, drag-over, selected-file, and transfer feedback.
- Peer worksheet sections and consolidated matching help.
- Desktop list/evidence review; single-region review below 1200px, with explicit
  back navigation that retains drafts and list state.
- Shared skeleton loading, regional errors, honest empty states, and restrained
  status colours.
- Output-first completion, real reported counts, and secondary reports/details.

## Motion gate

Installed skill: `animate`, based on Emil Kowalski's interaction principles.
Frequent controls receive only near-imperceptible feedback. Occasional drag/drop
and loading receive state indication. CSS handles these cases; a motion library
would add no needed capability. Transforms and opacity do the moving work, with
160ms press feedback and the skill's strong ease-out curve. Keyboard navigation
and data reading have no entrance animation. Reduced-motion checks confirm that
loading movement is removed and content remains visible.

## Validation

- Frontend suite: **365 tests passed in 26 files**, including contract-fixture
  creation/upload/configuration/start, review submission, polling/retry, artifact
  download, validation, authentication, routing, and keyboard behavior.
- Added a behavioral check for opening a finding, returning to the list, and
  preserving its decision draft.
- TypeScript, production build, and ESLint pass.
- Taste source gate: **0 FAIL, 0 WARN**.
- Browser checks at **1440, 768, and 390px** use actual components with isolated
  synthetic fixtures. Additional checks cover loading, empty, error, failed,
  upload, worksheet, review, and filled-form states, no horizontal overflow,
  loaded font assets, mobile detail/back behavior, and reduced motion.
- The temporary visual preview is removed after inspection. Production routes
  import no sample data. Captures and machine-readable checks are retained under
  the ignored `.taste-skill` directory.

## Inspector results and comparison

| Screen | Final failures | Final warnings | Interpretation |
| --- | ---: | ---: | --- |
| Sign in | 0 | 0 | Font, contrast, and responsive measurements pass. |
| Create workflow | 0 | 0 | Fields, output context, and disabled actions remain within the canvas. |
| Quality review | 0 | 1 | Compact metadata contributes to the small-text ratio; the evidence and controls remain larger. |
| Result | 0 | 1 | The full-height application sheet is identified as a panel void; output cards themselves do not stretch. |

The before recording uses Helvetica Neue and a blue centred form. The final
screens use the loaded Plex face, a labelled application frame, separate editor
and output context, consistent status/action colours, and single-region review
when two readable panes will not fit. The native upload bar is themed without
changing its byte-based value. Phone result counts use two columns rather than
a ragged three-plus-one arrangement.

## Visual critique

1. The builder's largest area is its actual workbook and instruction input, with
   output context alongside it. The selected finding and evidence lead review;
   the published workbook leads results.
2. The desktop sheet has equal internal gutters. Controls align within their
   sections. Tablet evidence switches to one region before columns become too
   narrow. Long filenames and data stay within the viewport.
3. Neutral navigation recedes. Teal marks selection and the workbook relationship;
   semantic colours carry status. There are no decorative charts or KPI tiles.
4. Configuration summaries use the form's actual values. Review counts derive
   from findings and drafts; result counts derive from reported values. No
   duplicate manually maintained total was introduced.
5. Zero counts remain zero. Unavailable counts do not create empty tiles or imply
   a zero. No invented queues or navigation badges were added.
6. There are no charts or independently constructed legends to misrepresent data.
   Before/proposed evidence is labelled and remains readable.
7. Navigation folds on phones. Findings open into one detail region with an
   explicit return action. Pending submission does not cover evidence.

The result inspector can flag unused space in the full-height white application
sheet as a panel void. It is the deliberate workspace frame, not a stretched
output card or missing dataset. The review inspector can flag the proportion of
12px text: this is restricted to compact metadata, table sublines, and secondary
help; working controls, decisions, evidence, and important guidance remain larger.

## Practical limits

Visual and workflow verification use synthetic fixtures, not a newly executed
paid AWS workflow. Existing AWS/Cognito service acceptance remains dependent on
credentials and deployment configuration. The production build retains its
existing large-chunk advisory; no new runtime dependency was introduced. No
business or financial correctness claim is made by the redesign.
