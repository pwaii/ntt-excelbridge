import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "@/auth/context";
import { ConnectedCreateFlow } from "@/components/job/connected-create-flow";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, ChevronDown, GitCompareArrows } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { WorkflowSteps } from "@/components/job/workflow-steps";
import { FormSection } from "@/components/job/form-section";
import { JobFormActions } from "@/components/job/job-form-actions";
import { CurrentWorkbookPicker } from "@/components/job/current-workbook-picker";
import { WorkbookFilePicker } from "@/components/job/workbook-file-picker";
import { LargeFileWarning } from "@/components/job/large-file-warning";
import { jobCreationSchema, type JobFormInput, type JobFormValues } from "@/schemas/job-creation";
import { getOutputPolicy, outputPolicies } from "@/lib/output-policy";

const defaults: JobFormInput = { currentFile: null, currentFiles: [], mainFile: null, comment_name: "", outputHeader: "", standardize: false, update: false };
const fieldClass = "field-control";

export function CreateJobPage() {
  const auth = useContext(AuthContext);
  const [integrationLocked, setIntegrationLocked] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const { register, watch, reset, handleSubmit, setValue, formState: { errors } } = useForm<JobFormInput, unknown, JobFormValues>({
    defaultValues: defaults, resolver: zodResolver(jobCreationSchema), mode: "onTouched",
  });
  const values = watch();
  const { comment_name, outputHeader, currentFile, currentFiles = [], mainFile } = values;
  const standardize = values.standardize ?? false;
  const update = values.update ?? false;
  const createAction = useRef<(() => Promise<void>)>();
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [selectionErrors, setSelectionErrors] = useState<{ current: string | null; main: string | null }>({ current: null, main: null });
  const requiresMain = standardize || update;
  const policy = outputPolicies[getOutputPolicy(standardize, update)];
  const localFormValid = jobCreationSchema.safeParse(values).success && !selectionErrors.current && !selectionErrors.main;
  const missing = [!currentFile && "a current workbook", requiresMain && !mainFile && "a main workbook"].filter(Boolean);
  const missingRequirements = missing.length ? `Add ${missing.join(" and ")} to continue.` : !localFormValid ? "Resolve the highlighted file or field errors to continue." : undefined;

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
    <section aria-labelledby="page-title" className="setup-page">
      <PageHeader title="Create workflow" description="Turn your workbook instructions into changes you can review." />
      <WorkflowSteps current={setupStep} />
      <form noValidate onSubmit={handleSubmit(() => { if (localFormValid && backendAvailable) void createAction.current?.(); })} className="workflow-builder">
        <details open={!integrationLocked}>
          <summary hidden={!integrationLocked} className="configuration-summary">Upload settings<span className="text-xs font-normal text-muted-foreground">View submitted settings</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" /></summary>
          <fieldset disabled={integrationLocked} className="builder-fieldset">
            <legend className="sr-only">Job configuration</legend>
            <div className="builder-grid">
              <div className="builder-fields">
                <FormSection id="current-workbook" title={currentFiles.length > 1 ? `Current workbooks (${currentFiles.length})` : "Current workbook"} required>
                  <CurrentWorkbookPicker key={`current-${resetVersion}`} id="current-file" files={currentFiles} onChange={changeCurrentFiles} validationError={errors.currentFile?.message} onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, current: message }))} />
                </FormSection>
                <FormSection id="output-configuration" title="Column to add">
                  <label htmlFor="prompt" className="field-label">What should the new column calculate or contain?</label>
                  <textarea id="prompt" {...register("comment_name")} aria-invalid={Boolean(errors.comment_name)} aria-describedby={errors.comment_name ? "prompt-error" : "prompt-hint"} rows={3} className="field-control instruction-field" placeholder="For example, calculate Profit as Revenue minus Cost." />
                  {errors.comment_name ? <p id="prompt-error" role="alert" className="field-error">{errors.comment_name.message}</p> : <p id="prompt-hint" className="field-hint">Optional. Use the column names in your workbook. Include the calculation or rule. Up to 200 characters.</p>}
                  <div className="output-header-field">
                    <label htmlFor="output-header" className="field-label">Output column header</label>
                    <input id="output-header" {...register("outputHeader")} aria-invalid={Boolean(errors.outputHeader)} className={fieldClass} aria-describedby={errors.outputHeader ? "output-header-error" : "output-header-hint"} placeholder="For example, Profit" />
                    {errors.outputHeader ? <p id="output-header-error" role="alert" className="field-error">{errors.outputHeader.message}</p> : <p id="output-header-hint" className="field-hint">Optional. If blank, the column name is derived from your prompt above.</p>}
                  </div>
                </FormSection>
              </div>
              <aside className="builder-options" aria-label="Processing and output">
                <FormSection id="processing-options" title="Optional processing">
                  <fieldset className="processing-options">
                    <legend className="sr-only">Select processing operations</legend>
                    {([
                      { name: "standardize", title: "Standardize data", hint: "Align headers and values with your main workbook." },
                      { name: "update", title: "Update main workbook", hint: "Apply approved current values to matching main rows." },
                    ] as const).map(({ name, title, hint }) => (
                      <label key={name} className="processing-card">
                        <input type="checkbox" {...register(name)} aria-describedby={`${name}-hint`} />
                        <span><span className="processing-title">{title}</span><span id={`${name}-hint`} className="processing-hint">{hint}</span></span>
                      </label>
                    ))}
                  </fieldset>
                  {requiresMain && <div className="main-workbook-field">
                    <label htmlFor="main-file" className="field-label">Main workbook <span className="required-marker" aria-hidden="true">*</span></label>
                    <WorkbookFilePicker key={`main-${resetVersion}`} id="main-file" label="Main workbook" file={mainFile ?? null} onChange={(file) => changeFile("mainFile", file)} validationError={errors.mainFile?.message} onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, main: message }))} />
                  </div>}
                </FormSection>
                <section aria-labelledby="output-policy-title" className="output-outline">
                  <div className="output-outline-heading"><GitCompareArrows aria-hidden="true" /><h2 id="output-policy-title">Your output</h2></div>
                  <dl className="output-outline-facts">
                    <div><dt>Based on</dt><dd>{update ? mainFile?.name || "Choose a main workbook" : currentFiles.length > 1 ? `${currentFiles.length} current workbooks` : currentFile?.name || "Choose a current workbook"}</dd></div>
                    <div><dt>New column</dt><dd>{outputHeader.trim() || "Name your output column"}</dd></div>
                  </dl>
                  <div className="output-path" aria-hidden="true"><span>Upload</span><ArrowRight /><span>Review</span><ArrowRight /><span>New copy</span></div>
                  <div aria-live="polite" aria-atomic="true"><details className="output-policy-disclosure"><summary>{policy.title}<ChevronDown aria-hidden="true" /></summary><p>{policy.description}</p></details></div>
                  <p className="output-assurance">You approve the changes before they are applied.</p>
                </section>
              </aside>
            </div>
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
