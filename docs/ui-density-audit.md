# Compact workflow redesign — 2026-10-21

## Critical audit

- The 72px header, 28–32px page titles, 40px main inset, 24px form sections,
  and 112px empty upload target consume space before any meaningful work.
- Progress devotes a row to each internal phase. Session-observation labels do
  not explain which tasks are finished, active, or still needed.
- Completed jobs repeat a completion badge, success heading, output heading,
  file heading, and progress link. The actual download action comes late.
- Setup mixes a useful data-entry task with future worksheet explanations,
  repeated output assurances, and full-sized option tiles.
- Reviews reserve a full-height list/evidence container even for one proposal.
  Formula syntax checks are easy to mistake for validation of business meaning.
- A full-height, centered welcome composition and a bottom-anchored session
  footer make short screens feel empty rather than efficiently composed.

## Direction contract

THESIS: A compact document workspace, with the file, current task, and next
action visible together. Retain the established Swiss palette and type family;
replace the inflated composition with task-sized sections.

OWN-WORLD: White work surfaces, neutral #F7F7F8 canvas, #002FA7 actions, fine
rules, 22–24px page headings, 13px interface text, and a 4px spacing rhythm.

STORY: Choose a workbook and define the requested column; confirm worksheets;
review evidence and make decisions; obtain the separate output workbook.

FIRST VIEWPORT: A 56px header and 1120px content grid. Progress uses a compact
phase strip and a file/context summary rather than a tall checklist. Completed
jobs lead with the downloadable file; supporting reports and diagnostics stay
secondary. Reviews use a dense list and evidence panel with explicit decisions.

FORM: An evolution inside the confirmed Swiss world, governed by the user's
specific request for density, minimalism, and compact progress. No new identity
or concept selection is needed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.

## Constraints

No backend changes, API changes, new dependencies, invented results, or automatic
approval. Progress states derive from the job's actual status and available
segment/history evidence. Unknown failure locations remain unknown; legacy copy
jobs do not claim human review. Download identity, origin, and expiry checks,
manual review confirmation, polling backoff, and ambiguous-outcome guards remain.
