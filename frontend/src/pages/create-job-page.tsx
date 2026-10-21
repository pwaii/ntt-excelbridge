import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "@/auth/context";
import { ConnectedCreateFlow } from "@/components/job/connected-create-flow";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightLeft, Check, ChevronDown, FileText, Layers3, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { WorkflowSteps } from "@/components/job/workflow-steps";
import { FormSection } from "@/components/job/form-section";
import { JobFormActions } from "@/components/job/job-form-actions";
import { WorkbookFilePicker } from "@/components/job/workbook-file-picker";
import { LargeFileWarning } from "@/components/job/large-file-warning";
import { jobCreationSchema, type JobFormInput, type JobFormValues } from "@/schemas/job-creation";
import { getOutputPolicy, outputPolicies } from "@/lib/output-policy";

const defaults: JobFormInput = { currentFile: null, mainFile: null, comment_name: "", outputHeader: "", standardize: false, update: false };
const fieldClass = "field-control";

export function CreateJobPage() {
  const auth = useContext(AuthContext);
  const [integrationLocked, setIntegrationLocked] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const { register, watch, reset, handleSubmit, setValue, setFocus, formState: { errors } } = useForm<JobFormInput, unknown, JobFormValues>({
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
  const missing = [!currentFile && "a current workbook", !comment_name.trim() && "a column prompt", !outputHeader.trim() && "an output header", requiresMain && !mainFile && "a master workbook"].filter(Boolean);
  const missingRequirements = missing.length ? `Add ${missing.join(" and ")} to continue.` : !localFormValid ? "Resolve the highlighted file or field errors to continue." : undefined;

  function changeFile(field: "currentFile" | "mainFile", file: File | null) {
    setValue(field, file, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setSelectionErrors((previous) => ({ ...previous, [field === "currentFile" ? "current" : "main"]: null }));
  }

  function changeCurrentFiles(files: File[]) {
    setValue("currentFiles", files, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setValue("currentFile", files[0] ?? null, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setCurrentHeader(null);
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
    <section aria-labelledby="page-title" className="mx-auto w-full max-w-4xl">
      <PageHeader title="Create workflow" description="Upload your workbook, define the changes, then review and approve the results." />
      <WorkflowSteps current={setupStep} />
      <form noValidate onSubmit={handleSubmit(() => { if (localFormValid && backendAvailable) void createAction.current?.(); })} className="workflow-builder min-w-0 rounded-lg border bg-card">
        <details open={!integrationLocked}>
        <summary hidden={!integrationLocked} className="configuration-summary">Job configuration<span className="text-xs font-normal text-muted-foreground">View submitted settings</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" /></summary>
        <fieldset disabled={integrationLocked} className="min-w-0">
        <legend className="sr-only">Job configuration</legend>
        <div className="divide-y">
          <FormSection id="current-workbook" title="Current workbook" required>
            <CurrentWorkbookPicker key={`current-${resetVersion}`} id="current-file" files={currentFiles} onChange={changeCurrentFiles} validationError={errors.currentFile?.message} onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, current: message }))} />
          </FormSection>
          <FormSection id="output-configuration" title="Column to add" required>
            <div className="ai-composer overflow-hidden rounded-md">
              <div className="flex items-center gap-2 px-3.5 pt-3 text-xs font-medium text-muted-foreground"><FileText className="size-3.5" aria-hidden="true" />Column prompt</div>
              <label htmlFor="prompt" className="sr-only">Prompt (required)</label>
              <textarea id="prompt" {...register("comment_name")} required aria-invalid={Boolean(errors.comment_name)} aria-describedby={errors.comment_name ? "prompt-error" : "prompt-hint"} rows={2} className="block min-h-16 w-full resize-y bg-transparent px-3.5 py-2 text-base leading-relaxed tracking-tight placeholder:text-muted-foreground/80 focus-visible:outline-none" placeholder="What column would you like to add?" />
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5" role="group" aria-label="Example column prompts">
                {["Profit", "Growth Rate", "Net Revenue", "Profit Margin"].map((example) => (
                  <button key={example} type="button" aria-pressed={comment_name.trim() === example} className="rounded-md border border-primary/20 bg-background/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-primary aria-pressed:border-primary/50 aria-pressed:bg-accent aria-pressed:text-primary motion-reduce:transition-none" onClick={() => { setValue("comment_name", example, { shouldDirty: true, shouldValidate: true }); setFocus("comment_name"); }}>{example}</button>
                ))}
              </div>
            </div>
            {errors.comment_name ? <p id="prompt-error" role="alert" className="mt-2 text-xs text-destructive">{errors.comment_name.message}</p> : <p id="prompt-hint" className="mt-2 text-xs text-muted-foreground">Describe the column or calculation you need. Up to 200 characters.</p>}
            <div className="mt-4">
              <label htmlFor="output-header" className="mb-1.5 block text-xs font-medium">Output column header <span className="text-primary" aria-hidden="true">*</span></label>
              <input id="output-header" {...register("outputHeader")} required aria-invalid={Boolean(errors.outputHeader)} className={fieldClass} aria-describedby={errors.outputHeader ? "output-header-error" : "output-header-hint"} placeholder="Exact name for the new column" />
              {errors.outputHeader ? <p id="output-header-error" role="alert" className="mt-2 text-xs text-destructive">{errors.outputHeader.message}</p> : <p id="output-header-hint" className="mt-1.5 text-xs text-muted-foreground">Required. This is the exact column name in your output.</p>}
            </div>
          </FormSection>
          <FormSection id="processing-options" title="Processing">
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Select processing operations</legend>
              {([
                { name: "standardize", title: "Standardize data", hint: "Align headers and values to your master.", icon: Layers3 },
                { name: "update", title: "Update using master workbook", hint: "Merge approved values into matched rows.", icon: ArrowRightLeft },
              ] as const).map(({ name, title, hint, icon: Icon }) => (
                <label key={name} className={`processing-card flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors duration-150 motion-reduce:transition-none ${watch(name) ? "border-primary bg-accent/60" : "hover:border-input hover:bg-muted/50"}`}>
                  <input type="checkbox" {...register(name)} className="sr-only" aria-describedby={`${name}-hint`} />
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${watch(name) ? "text-primary" : "text-muted-foreground"}`}><Icon className="size-4" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm leading-snug font-medium">{title}</span><span id={`${name}-hint`} className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span></span>
                  <span aria-hidden="true" className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border ${watch(name) ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>{watch(name) && <Check className="size-3" />}</span>
                </label>
              ))}
            </fieldset>
            {requiresMain && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label htmlFor="main-file" className="text-sm font-medium">Master workbook <span className="text-destructive" aria-hidden="true">*</span></label>
                  <span className="text-xs text-muted-foreground">Required for {standardize && update ? "standardization and updates" : standardize ? "standardization" : "updates"}</span>
                </div>
                <WorkbookFilePicker key={`main-${resetVersion}`} id="main-file" label="Master workbook" file={mainFile ?? null} onChange={(file) => changeFile("mainFile", file)} validationError={errors.mainFile?.message} onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, main: message }))} />
              </div>
            )}
          </FormSection>
          <details className="workflow-disclosure group" id="advanced-settings">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium transition-colors hover:bg-muted/60 sm:px-6 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
              Worksheet settings
              <span className="ml-auto hidden text-xs font-normal text-muted-foreground sm:inline">Sheets, headers &amp; matching</span>
            </summary>
            <div className="space-y-4 px-5 pb-5 pt-1 sm:px-6">

              <p className="text-sm text-muted-foreground">Worksheet selection becomes available after upload. You will confirm the header row before processing starts.</p>
              <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
                <li>Select a worksheet from the uploaded current workbook{requiresMain ? " and master workbook" : ""}.</li>
                <li>Check the detected header row and confirm or correct it.</li>
                {update && <li>Choose the key columns used to match rows between workbooks.</li>}
              </ul>
              <p id="metadata-hint" className="text-xs text-muted-foreground">No workbook has been inspected. Awaiting workbook metadata after upload.</p>
            </div>
          </details>
        </div>
        <section aria-labelledby="output-policy-title" className="border-t px-4 py-3 sm:px-5">
          <h2 id="output-policy-title" className="sr-only">Output policy</h2>
          <div aria-live="polite" aria-atomic="true">
            <details className="workflow-disclosure group">
              <summary className="flex min-h-6 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs [&::-webkit-details-marker]:hidden">
                <span className="text-muted-foreground">Output policy</span>
                <span className="inline-flex items-center gap-2 font-medium text-primary">{policy.title}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></span>
              </summary>
              <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>{policy.description}</p>
                <p>Output: {update ? "Master workbook copy" : "Current workbook copy"}. Source: Preserved.</p>
              </div>
            </details>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />Approval required before changes are applied.</p>
        </section>
        {update && <p role="note" className="border-t px-4 py-3 text-xs leading-relaxed text-[#96521e] sm:px-5">Unmatched current rows are skipped and reported. They are not inserted automatically. The original main workbook remains unchanged.</p>}
        <LargeFileWarning />
        <p id="real-job-readiness" className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">After upload, select the worksheet and confirm its header row before starting. No workbook has been inspected yet.</p>
        {!integrationLocked && <JobFormActions canStart={Boolean(localFormValid) && backendAvailable} onReset={resetForm} missingRequirements={missingRequirements} />}
        </fieldset>
        </details>
      </form>
      {auth && <ConnectedCreateFlow configuration={values} canCreate={Boolean(localFormValid)} onLockedChange={setIntegrationLocked} actionRef={createAction} onAvailabilityChange={setBackendAvailable} onStageChange={setSetupStep} />}
    </section>
  );
}
