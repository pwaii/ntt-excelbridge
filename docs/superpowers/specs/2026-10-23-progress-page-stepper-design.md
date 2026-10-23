# Progress page stepper redesign

**Date:** 2026-10-23

## Problem

The current UI exposes four separate sidebar links per workflow (Job progress, Quality review, Transformation review, Result). This fragments navigation and forces users to understand the routing before they understand the workflow. The progress page shows a vertical list of stages with text status labels ("Complete", "Pending") that add visual noise without adding meaning.

## Decision

Collapse to a single URL per workflow. The progress page owns the full workflow experience: a horizontal circle stepper at the top communicates stage state through color, and clicking a circle opens its detail inline below.

## Section 1: Left sidebar

- `JobNavGroup` renders a **single link** per workflow: `Workflow {id.slice(0, 8)}` → `/jobs/:id`
- The expanded sub-links block (Job progress, Quality review, Transformation review, Result) is removed entirely
- `jobNavigation` array in `route-config.ts` is deleted — nothing else uses it after this change
- Both active and inactive workflows show the same single link

## Section 2: Circle stepper

Five stages rendered as a horizontal row of clickable nodes connected by lines:

```
  ●————●————○————○————○
Setup  Data  Quality Changes Output
```

**Node states — communicated by color only, no text status label:**

| State | Circle fill | Icon | Connector to next |
|---|---|---|---|
| Complete | `--success` green | check | solid green |
| Active | `--workflow-accent` teal | ring/dot | `--border` grey |
| Pending | hollow, `--border` grey | none | dashed grey |
| Failed | `--destructive` red | alert | — |

Stage name sits below each circle. No substate text ("Complete", "Pending") — color carries that meaning.

**Interaction:**
- Clicking a complete or active circle selects it and opens the detail panel
- Pending circles are not interactive
- On page load, the active stage is selected by default — no blank arrival state

## Section 3: Detail panel

A single panel below the stepper shows content for the selected stage:

| Stage | Detail content |
|---|---|
| Workbook setup | Status title + description from `messages` record in `job-timeline.tsx` |
| Check data | Status title + description from `messages` record |
| Quality review | `QualityReviewPage` embedded inline |
| Review changes | `TransformationReviewPage` embedded inline |
| Prepare output | `ResultPage` embedded inline (when `COMPLETED`); status text otherwise |

Pending stages produce no panel (clicking is disabled). Active stage panel opens on load.

## Section 4: Routing

- `/jobs/:id` — single route for the full workflow experience
- `/jobs/:id/quality-review`, `/jobs/:id/transformation-review`, `/jobs/:id/result` — **removed**
- `JobTabsLayout` — **removed**; `routes/index.tsx` renders `JobProgressPage` directly at `/jobs/:id/*`
- Selected circle lives in `useState` inside the progress page — does not survive hard refresh, which is correct since the active stage is always the right default

**Tests to update:**
- `routing.test.tsx` — remove assertions for the three sub-routes
- `quality-ui.test.tsx`, `transformation-ui.test.tsx` — components are unchanged, only mount location changes; assertions remain valid

## What is not changing

- The review workspace components (`QualityReviewWorkspace`, result workspace) — no internal changes
- The `jobStages` logic in `job-stages.ts` — reused as-is
- The `messages` record in `job-timeline.tsx` — reused for non-review stage detail text
- Backend routes, job status model, or any API contracts
