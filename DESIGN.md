---
name: Pilotxl
description: A focused workbook review workspace, with a tinted frame and a white document surface.
colors:
  background: '#edf2f3'
  foreground: '#1c282b'
  card: '#ffffff'
  primary: '#20383d'
  primary-foreground: '#ffffff'
  workflow-accent: '#1b6c80'
  accent: '#e7f1f3'
  accent-foreground: '#18596a'
  muted: '#f3f6f6'
  muted-foreground: '#5d6a6e'
  border: '#e6ebed'
  input: '#cbd4d7'
  success: '#246249'
  success-surface: '#edf6f1'
  warning: '#865117'
  warning-surface: '#fff8ec'
  destructive: '#b32d39'
typography:
  family: IBM Plex Sans
  weights: [400, 500, 600]
  page-title: 24px / 32px
  mobile-title: 22px / 28px
  section-title: 15px / 22px
  body: 14px / 21px
  control: 14px / 20px
  helper: 13px / 18px
  metadata: 12px / 18px
radii:
  control: 6px
  panel: 8px
  sheet: 16px
  mobile-sheet: 12px
---

# Pilotxl design system

## Direction

**A workbook on the desk.** A quiet green-grey application frame holds a white
working sheet. IBM Plex Sans gives instructions, workbook values, and controls a
consistent voice. A custom sheet-and-arrow mark connects the product to its actual
job: reviewing changes before creating a separate output.

The direction is **Framed sheet**, dealt by `design-taste-frontend`, seed
`223990742`, on 2026-10-22. Its composition replaces the previous centred form
layout. The product name and English application language are retained.

Use colour to explain selection, status, and the primary action. Navigation stays
neutral. Avoid gradients, decorative illustrations, resting shadows, invented
statistics, and generic dashboard sections.

## Tokens and typography

`frontend/src/index.css` is the implementation source for the tokens above.
IBM Plex Sans is self-hosted in `frontend/public/fonts`, with its SIL Open Font
License in `OFL.txt`. The application does not need a third-party font request.
Source: Google Fonts' official IBM Plex Sans distribution.

Use 400 for body text and figures, 500 for field and section labels, and 600 for
page titles and necessary emphasis. Keep IDs and formula code distinct from
explanatory text. Use tabular figures for changing counts and progress values.
Helper text is 13px; 12px is reserved for metadata and compact secondary labels.
Phase substate text has an 11px floor. Mobile form fields increase to 16px to
avoid browser input zoom.

## Frame and responsive composition

- Desktop uses a 228px labelled sidebar and a 48px context bar. At 1024-1199px the
  sidebar is 208px. The content sheet is inset 8px, with a 16px corner radius and
  one quiet edge. It has no shadow.
- The canvas has equal 32px gutters, reducing to 24px on intermediate widths and
  16px on phones. Content stops at 1440px; the builder stops at 1160px.
- Below 1024px, navigation folds into a 64px header. The menu preserves real
  destinations, account access, Escape handling, and focus return.
- The builder pairs workbook/instruction fields with processing and output
  context. Below 768px these become a single reading column.
- Review uses two panes only at 1200px and above. Below that, a finding opens its
  detail region; **All findings** returns to the existing list and scroll position.
- Touch controls are at least 44px high on phones. Tables, selected filenames,
  disclosures, and action groups stay within the viewport.

The application sheet fills its workspace. A short result is allowed to leave
unused canvas below it; do not stretch its output row or invent content to fill
that space.

## Creation and workbook setup

The setup rail represents the three actual setup states: configure, upload, and
confirm/start. It does not imply that processing has already begun.

Labels sit above controls. The requested calculation and exact output header
remain separate inputs. Optional processing uses native checkboxes; selecting an
operation reveals its required main workbook. The output context is derived from
the selected filenames, output header, and output policy. It never invents
worksheet rows, generated formulas, or completed changes.

The action footer keeps missing requirements beside **Upload workbooks**. A
valid-looking button must not be used for a disabled action. File selection and
server-confirmed upload remain visibly different states. The picker supports
browse, drag/drop, replacement, removal, size validation, and keyboard focus.

After upload, files collapse and worksheet setup becomes the task. Required
workbooks have peer configuration sections, explicit header confirmation, and
matching-key selection when applicable. Show the next relevant requirements;
keep every readiness rule enforced even when its dependent hint is deferred.
Matching rules remain available once beneath the workbook sections.

## Review

The review's signature is the relationship between a selected finding and its
before/proposed evidence. Use a pale teal selection, restrained row rules,
readable cell values, and a quiet tint on the proposed-value column. Never use
colour as the only indication of a decision or status.

Keep proposal counts, draft decisions, submitted decisions, and applied changes
separate. Evidence, syntax limitations, confidence, permitted actions, blockers,
and the explicit submission confirmation remain available. A confidence score is
not a correctness guarantee.

Submitted reviews collapse behind **View submitted review**, while the
acknowledgement and next-step action lead. Submitted choices are labelled as
submitted, not drafts. On phones, the submit area stays in the document flow
while required decisions remain, so it does not obscure the evidence.

## Progress and results

Progress leads with the server-owned current state and its real next action. The
five processing phases derive from status and available history; unknown or
skipped phases remain explicit. Workflow IDs, revisions, timestamps, and source
filenames stay in the workflow-details disclosure.

Results lead with the published workbook and its download action. Display only
reported counts, including actual zero values. Keep missing output, expired
links, and failed downloads actionable. Supporting reports and verification
remain available through disclosures. Formula syntax verification is not
calculation or confirmation of financial meaning.

## Loading, feedback, and motion

Use the shared `WorkflowLoading` component for initial workflow, worksheet,
review, and result loading. Skeletons preserve a working structure without
inventing progress percentages. Keep errors in the affected region with a real
recovery action. Empty reviews show their next action without empty filters.

The motion system follows the installed `animate` skill:

- Purpose: immediate feedback and state indication, not decoration.
- Buttons: a pointer press scales to 0.98 over 160ms using
  `cubic-bezier(0.23, 1, 0.32, 1)`; keyboard focus does not trigger this movement.
- Hover/focus/selection feedback uses named colour and border transitions.
- The upload affordance moves only 2px, gated to a fine pointer with hover.
- Loading uses opacity and the real processing indicator uses a linear rotation.
- No page entrance, moving data rows, springs, or animation dependency is added.
- Reduced motion removes movement and loading animations while retaining brief
  colour feedback. Content remains visible.

## Verification

See `docs/frontend-premium-redesign.md` for the inventory, screen questions,
validation evidence, visual critique, and limits. Generated screenshots and
inspector reports live under the ignored `.taste-skill` folder.
