# Create Job Page — Clarity Redesign

**Date:** 2026-10-23  
**Scope:** `frontend/src/pages/create-job-page.tsx` and its child components

---

## Problem

The create-job page uses system language (Engagement, current workbook, Procedures, standardize) instead of user language. Business/operations users — the primary audience — get stuck on terminology, don't understand what the tool does, don't know which files to attach, and don't understand the three distinct jobs the tool can perform.

---

## Design decisions

### 1. Page renamed: "Engagement" → "New job"

"Engagement" is internal jargon. "New job" is what the user is doing.

### 2. Three task cards replace the Procedures checkboxes

The tool does three distinct jobs, often in combination:

| Card label | What it does | Requires master file? | Requires column description? |
|---|---|---|---|
| Add a column | AI calculates/fills a new column | No | Yes (optional) |
| Standardize my file | Align headers & values to master | Yes | No |
| Update master file | Push approved values back to master | Yes | No |

Cards appear at the top under **"What do you want to do?"** and are multi-select. The form below adapts to whichever cards are selected:
- "Your file" (Section A) is always shown — required
- "Master file" (Section B) appears only when Standardize or Update master is selected — required if shown
- "What to add" (Section C) appears only when Add a column is selected — optional if shown

Section letters re-order dynamically based on what's shown.

### 3. All section labels rewritten in plain English

| Before | After |
|---|---|
| Workbook under review | Your file |
| Column to add | What to add |
| Procedures | (replaced by task cards) |
| Output column header | Column name |
| Main workbook | Master file |

### 4. Step labels rewritten

| Before | After |
|---|---|
| Configure job / Files & instructions | Set up / Choose tasks & files |
| Upload workbooks / Transfer & verify | Upload / Transfer & verify |
| Confirm worksheets / Choose sheets & start | Review / Approve & download |

### 5. Removed: "Prepared output" / "What you'll get" section

Redundant with the task cards (which already explain outputs) and the 3-step progress bar (which already shows the flow). Removed entirely.

### 6. Removed: "Your originals are never changed." / "Your original is never changed."

Removed from page subtitle and Section A subtitle. If needed later it can live in the sidebar ("Review first. Keep your originals.") which is already present.

### 7. Helper text color

Green/teal link-colored helper text changed to neutral muted gray — it reads as links/alerts when it's just guidance.

---

## Adaptive form logic

```
selectedTasks = subset of {addColumn, standardize, update}

showYourFile   = always
showMasterFile = standardize || update
showWhatToAdd  = addColumn

sectionOrder = [
  showYourFile   → "A. Your file"
  showMasterFile → "B. Master file"   (only if needed)
  showWhatToAdd  → next letter. "What to add"  (only if needed)
]
```

The existing `requiresMain` boolean already drives the main-file picker; the task cards replace the checkboxes as the source of truth for `standardize` and `update`. The `comment_name` (prompt) field maps to "What to add". No backend changes needed.

---

## What is NOT changing

- Form validation logic, schema (`jobCreationSchema`), field names
- File picker components (`WorkbookFilePicker`, `CurrentWorkbookPicker`) — internals unchanged, just rendered in new positions
- The `ConnectedCreateFlow`, `JobFormActions`, `LargeFileWarning` components — reused as-is
- Backend API, job creation flow, upload steps

---

## Spec self-review

- No TBDs or placeholders
- Section letter re-ordering: letters are cosmetic `aria-hidden` labels — dynamically computing A/B/C/D based on which sections are visible is straightforward
- "Add a column" selected by default or no default? → No default. User must choose at least one task to proceed. Validation: require at least one card selected before enabling "Upload files" button.
- The `comment_name` field is currently always rendered; with the redesign it only renders when addColumn is selected. The schema marks it optional, so hiding it when not selected is valid — the field simply stays empty.
