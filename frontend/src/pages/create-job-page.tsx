import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "@/auth/context";
import { ConnectedCreateFlow } from "@/components/job/connected-create-flow";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightLeft, Check, ChevronDown, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { FormSection } from "@/components/job/form-section";
import { JobFormActions } from "@/components/job/job-form-actions";
import { WorkbookFilePicker } from "@/components/job/workbook-file-picker";
import { HeaderRowConfirmation } from "@/components/job/header-row-confirmation";
import { LargeFileWarning } from "@/components/job/large-file-warning";
import { jobCreationSchema, type JobFormInput, type JobFormValues } from "@/schemas/job-creation";
import type { HeaderConfirmation } from "@/types/workbook";
import { getOutputPolicy, outputPolicies } from "@/lib/output-policy";

const defaults: JobFormInput = { currentFile: null, mainFile: null, comment_name: "", outputHeader: "", standardize: false, update: false };
const fieldClass = "w-full rounded-lg border bg-background/40 px-3 py-2.5 text-sm placeholder:text-muted-foreground/80 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function CreateJobPage() {
  const auth = useContext(AuthContext);
  const [integrationLocked, setIntegrationLocked] = useState(false);
  const { register, watch, reset, handleSubmit, setValue, setFocus, formState: { errors } } = useForm<JobFormInput, unknown, JobFormValues>({
    defaultValues: defaults, resolver: zodResolver(jobCreationSchema), mode: "onTouched",
  });
  const values = watch();
  const { comment_name, outputHeader, currentFile, mainFile } = values;
  const standardize = values.standardize ?? false;
  const update = values.update ?? false;
  const createAction = useRef<(() => Promise<void>)>();
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [selectionErrors, setSelectionErrors] = useState<{ current: string | null; main: string | null }>({ current: null, main: null });
  const [currentHeader, setCurrentHeader] = useState<HeaderConfirmation | null>(null);
  const [mainHeader, setMainHeader] = useState<HeaderConfirmation | null>(null);
  const requiresMain = standardize || update;
  const policy = outputPolicies[getOutputPolicy(standardize, update)];
  const localFormValid = jobCreationSchema.safeParse(values).success && !selectionErrors.current && !selectionErrors.main;
  const missing = [!currentFile && "a current workbook", !comment_name.trim() && "a column prompt", !outputHeader.trim() && "an output header", requiresMain && !mainFile && "a master workbook"].filter(Boolean);
  const missingRequirements = missing.length ? `Add ${missing.join(" and ")} to continue.` : !localFormValid ? "Resolve the highlighted file or field errors to continue." : undefined;

  function changeFile(field: "currentFile" | "mainFile", file: File | null) {
    setValue(field, file, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    if (field === "currentFile") setCurrentHeader(null); else setMainHeader(null);
    setSelectionErrors((previous) => ({ ...previous, [field === "currentFile" ? "current" : "main"]: null }));
  }

  useEffect(() => {
    if (!requiresMain) {
      setValue("mainFile", null, { shouldValidate: true });
      setSelectionErrors((previous) => previous.main ? { ...previous, main: null } : previous);
      setMainHeader(null);
    }
  }, [requiresMain, setValue]);

  function resetForm() {
    reset(defaults);
    setSelectionErrors({ current: null, main: null });
    setCurrentHeader(null);
    setMainHeader(null);
    setResetVersion((version) => version + 1);
  }

  return (
    <section aria-labelledby="page-title" className="mx-auto w-full max-w-[820px]">
      <header className="mb-5">
        <h1 id="page-title" className="text-2xl leading-tight font-semibold tracking-[-0.035em] sm:text-[28px]">Create <span className="workflow-title-accent">workflow</span></h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Choose a workbook and describe the column to add.</p>
      </header>
      <form noValidate onSubmit={handleSubmit(() => { if (localFormValid && backendAvailable) void createAction.current?.(); })} className="workflow-builder min-w-0 rounded-[20px] border bg-card">
        <fieldset disabled={integrationLocked} className="min-w-0">
        <legend className="sr-only">Job configuration</legend>
        <div className="divide-y">
          <FormSection id="current-workbook" title="Current workbook" required>
            <WorkbookFilePicker key={`current-${resetVersion}`} id="current-file" label="Current workbook" file={currentFile} onChange={(file) => changeFile("currentFile", file)} validationError={errors.currentFile?.message} onSelectionError={(message) => setSelectionErrors((previous) => ({ ...previous, current: message }))} />
          </FormSection>
          <FormSection id="output-configuration" title="Column to add" required>
            <div className="ai-composer overflow-hidden rounded-2xl">
              <div className="flex items-center gap-2 px-3.5 pt-2.5 text-xs font-medium text-[var(--workflow-violet)]"><Sparkles className="size-3.5" aria-hidden="true" />Column prompt</div>
              <label htmlFor="prompt" className="sr-only">Prompt (required)</label>
              <textarea id="prompt" {...register("comment_name")} required aria-invalid={Boolean(errors.comment_name)} aria-describedby={errors.comment_name ? "prompt-error" : "prompt-hint"} rows={2} className="block min-h-16 w-full resize-y bg-transparent px-3.5 py-2 text-base leading-relaxed tracking-tight placeholder:text-muted-foreground/80 focus-visible:outline-none" placeholder="What column would you like to add?" />
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5" role="group" aria-label="Example column prompts">
                {["Profit", "Growth Rate", "Net Revenue", "Profit Margin"].map((example) => (
                  <button key={example} type="button" aria-pressed={comment_name.trim() === example} className="rounded-md border border-primary/20 bg-background/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-primary aria-pressed:border-primary/50 aria-pressed:bg-accent aria-pressed:text-primary motion-reduce:transition-none" onClick={() => { setValue("comment_name", example, { shouldDirty: true, shouldValidate: true }); setFocus("comment_name"); }}>{example}</button>
                ))}
              </div>
            </div>
            {errors.comment_name ? <p id="prompt-error" role="alert" className="mt-2 text-xs text-destructive">{errors.comment_name.message}</p> : <p id="prompt-hint" className="mt-2 text-[11px] text-muted-foreground">A name or short instruction. Interpretation happens later.</p>}
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
                <label key={name} className={`processing-card flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none ${watch(name) ? "border-primary/55 bg-accent/60" : "hover:border-primary/40 hover:bg-muted/60"}`}>
                  <input type="checkbox" {...register(name)} className="sr-only" aria-describedby={`${name}-hint`} />
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${watch(name) ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><Icon className="size-3.5" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-xs leading-snug font-semibold">{title}</span><span id={`${name}-hint`} className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{hint}</span></span>
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
              Advanced settings
              <span className="ml-auto hidden text-xs font-normal text-muted-foreground sm:inline">Sheets, headers &amp; matching</span>
            </summary>
            <div className="space-y-4 px-5 pb-5 pt-1 sm:px-6">

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="source-sheet" className="mb-1.5 block text-xs font-medium">Source sheet</label>
                  <select id="source-sheet" disabled className={fieldClass} aria-describedby="metadata-hint"><option>Awaiting metadata</option></select>
                </div>
                {requiresMain && <div>
                  <label htmlFor="main-sheet" className="mb-1.5 block text-xs font-medium">Master sheet</label>
                  <select id="main-sheet" disabled className={fieldClass} aria-describedby="metadata-hint"><option>Awaiting metadata</option></select>
                </div>}
                <div>
                  <label htmlFor="key-column" className="mb-1.5 block text-xs font-medium">Business key column</label>
                  <select id="key-column" disabled className={fieldClass} aria-describedby="metadata-hint"><option>{update ? "Awaiting metadata" : "For update matching"}</option></select>
                </div>
              </div>
              <div className="space-y-3">
                <HeaderRowConfirmation id="current-header" label="Current workbook" confirmation={currentHeader} onChange={setCurrentHeader} />
                {requiresMain && <HeaderRowConfirmation id="main-header" label="Master workbook" confirmation={mainHeader} onChange={setMainHeader} />}
              </div>
              <p id="metadata-hint" className="text-xs text-muted-foreground">No workbook has been inspected. Sheet and key selection awaits backend metadata.</p>
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
      </form>
      {auth && <ConnectedCreateFlow configuration={values} canCreate={Boolean(localFormValid)} onLockedChange={setIntegrationLocked} actionRef={createAction} onAvailabilityChange={setBackendAvailable} />}
    </section>
  );
}
