import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { ApiError } from "@/api/errors";
import type { BackendJob } from "@/api/jobs-api";
import { Button } from "@/components/ui/button";
import { WorkflowLoading } from "@/components/ui/workflow-loading";
import { workflowConfigurationSchema } from "@/schemas/job-creation";
import { createMetadataFlow } from "@/metadata/controller";
import { createBackendMetadataAdapter } from "@/metadata/backend-adapter";
import { PostUploadConfiguration } from "./post-upload-configuration";
import { WorkflowStepper } from "./workflow-stepper";
import { messages } from "./job-timeline";
import { jobStages } from "@/lib/job-stages";
import { QualityReviewPage } from "@/pages/quality-review-page";
import { TransformationReviewPage } from "@/pages/transformation-review-page";
import { ResultPage } from "@/pages/result-page";
import { RefreshCw } from "lucide-react";

const completedCopy: [string, string] = ["Setup complete", "Your workbooks are checked and ready."];

// Real status reconciliation with capped polling and server-owned workflow state.
export function ConnectedJobStatus({ jobId }: { jobId: string }) {
  const auth = useAuth();
  const getToken = useRef(auth.getValidToken); getToken.current = auth.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => getToken.current(), import.meta.env.DEV), []);
  const [job, setJob] = useState<BackendJob>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [observed, setObserved] = useState<string[]>([]);
  const [selected, setSelected] = useState(-1);
  const [seen, setSeen] = useState(new Set<number>());
  const active = useRef<AbortController>();
  const delay = useRef(2000);
  const userSelected = useRef(false);
  const ready = auth.state.status === "authenticated" && auth.configurationIssues.length === 0 && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));
  const load = useCallback(async () => {
    if (!services.api || !ready || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(undefined);
    try {
      const result = await services.api.getJob(jobId, controller.signal);
      if (!controller.signal.aborted) { setJob(result.job); setObserved((previous) => previous.includes(result.job.status) ? previous : [...previous, result.job.status]); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof ApiError ? `${failure.message}${failure.requestId ? ` Request ID: ${failure.requestId}` : ""}` : "Job status could not be loaded.");
    } finally {
      if (active.current === controller) active.current = undefined;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [services, ready, jobId]);
  useEffect(() => {
    delay.current = 2000;
    userSelected.current = false;
    setJob(undefined);
    setObserved([]);
    setSelected(-1);
    setSeen(new Set());
    void load();
    return () => { const controller = active.current; active.current = undefined; controller?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!job || !["FORMULA_REVIEW_PENDING", "INSPECTING", "DETECTED", "APPLYING", "VALIDATING_OUTPUT", "NORMALIZATION_PENDING", "STANDARDIZATION_PENDING", "UPDATE_PENDING"].includes(job.status) || error) return;
    const timer = setTimeout(() => { delay.current = Math.min(15_000, delay.current * 2); void load(); }, delay.current);
    return () => clearTimeout(timer);
  }, [job, error, load]);
  // Track the active/failed stage automatically until the user clicks a circle.
  useEffect(() => {
    if (!job || userSelected.current) return;
    const stgs = jobStages(job, observed);
    const idx = stgs.findIndex(s => s.state === "active" || s.state === "failed");
    const first = idx >= 0 ? idx : stgs.reduce((best, s, i) => s.state === "complete" ? i : best, -1);
    if (first >= 0) {
      setSelected(first);
      // Only mount review panels when the backend is actually waiting for that review,
      // so the review flow doesn't try to load a report that doesn't exist yet.
      const panelReady = first === 1 ? job.status === "QUALITY_REVIEW_PENDING"
        : first === 2 ? job.status === "TRANSFORMATION_REVIEW_PENDING"
        : first >= 3;
      if (panelReady) setSeen(prev => { const next = new Set(prev); next.add(first); return next; });
    }
  }, [job, observed]); // eslint-disable-line react-hooks/exhaustive-deps
  const resumeFlow = useMemo(() => {
    if (!job || job.status !== "UPLOADED" || !services.api) return undefined;
    const config = workflowConfigurationSchema.safeParse({ comment_name: job.config.comment_name, outputHeader: job.config.output_header, standardize: job.config.standardize, update: job.config.update });
    const currentRoles = Object.keys(job.files ?? {}).filter((slot) => slot === "input" || /^input_[2-8]$/.test(slot)).sort((a, b) => a === "input" ? -1 : b === "input" ? 1 : Number(a.slice(6)) - Number(b.slice(6))).map((slot) => slot === "input" ? "current" : `current_${slot.slice(6)}` as `current_${number}`);
    return config.success ? createMetadataFlow(jobId, config.data, createBackendMetadataAdapter(services.api), currentRoles) : undefined;
  }, [job, jobId, services]);
  async function retry() {
    if (!services.api || !ready || active.current || job?.status !== "FAILED" || error) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(undefined);
    try {
      const result = await services.api.retryJob(jobId, controller.signal);
      if (!controller.signal.aborted) { setJob(result.job); setObserved((previous) => previous.includes(result.job.status) ? previous : [...previous, result.job.status]); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof ApiError ? `${failure.message} Refresh job status before trying another retry.` : "The retry outcome is unknown. Refresh job status before trying again.");
    } finally {
      if (active.current === controller) active.current = undefined;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function handleSelect(i: number) {
    userSelected.current = true;
    setSelected(i);
    const panelReady = i === 1 ? job?.status === "QUALITY_REVIEW_PENDING"
      : i === 2 ? job?.status === "TRANSFORMATION_REVIEW_PENDING"
      : i >= 3;
    if (panelReady) setSeen(prev => { const next = new Set(prev); next.add(i); return next; });
  }
  const stages = job ? jobStages(job, observed) : [];
  const msg = job ? (messages[job.status] ?? ["Checking workflow status", "Refresh this page to check for updates."]) : null;
  return <section aria-labelledby="backend-job-status" className="job-workspace">
    <div className="workspace-toolbar"><h2 id="backend-job-status" className="sr-only">Job details</h2><span className="truncate text-xs text-muted-foreground">{job?.files?.input?.filename ?? "Connecting to your workflow"}</span><Button type="button" variant="ghost" size="sm" disabled={!ready || !services.api || loading} aria-busy={loading} onClick={() => { void load(); }}><RefreshCw aria-hidden="true" />Refresh job status</Button></div>
    {!ready && <p role="note" className="notice">Sign in to load this workflow. If it remains unavailable, check your connection settings.</p>}
    {loading && !job && <WorkflowLoading label="Loading your workflow..." />}
    {error && <p role="alert" className="notice notice-error break-words">{error}</p>}
    {job && <>
      <WorkflowStepper stages={stages} selected={selected} onSelect={handleSelect} />
      <div className="stepper-panel">
        {selected === 0 && (
          <div className="stage-detail">
            {stages[0]?.state === "complete"
              ? <><h3>{completedCopy[0]}</h3><p>{completedCopy[1]}</p></>
              : <><h3>{msg?.[0]}</h3><p>{msg?.[1]}</p></>}
            {resumeFlow && <PostUploadConfiguration flow={resumeFlow} onStarted={() => { void load(); }} />}
          </div>
        )}
        {seen.has(1) && <div hidden={selected !== 1}><QualityReviewPage onSubmitted={() => { void load(); }} /></div>}
        {seen.has(2) && <div hidden={selected !== 2}><TransformationReviewPage onSubmitted={() => { void load(); }} /></div>}
        {seen.has(3) && <div hidden={selected !== 3}><ResultPage /></div>}
        {selected > 0 && !seen.has(selected) && <div className="stage-detail"><h3>{msg?.[0]}</h3><p>{msg?.[1]}</p></div>}
      </div>
    </>}
    {job?.error_code && <div role="alert" className="notice notice-error"><p className="font-medium">Processing needs attention</p>{job.error_detail && <p className="mt-1 break-words">{job.error_detail}</p>}<details className="mt-2 text-xs"><summary className="cursor-pointer">Error details</summary><p className="mt-2 break-all">{job.error_code}</p></details></div>}
    {job?.status === "FAILED" && <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={!ready || !services.api || loading || Boolean(error)} onClick={() => { void retry(); }}>Retry failed processing</Button><p className="text-xs text-muted-foreground">No need to upload again.</p></div>}
    {job && <details className="section-disclosure"><summary>Workflow details</summary><dl className="job-context"><div><dt>Requested column</dt><dd>{job.config.output_header || job.config.comment_name}</dd></div><div><dt>Worksheet</dt><dd>{job.config.input_sheet || job.workbook_selections?.input?.sheet_name || "Not reported"}</dd></div><div><dt>Last updated</dt><dd><time dateTime={job.updated_at}>{new Date(job.updated_at).toLocaleString()}</time></dd></div></dl><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
      {Object.entries(job.files ?? {}).map(([slot, file]) => <div key={slot}><dt className="text-xs text-muted-foreground">{slot === "main" ? "Main workbook" : `Current workbook${slot === "input" ? " 1" : ` ${slot.slice(6)}`}`}</dt><dd className="mt-1 break-all">{file.filename}</dd><dd className="mt-1 text-xs text-muted-foreground">{file.uploaded ? "Upload confirmed" : "Upload not confirmed"}</dd></div>)}
      <div><dt className="text-xs text-muted-foreground">Job ID</dt><dd className="mt-1 break-all">{jobId}</dd></div><div><dt className="text-xs text-muted-foreground">Server status / revision</dt><dd className="mt-1 break-all">{job.status} / {job.revision}</dd></div>
    </dl></details>}
  </section>;
}
