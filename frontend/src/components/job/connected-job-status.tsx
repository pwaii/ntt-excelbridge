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

// Day 2 snapshot/reconciliation only. No Day 3 timeline or polling loop.
export function ConnectedJobStatus({ jobId }: { jobId: string }) {
  const auth = useAuth();
  const getToken = useRef(auth.getValidToken); getToken.current = auth.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => getToken.current(), import.meta.env.DEV), []);
  const [job, setJob] = useState<BackendJob>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController>();
  const delay = useRef(2000);
  const ready = auth.state.status === "authenticated" && auth.configurationIssues.length === 0 && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));
  const load = useCallback(async () => {
    if (!services.api || !ready || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(undefined);
    try {
      const result = await services.api.getJob(jobId, controller.signal);
      if (!controller.signal.aborted) setJob(result.job);
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
    void load();
    return () => { const controller = active.current; active.current = undefined; controller?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!job || !["INSPECTING", "APPLYING", "VALIDATING_OUTPUT", "NORMALIZATION_PENDING", "STANDARDIZATION_PENDING", "UPDATE_PENDING"].includes(job.status) || error) return;
    const timer = setTimeout(() => { delay.current = Math.min(15_000, delay.current * 2); void load(); }, delay.current);
    return () => clearTimeout(timer);
  }, [job, error, load]);
  const resumeFlow = useMemo(() => {
    if (!job || job.status !== "UPLOADED" || !services.api) return undefined;
    const config = workflowConfigurationSchema.safeParse({ comment_name: job.config.comment_name, outputHeader: job.config.output_header, standardize: job.config.standardize, update: job.config.update });
    return config.success ? createMetadataFlow(jobId, config.data, createBackendMetadataAdapter(services.api)) : undefined;
  }, [job, jobId, services]);
  return <section aria-labelledby="backend-job-status" className="mt-5 space-y-3 rounded-2xl border bg-card p-5">
    <h2 id="backend-job-status" className="text-lg font-semibold">Backend job status</h2>
    <p className="break-all text-xs text-muted-foreground">Job ID: {jobId}</p>
    {!ready && <p role="note" className="text-sm text-muted-foreground">Configure Cognito and the backend JWT type, then sign in to load this job.</p>}
    {loading && <p role="status" className="text-sm">Loading backend job status…</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {job && <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Status reported by backend</dt><dd className="mt-1 break-words font-medium">{job.status}</dd></div>
      <div><dt className="text-muted-foreground">Server revision</dt><dd className="mt-1 font-medium">{job.revision}</dd></div>
      {Object.entries(job.files ?? {}).map(([slot, file]) => <div key={slot}><dt className="text-muted-foreground">{slot === "input" ? "Current workbook" : "Main workbook"}</dt><dd className="mt-1 break-all">{file.filename} — {file.uploaded ? "Backend-confirmed upload" : "Upload not confirmed"}</dd></div>)}
    </dl>}
    <Button type="button" variant="outline" disabled={!ready || !services.api || loading} aria-busy={loading} onClick={() => { void load(); }}>Refresh job status</Button>
    <p className="text-xs text-muted-foreground">This reads backend state only. It does not create a job or replay Start. Incomplete uploads may require file reselection and fresh backend upload instructions.</p>
    {job && ["COMPLETED", "FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(job.status) && <p role="status" className="text-sm">Workflow finished with backend status: {job.status}. Automatic polling stopped.</p>}
    {resumeFlow && <PostUploadConfiguration flow={resumeFlow} onStarted={() => { void load(); }} />}
  </section>;
}
