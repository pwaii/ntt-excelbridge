import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { ApiError } from "@/api/errors";
import type { BackendJob } from "@/api/jobs-api";
import { Button } from "@/components/ui/button";
import { workflowConfigurationSchema } from "@/schemas/job-creation";
import { createMetadataFlow } from "@/metadata/controller";
import { createBackendMetadataAdapter } from "@/metadata/backend-adapter";
import { PostUploadConfiguration } from "./post-upload-configuration";
import { JobTimeline } from "./job-timeline";
import { JobStatusBadge } from "./job-status-badge";
import { RefreshCw } from "lucide-react";

// Real status reconciliation with capped polling and observed-only phase history.
export function ConnectedJobStatus({ jobId }: { jobId: string }) {
  const auth = useAuth();
  const getToken = useRef(auth.getValidToken); getToken.current = auth.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => getToken.current(), import.meta.env.DEV), []);
  const [job, setJob] = useState<BackendJob>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [observed, setObserved] = useState<string[]>([]);
  const active = useRef<AbortController>();
  const delay = useRef(2000);
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
    setJob(undefined);
    setObserved([]);
    void load();
    return () => { const controller = active.current; active.current = undefined; controller?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!job || !["FORMULA_REVIEW_PENDING", "INSPECTING", "DETECTED", "APPLYING", "VALIDATING_OUTPUT", "NORMALIZATION_PENDING", "STANDARDIZATION_PENDING", "UPDATE_PENDING"].includes(job.status) || error) return;
    const timer = setTimeout(() => { delay.current = Math.min(15_000, delay.current * 2); void load(); }, delay.current);
    return () => clearTimeout(timer);
  }, [job, error, load]);
  const resumeFlow = useMemo(() => {
    if (!job || job.status !== "UPLOADED" || !services.api) return undefined;
    const config = workflowConfigurationSchema.safeParse({ comment_name: job.config.comment_name, outputHeader: job.config.output_header, standardize: job.config.standardize, update: job.config.update });
    return config.success ? createMetadataFlow(jobId, config.data, createBackendMetadataAdapter(services.api)) : undefined;
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
  return <section aria-labelledby="backend-job-status" className="mt-5 min-w-0 space-y-5">
    <div className="panel p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="backend-job-status" className="text-base font-semibold">Job details</h2>{job && <JobStatusBadge status={job.status} />}</div>
    <p className="mt-2 break-all text-xs text-muted-foreground">Job ID: {jobId}</p>
    {!ready && <p role="note" className="text-sm text-muted-foreground">Configure Cognito and the backend JWT type, then sign in to load this job.</p>}
    {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading backend job status…</p>}
    {error && <p role="alert" className="notice notice-error mt-4 break-words">{error}</p>}
    {job && <dl className="mt-5 grid gap-x-6 gap-y-4 border-t pt-4 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Status reported by backend</dt><dd className="mt-1 break-words font-medium">{job.status}</dd></div>
      <div><dt className="text-muted-foreground">Server revision</dt><dd className="mt-1 font-medium">{job.revision}</dd></div>
      {Object.entries(job.files ?? {}).map(([slot, file]) => <div key={slot}><dt className="text-muted-foreground">{slot === "input" ? "Current workbook" : "Main workbook"}</dt><dd className="mt-1 break-all">{file.filename} — {file.uploaded ? "Backend-confirmed upload" : "Upload not confirmed"}</dd></div>)}
    </dl>}
    <div className="action-buttons mt-5"><Button type="button" variant="outline" disabled={!ready || !services.api || loading} aria-busy={loading} onClick={() => { void load(); }}><RefreshCw aria-hidden="true" />Refresh job status</Button>
    {job?.status === "FAILED" && <Button type="button" variant="outline" disabled={!ready || !services.api || loading || Boolean(error)} onClick={() => { void retry(); }}>Retry failed processing</Button>}</div>
    {job?.error_code && <p role="note" className="notice notice-error mt-4 break-words">{job.error_code}{job.error_detail ? `: ${job.error_detail}` : ""}</p>}
    {job && ["DRAFT", "UPLOADING"].includes(job.status) && <p className="notice mt-4 text-xs text-muted-foreground">Upload is incomplete. Returning to this page does not restore selected files or issue new upload links.</p>}
    {job && ["COMPLETED", "FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(job.status) && <p role="status" className="mt-4 text-xs text-muted-foreground">Workflow finished with backend status: {job.status}. Automatic polling stopped.</p>}
    </div>
    {job && <JobTimeline job={job} observed={observed} />}
    {resumeFlow && <PostUploadConfiguration flow={resumeFlow} onStarted={() => { void load(); }} />}
  </section>;
}
