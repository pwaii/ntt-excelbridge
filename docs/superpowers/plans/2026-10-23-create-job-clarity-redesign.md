# Create Job Clarity Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace jargon-heavy form labels, Procedures checkboxes, and the "Prepared output" section with plain-English task cards and concise copy — without changing any backend API or validation logic.

**Architecture:** Task cards (Add a column / Standardize my file / Update master file) replace the old Procedures checkboxes. `standardize` and `update` stay as registered form fields; a new `addColumn` field controls whether the "What to add" section renders. The engagement-note section is deleted entirely. All other form logic, schema, file pickers, and backend wiring are unchanged.

**Tech Stack:** React 18, react-hook-form, Zod, Tailwind via CSS classes in `index.css`, Vitest + react-dom/client for tests.

---

## File map

| File | Change |
|---|---|
| `frontend/src/schemas/job-creation.ts` | Add `addColumn` boolean field |
| `frontend/src/components/job/workflow-steps.tsx` | Rename 3 step labels |
| `frontend/src/components/job/job-form-actions.tsx` | Rename button text |
| `frontend/src/components/job/current-workbook-picker.tsx` | Update visible strings and aria-labels |
| `frontend/src/components/job/workbook-file-picker.tsx` | Update "main workbook" strings |
| `frontend/src/pages/create-job-page.tsx` | Full restructure: task cards, section names, remove engagement-note |
| `frontend/src/index.css` | Add `.task-card*` styles; remove `.processing-card`, `.engagement-note`, `.output-outline*`, `.output-policy-disclosure`, `.output-path`, `.update-note` |
| `frontend/src/tests/create-job.test.tsx` | Update broken selectors and copy assertions |

---

### Task 1: Add `addColumn` to schema

**Files:**
- Modify: `frontend/src/schemas/job-creation.ts`
- Test: `frontend/src/tests/create-job.test.tsx` (existing test run to confirm no regressions)

- [ ] **Step 1: Add field to schema**

In `frontend/src/schemas/job-creation.ts`, add `addColumn` inside `z.object({...})` alongside the existing fields:

```ts
export const jobCreationSchema = z.object({
  currentFile: workbookFileSchema.nullable().refine((file) => file !== null, "Select a current workbook."),
  currentFiles: z.array(workbookFileSchema).max(8, "You can select up to 8 current workbooks.").optional(),
  comment_name: z.string().trim().max(200, "Prompt must contain at most 200 characters.").optional().default(""),
  outputHeader: z.string().trim().optional().default(""),
  addColumn: z.boolean().optional().default(false),
  standardize: z.boolean().optional().default(false),
  update: z.boolean().optional().default(false),
  mainFile: workbookFileSchema.nullable().optional(),
}).superRefine((values, context) => {
  if ((values.standardize || values.update) && !values.mainFile) {
    context.addIssue({ code: "custom", path: ["mainFile"], message: "Select a main workbook for standardization or updates." });
  }
});
```

- [ ] **Step 2: Add `addColumn` to defaults in create-job-page.tsx**

In `frontend/src/pages/create-job-page.tsx` line 15, update defaults:

```ts
const defaults: JobFormInput = { currentFile: null, currentFiles: [], mainFile: null, comment_name: "", outputHeader: "", addColumn: false, standardize: false, update: false };
```

- [ ] **Step 3: Run tests to verify no regressions**

```
cd frontend && npx vitest run src/tests/create-job.test.tsx
```

Expected: existing tests pass (none reference `addColumn` yet).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/schemas/job-creation.ts frontend/src/pages/create-job-page.tsx
git commit -m "feat: add addColumn field to job creation schema"
```

---

### Task 2: Rename WorkflowSteps labels

**Files:**
- Modify: `frontend/src/components/job/workflow-steps.tsx`

- [ ] **Step 1: Replace step definitions**

Replace the entire `steps` array in `frontend/src/components/job/workflow-steps.tsx`:

```ts
import { Check, FileUp, ListChecks, Settings2 } from "lucide-react";

const steps = [
  { label: "Set up", detail: "Choose tasks & files", icon: Settings2 },
  { label: "Upload", detail: "Transfer & verify", icon: FileUp },
  { label: "Review", detail: "Approve & download", icon: ListChecks },
];
```

- [ ] **Step 2: Run tests**

```
cd frontend && npx vitest run src/tests/create-job.test.tsx
```

Expected: the test `expect(container.querySelector('[aria-label="Job setup steps"] [aria-current="step"]')?.textContent).toContain("Configure job")` will now FAIL with "Set up" mismatch — this is expected; it will be fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/job/workflow-steps.tsx
git commit -m "feat: rename workflow step labels to plain English"
```

---

### Task 3: Rename button text in JobFormActions and copy in pickers

**Files:**
- Modify: `frontend/src/components/job/job-form-actions.tsx`
- Modify: `frontend/src/components/job/current-workbook-picker.tsx`
- Modify: `frontend/src/components/job/workbook-file-picker.tsx`

- [ ] **Step 1: Update JobFormActions**

Replace the full content of `frontend/src/components/job/job-form-actions.tsx`:

```tsx
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JobFormActions({ canStart, onReset, missingRequirements }: { canStart: boolean; onReset: () => void; missingRequirements?: string }) {
  return <div className="builder-actions">
    <p id="workflow-action-hint" className="builder-action-hint">{missingRequirements || "Ready to upload. Next, choose your worksheet and confirm its headers."}</p>
    <div className="builder-action-buttons">
      <Button type="button" variant="ghost" onClick={onReset}>Reset</Button>
      <Button type="submit" disabled={!canStart} aria-describedby="workflow-action-hint">Upload files<ArrowRight aria-hidden="true" /></Button>
    </div>
  </div>;
}
```

- [ ] **Step 2: Update CurrentWorkbookPicker visible strings**

In `frontend/src/components/job/current-workbook-picker.tsx`, make these replacements:

Line 75 — aria-label:
```tsx
aria-label="Your files"
```

Line 92-93 — visible text in the dropzone header:
```tsx
<p className="text-sm font-medium">{dragging ? "Drop your Excel files here" : "Drop your Excel files here"}</p>
<p className="mt-1 text-xs text-muted-foreground">.xlsx · Max 25 MB each · Up to {MAX_CURRENT_FILES} files</p>
```

Line 94 — browse button aria-label:
```tsx
<Button ref={browseButton} type="button" variant="outline" size="sm" onClick={() => input.current?.click()} aria-label="Browse files"><FolderOpen aria-hidden="true" />Browse</Button>
```

Line 99 — file list label:
```tsx
<div className="mt-3 space-y-2" role="list" aria-label="Selected files">
```

Line 104 — hint text:
```tsx
<p id={`${id}-hint`} className="mt-2 text-[11px] text-muted-foreground">Select one or more XLSX files. The first file is the primary workbook; all selected files are uploaded with the job.</p>
```

- [ ] **Step 3: Update WorkbookFilePicker strings for master file context**

In `frontend/src/components/job/workbook-file-picker.tsx`, update the empty-state visible text (lines 111-113):

```tsx
<p className="text-sm font-medium">{dragging ? "Drop your master file here" : "Drop your master file here"}</p>
<p className="mt-1 text-xs text-muted-foreground">.xlsx · Max 25 MB</p>
```

- [ ] **Step 4: Run tests**

```
cd frontend && npx vitest run src/tests/create-job.test.tsx
```

Expected: tests checking "Upload workbooks", "Reset form", "Browse current workbooks", "Browse main workbook" aria-labels will now fail — fixed in Task 5.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/job/job-form-actions.tsx frontend/src/components/job/current-workbook-picker.tsx frontend/src/components/job/workbook-file-picker.tsx
git commit -m "feat: rename UI copy to plain English (upload files, reset, browse)"
```

---

### Task 4: Restructure create-job-page.tsx

**Files:**
- Modify: `frontend/src/pages/create-job-page.tsx`

This task replaces the page body. The full new file:

- [ ] **Step 1: Write the new create-job-page.tsx**

Replace `frontend/src/pages/create-job-page.tsx` with:

```tsx
import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "@/auth/context";
import { ConnectedCreateFlow } from "@/components/job/connected-create-flow";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Columns2, ArrowLeftRight, RefreshCw } from "lucide-react";
import { WorkflowSteps } from "@/components/job/workflow-steps";
import { JobFormActions } from "@/components/job/job-form-actions";
import { CurrentWorkbookPicker } from "@/components/job/current-workbook-picker";
import { WorkbookFilePicker } from "@/components/job/workbook-file-picker";
import { LargeFileWarning } from "@/components/job/large-file-warning";
import { jobCreationSchema, type JobFormInput, type JobFormValues } from "@/schemas/job-creation";

const defaults: JobFormInput = { currentFile: null, currentFiles: [], mainFile: null, comment_name: "", outputHeader: "", addColumn: false, standardize: false, update: false };

export function CreateJobPage() {
  const auth = useContext(AuthContext);
  const [integrationLocked, setIntegrationLocked] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const { register, watch, reset, handleSubmit, setValue, formState: { errors } } = useForm<JobFormInput, unknown, JobFormValues>({
    defaultValues: defaults, resolver: zodResolver(jobCreationSchema), mode: "onTouched",
  });
  const values = watch();
  const { outputHeader, currentFile, currentFiles = [], mainFile } = values;
  const addColumn = values.addColumn ?? false;
  const standardize = values.standardize ?? false;
  const update = values.update ?? false;
  const createAction = useRef<(() => Promise<void>)>();
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [selectionErrors, setSelectionErrors] = useState<{ current: string | null; main: string | null }>({ current: null, main: null });
  const requiresMain = standardize || update;
  const noTaskSelected = !addColumn && !standardize && !update;
  const localFormValid = jobCreationSchema.safeParse(values).success && !selectionErrors.current && !selectionErrors.main && !noTaskSelected;

  const missing: string[] = [];
  if (noTaskSelected) missing.push("a task above");
  if (!currentFile) missing.push("your file");
  if (requiresMain && !mainFile) missing.push("a master file");
  const missingRequirements = missing.length
    ? `Add ${missing.join(" and ")} to continue.`
    : !localFormValid ? "Resolve the highlighted errors to continue." : undefined;

  function changeFile(field: "currentFile" | "mainFile", file: File | null) {
    setValue(field, file, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setSelectionErrors((previous) => ({ ...previous, [field === "currentFile" ? "current" : "main"]: null }));
  }

  function changeCurrentFiles(files: File[]) {
    setValue("currentFiles", files, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setValue("currentFile", files[0] ?? null, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setSelectionErrors((previous) => ({ ...previous, current: null }));
  }

  useEffect(() => {
    if (!requiresMain) {
      setValue("mainFile", null, { shouldValidate: true });
      setSelectionErrors((previous) => previous.main ? { ...previous, main: null } : previous);
    }
  }, [requiresMain, setValue]);

  function resetForm() {
    reset(defaults);
    setSelectionErrors({ current: null, main: null });
    setResetVersion((version) => version + 1);
  }

  // Compute visible sections in order with their labels
  const sections: Array<{ id: string; label: string; flag?: string; content: React.ReactNode }> = [];

  sections.push({
    id: "your-file",
    label: "Your file",
    flag: "Required",
    content: (
      <CurrentWorkbookPicker
        key={`current-${resetVersion}`}
        id="current-file"
        files={currentFiles}
        onChange={changeCurrentFiles}
        validationError={errors.currentFile?.message}
        onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, current: message }))}
      />
    ),
  });

  if (requiresMain) {
    sections.push({
      id: "master-file",
      label: "Master file",
      flag: "Required",
      content: (
        <WorkbookFilePicker
          key={`main-${resetVersion}`}
          id="main-file"
          label="Master file"
          file={mainFile ?? null}
          onChange={(file) => changeFile("mainFile", file)}
          validationError={errors.mainFile?.message}
          onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, main: message }))}
        />
      ),
    });
  }

  if (addColumn) {
    sections.push({
      id: "what-to-add",
      label: "What to add",
      flag: "Optional",
      content: (
        <>
          <label htmlFor="prompt" className="field-label">What should the new column contain?</label>
          <textarea
            id="prompt"
            {...register("comment_name")}
            aria-invalid={Boolean(errors.comment_name)}
            aria-describedby={errors.comment_name ? "prompt-error" : "prompt-hint"}
            rows={3}
            className="field-control instruction-field"
            placeholder="For example, calculate Profit as Revenue minus Cost."
          />
          {errors.comment_name
            ? <p id="prompt-error" role="alert" className="field-error">{errors.comment_name.message}</p>
            : <p id="prompt-hint" className="field-hint">Use your actual column names. Up to 200 characters.</p>}
          <div className="output-header-field">
            <label htmlFor="output-header" className="field-label">Column name <span className="field-label-optional">(optional)</span></label>
            <input
              id="output-header"
              {...register("outputHeader")}
              aria-invalid={Boolean(errors.outputHeader)}
              className="field-control field-mono"
              aria-describedby={errors.outputHeader ? "output-header-error" : "output-header-hint"}
              placeholder="e.g. Profit"
            />
            {errors.outputHeader
              ? <p id="output-header-error" role="alert" className="field-error">{errors.outputHeader.message}</p>
              : <p id="output-header-hint" className="field-hint">Leave blank and we'll name it from your description above.</p>}
          </div>
          {update && <p role="note" className="update-note">Unmatched current rows are skipped and reported, not inserted automatically.</p>}
        </>
      ),
    });
  }

  const sectionLetters = "ABCDEFGH";

  return (
    <section aria-labelledby="page-title" className="engagement">
      <header className="engagement-masthead">
        <h1 id="page-title" className="page-title">New job</h1>
        <p className="page-description">Choose what you want to do, attach your file, and start the review.</p>
        <WorkflowSteps current={setupStep} />
      </header>
      <form noValidate onSubmit={handleSubmit(() => { if (localFormValid && backendAvailable) void createAction.current?.(); })} className="workflow-builder">
        <details open={!integrationLocked}>
          <summary hidden={!integrationLocked} className="configuration-summary">
            Submitted job<span className="text-xs font-normal text-muted-foreground">View submitted details</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </summary>
          <fieldset disabled={integrationLocked} className="builder-fieldset">
            <legend className="sr-only">Job details</legend>

            {/* Task card selector */}
            <div className="task-selector" role="group" aria-labelledby="task-selector-label">
              <p id="task-selector-label" className="task-selector-label">What do you want to do? <span aria-hidden="true" className="task-selector-required">*</span></p>
              <div className="task-cards">
                <label className="task-card">
                  <input type="checkbox" {...register("addColumn")} aria-describedby="task-add-column-desc" />
                  <span className="task-card-icon" aria-hidden="true"><Columns2 /></span>
                  <span className="task-card-title">Add a column</span>
                  <span id="task-add-column-desc" className="task-card-desc">Use AI to calculate or fill in new data for every row.</span>
                </label>
                <label className="task-card">
                  <input type="checkbox" {...register("standardize")} aria-describedby="task-standardize-desc" />
                  <span className="task-card-icon" aria-hidden="true"><ArrowLeftRight /></span>
                  <span className="task-card-title">Standardize my file</span>
                  <span id="task-standardize-desc" className="task-card-desc">Align headers and values to match a master file.</span>
                </label>
                <label className="task-card">
                  <input type="checkbox" {...register("update")} aria-describedby="task-update-desc" />
                  <span className="task-card-icon" aria-hidden="true"><RefreshCw /></span>
                  <span className="task-card-title">Update master file</span>
                  <span id="task-update-desc" className="task-card-desc">Push approved values from your file back to the master.</span>
                </label>
              </div>
            </div>

            {/* Dynamic sections */}
            {sections.map(({ id, label, flag, content }, index) => (
              <section key={id} aria-labelledby={`li-${id}-title`} className="ledger-item">
                <span className="ledger-ref" aria-hidden="true">{sectionLetters[index]}</span>
                <div className="ledger-main">
                  <div className="ledger-head">
                    <h2 id={`li-${id}-title`} className="ledger-label">{label}</h2>
                    {flag && <span className="ledger-flag">{flag}</span>}
                  </div>
                  <div className="ledger-body">{content}</div>
                </div>
              </section>
            ))}

            <LargeFileWarning />
            {!integrationLocked && (
              <JobFormActions
                canStart={Boolean(localFormValid) && backendAvailable}
                onReset={resetForm}
                missingRequirements={missingRequirements}
              />
            )}
          </fieldset>
        </details>
      </form>
      {auth && (
        <ConnectedCreateFlow
          configuration={values}
          canCreate={Boolean(localFormValid)}
          onLockedChange={setIntegrationLocked}
          actionRef={createAction}
          onAvailabilityChange={setBackendAvailable}
          onStageChange={setSetupStep}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 2: Run tests to see what breaks**

```
cd frontend && npx vitest run src/tests/create-job.test.tsx
```

Note which tests fail — these are updated in Task 5.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/create-job-page.tsx
git commit -m "feat: restructure create-job page with task cards and plain-English sections"
```

---

### Task 5: Add task-card CSS to index.css

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add task-card styles**

Find the `.processing-card` block (around line 208) in `frontend/src/index.css`. Replace the entire `.processing-card` block and add task-card styles after it:

```css
  /* Task card selector — replaces old processing-card checkboxes */
  .task-selector { margin-bottom: 8px; padding: 20px 0 4px; border-bottom: 1px solid var(--border); }
  .task-selector-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--muted-foreground); margin-bottom: 12px; }
  .task-selector-required { color: var(--destructive); }
  .task-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .task-card { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto auto; gap: 4px 10px; align-items: start; padding: 14px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--card); cursor: pointer; transition: border-color 150ms ease, background-color 150ms ease; }
  .task-card input[type="checkbox"] { grid-column: 2; grid-row: 1; justify-self: end; margin-top: 2px; }
  .task-card-icon { grid-column: 1; grid-row: 1 / 3; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; background: var(--muted); color: var(--muted-foreground); }
  .task-card-icon > svg { width: 15px; height: 15px; }
  .task-card-title { grid-column: 2; grid-row: 1; font-size: 13px; font-weight: 600; padding-right: 24px; }
  .task-card-desc { grid-column: 1 / -1; grid-row: 3; font-size: 12px; color: var(--muted-foreground); line-height: 1.45; margin-top: 6px; }
  .task-card:has(input:checked) { border-color: var(--workflow-accent); background: var(--success-surface); }
  .task-card:has(input:checked) .task-card-icon { background: var(--workflow-accent); color: var(--primary-foreground); }
  .task-card:has(input:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
  .field-label-optional { font-weight: 400; color: var(--muted-foreground); font-size: 12px; }
```

- [ ] **Step 2: Remove dead CSS rules**

Remove these blocks from `index.css` (they're no longer rendered):
- `.processing-card`, `.processing-card > input`, `.processing-card:has(...)`, `.processing-card:has(input:focus-visible)` (lines ~208-211)
- `.engagement-note` and `.engagement-note .output-outline-facts`, `.engagement-note .output-outline-heading` (lines ~560-562)
- `.output-outline`, `.output-outline-heading`, `.output-outline-heading > svg`, `.output-outline-facts`, `.output-outline-facts > div` (lines ~215-221)
- `.output-policy-disclosure` and its children (lines ~224-229)

Leave `.update-note` in place (it's still used in the "What to add" section when `update` is true).

- [ ] **Step 3: Run the app and take a screenshot**

```
BASE=http://localhost:5175 node .impeccable/shoot.mjs "/jobs/new::review/create-redesign.png" 1440
```

Visually verify: three task cards appear at top, section A "Your file" below, action bar at bottom. No "Engagement" heading, no "Prepared output" card.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add task-card CSS; remove dead processing-card and output-outline styles"
```

---

### Task 6: Update tests

**Files:**
- Modify: `frontend/src/tests/create-job.test.tsx`

The following changes are needed. All others (file picker internals, aria-invalid, schema validation) continue to work unchanged.

- [ ] **Step 1: Add helper to click task cards**

After the existing helpers (`selectFile`, `enterPrompt`, `enterHeader`), add:

```tsx
async function selectTask(name: "addColumn" | "standardize" | "update") {
  await act(async () => { get<HTMLInputElement>(`input[name="${name}"]`).click(); });
}
```

- [ ] **Step 2: Update step label assertion**

Find: `expect(container.querySelector('[aria-label="Job setup steps"] [aria-current="step"]')?.textContent).toContain("Configure job");`

Replace with:
```tsx
expect(container.querySelector('[aria-label="Job setup steps"] [aria-current="step"]')?.textContent).toContain("Set up");
```

- [ ] **Step 3: Update button text assertions**

Find all: `"Upload workbooks"` → replace with `"Upload files"`
Find all: `"Reset form"` → replace with `"Reset"`

- [ ] **Step 4: Update browse aria-label assertions**

Find: `'[aria-label="Browse current workbooks"]'` → replace with `'[aria-label="Browse files"]'`
Find: `'[aria-label="Browse main workbook"]'` → replace with `'[aria-label="Browse master file"]'`
Find: `'[aria-label="Remove main workbook"]'` → replace with `'[aria-label="Remove master file"]'`

- [ ] **Step 5: Replace output-policy tests with task-card tests**

Remove or replace tests that reference `[aria-labelledby="output-policy-title"]` (the removed engagement-note section). Replace with tests that verify the task cards control section visibility:

```tsx
it("shows master file section only when standardize or update is selected", async () => {
  expect(container.querySelector("#main-file")).toBeNull();
  await selectTask("standardize");
  expect(container.querySelector("#main-file")).not.toBeNull();
  await selectTask("standardize"); // deselect
  expect(container.querySelector("#main-file")).toBeNull();
  await selectTask("update");
  expect(container.querySelector("#main-file")).not.toBeNull();
  await selectTask("update"); // deselect
  expect(container.querySelector("#main-file")).toBeNull();
});

it("shows what-to-add section only when addColumn is selected", async () => {
  expect(container.querySelector("#prompt")).toBeNull();
  await selectTask("addColumn");
  expect(container.querySelector("#prompt")).not.toBeNull();
  await selectTask("addColumn"); // deselect
  expect(container.querySelector("#prompt")).toBeNull();
});

it("blocks submit when no task is selected", async () => {
  await selectFile("current-file", "current.xlsx");
  expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
  expect(container.textContent).toContain("a task above");
  await selectTask("addColumn");
  expect(container.textContent).not.toContain("a task above");
});
```

- [ ] **Step 6: Update "clears the master workbook" test to use selectTask**

Find: `await click('input[name="standardize"]')` and `await click('input[name="update"]')` in tests that previously clicked the Procedures checkboxes. Replace with `await selectTask("standardize")` / `await selectTask("update")` (the helper does the same thing, just named clearly).

- [ ] **Step 7: Run all tests and confirm green**

```
cd frontend && npx vitest run src/tests/create-job.test.tsx
```

Expected: all tests pass.

- [ ] **Step 8: Run the full test suite**

```
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/tests/create-job.test.tsx
git commit -m "test: update create-job tests for task cards and renamed copy"
```

---

### Task 7: Final screenshot verification

- [ ] **Step 1: Screenshot the default state**

```
BASE=http://localhost:5175 node .impeccable/shoot.mjs "/jobs/new::review/create-final.png" 1440
```

Verify: "New job" heading, three task cards, "Your file" section, "Upload files" button. No "Engagement", no "Prepared output", no "Your originals are never changed."

- [ ] **Step 2: Compare against mockup**

Open `review/mockup-a2.png` alongside `review/create-final.png`. The layout should match the approved mockup.
