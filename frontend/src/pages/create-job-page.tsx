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

  return (
    <section aria-labelledby="page-title" className="engagement">
      <header className="engagement-masthead">
        <h1 id="page-title" className="page-title">New job</h1>
        <p className="page-description">Choose what you want to do, attach your file, and start the review.</p>
        <WorkflowSteps current={setupStep} />
      </header>
      <form noValidate onSubmit={handleSubmit(() => { if (localFormValid && backendAvailable) void createAction.current?.(); })} className="workflow-builder">
        <details open={!integrationLocked}>
          <summary hidden={!integrationLocked} className="configuration-summary">Submitted job<span className="text-xs font-normal text-muted-foreground">View submitted details</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" /></summary>
          <fieldset disabled={integrationLocked} className="builder-fieldset">
            <legend className="sr-only">Job details</legend>

            <section aria-labelledby="li-your-file-title" className="ledger-item" style={{ borderBottom: "none" }}>
              <span className="ledger-ref" aria-hidden="true">A</span>
              <div className="ledger-main">
                <div className="ledger-head"><h2 id="li-your-file-title" className="ledger-label">Your file</h2><span className="ledger-flag">Required</span></div>
                <div className="ledger-body">
                  <CurrentWorkbookPicker key={`current-${resetVersion}`} id="current-file" files={currentFiles} onChange={changeCurrentFiles} validationError={errors.currentFile?.message} onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, current: message }))} />
                </div>
              </div>
            </section>

            <div className="ledger-item">
              <span aria-hidden="true" />
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
            </div>

            <section aria-labelledby="li-master-file-title" className="ledger-item">
              <span className="ledger-ref" aria-hidden="true">B</span>
              <div className="ledger-main">
                <div className="ledger-head"><h2 id="li-master-file-title" className="ledger-label">Master file</h2>{requiresMain && <span className="ledger-flag">Required</span>}</div>
                {requiresMain && (
                  <div className="ledger-body">
                    <WorkbookFilePicker key={`main-${resetVersion}`} id="main-file" label="Master file" file={mainFile ?? null} onChange={(file) => changeFile("mainFile", file)} validationError={errors.mainFile?.message} onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, main: message }))} />
                  </div>
                )}
              </div>
            </section>

            <section aria-labelledby="li-what-to-add-title" className="ledger-item">
              <span className="ledger-ref" aria-hidden="true">C</span>
              <div className="ledger-main">
                <div className="ledger-head"><h2 id="li-what-to-add-title" className="ledger-label">What to add</h2>{addColumn && <span className="ledger-flag">Optional</span>}</div>
                {addColumn && (
                  <div className="ledger-body">
                    <label htmlFor="prompt" className="field-label">What should the new column contain?</label>
                    <textarea id="prompt" {...register("comment_name")} aria-invalid={Boolean(errors.comment_name)} aria-describedby={errors.comment_name ? "prompt-error" : "prompt-hint"} rows={3} className="field-control instruction-field" placeholder="For example, calculate Profit as Revenue minus Cost." />
                    {errors.comment_name ? <p id="prompt-error" role="alert" className="field-error">{errors.comment_name.message}</p> : <p id="prompt-hint" className="field-hint">Use your actual column names. Up to 200 characters.</p>}
                    <div className="output-header-field">
                      <label htmlFor="output-header" className="field-label">Column name <span className="field-label-optional">(optional)</span></label>
                      <input id="output-header" {...register("outputHeader")} aria-invalid={Boolean(errors.outputHeader)} className="field-control field-mono" aria-describedby={errors.outputHeader ? "output-header-error" : "output-header-hint"} placeholder="e.g. Profit" />
                      {errors.outputHeader ? <p id="output-header-error" role="alert" className="field-error">{errors.outputHeader.message}</p> : <p id="output-header-hint" className="field-hint">Leave blank and we'll name it from your description above.</p>}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {update && <p role="note" className="update-note">Unmatched current rows are skipped and reported, not inserted automatically.</p>}

            <LargeFileWarning />
            {!integrationLocked && <JobFormActions canStart={Boolean(localFormValid) && backendAvailable} onReset={resetForm} missingRequirements={missingRequirements} />}
          </fieldset>
        </details>
      </form>
      {auth && <ConnectedCreateFlow configuration={values} canCreate={Boolean(localFormValid)} onLockedChange={setIntegrationLocked} actionRef={createAction} onAvailabilityChange={setBackendAvailable} onStageChange={setSetupStep} />}
    </section>
  );
}
