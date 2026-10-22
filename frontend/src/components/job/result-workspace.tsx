import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { ApiError } from "@/api/errors";
import { artifactTypes, type ArtifactType, type BackendJob, type JobsApi } from "@/api/jobs-api";
import { Button } from "@/components/ui/button";
import { WorkflowLoading } from "@/components/ui/workflow-loading";
import { getOutputPolicy, outputPolicies } from "@/lib/output-policy";
import { JobStatusBadge } from "./job-status-badge";

const labels: Record<(typeof artifactTypes)[number], string> = { output: "Output workbook (.xlsx)", audit: "Change report (.json)", review_summary: "Review summary (.md)", validation: "Output validation (.json)", quality: "Quality report", inspection: "Inspection report" };
type SignedLink = Awaited<ReturnType<JobsApi["getArtifact"]>>;
export function ResultWorkspace({ api, jobId }: { api: JobsApi; jobId: string }) {
  const [job, setJob] = useState<BackendJob>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<AbortController>();
  const load = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(undefined); setJob(undefined);
    try {
      const result = await api.getJob(jobId, controller.signal);
      if (!controller.signal.aborted) setJob(result.job);
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (active.current === controller) active.current = undefined;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api, jobId]);
  useEffect(() => { void load(); return () => { active.current?.abort(); active.current = undefined; }; }, [load]);
  return <div className="result-workspace">
    <div className="workspace-toolbar"><span className="text-[13px] text-muted-foreground">{job?.files?.input?.filename ?? "Output and reports"}</span><Button variant="ghost" size="sm" disabled={loading} onClick={() => { void load(); }}><RefreshCw aria-hidden="true" />Refresh result</Button></div>
    {loading && <WorkflowLoading label="Loading your result..." />}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {job && <>
      {job.status === "COMPLETED" ? <CompletedJobOutput key={`${job.job_id}-${job.revision}`} api={api} job={job} /> : <section aria-label="Result summary" className="pending-result"><JobStatusBadge status={job.status} /><h2 className="mt-3 text-base font-semibold">Result is not ready</h2><p className="mt-1 text-sm text-muted-foreground">{["FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(job.status) ? "Processing stopped. Open job progress to see the error and recovery options." : "Processing or a review is still in progress."}</p><Button asChild className="mt-4" size="sm"><Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress</Link></Button></section>}
      <details aria-label="Processing evidence" className="section-disclosure"><summary>Job details and verification</summary><div className="mt-3 space-y-3 text-[13px] text-muted-foreground">
        {!job.result_summary && <p>Detailed processing counts, formula syntax results and review outcomes are not reported for this job. Check the workbook before using it.</p>}
        <p>Use the change report and review summary to inspect recorded decisions.</p>
        <dl className="job-facts"><div><dt>Created</dt><dd><time dateTime={job.created_at}>{new Date(job.created_at).toLocaleString()}</time></dd></div><div><dt>Last updated</dt><dd><time dateTime={job.updated_at}>{new Date(job.updated_at).toLocaleString()}</time></dd></div><div><dt>Job ID</dt><dd className="break-all">{jobId}</dd></div><div><dt>Server status / revision</dt><dd>{job.status} / {job.revision}</dd></div></dl>
        {job.output_hash && <p className="break-all">Output hash: {job.output_hash}</p>}
      </div></details>
      {job.status === "COMPLETED" && <div className="flex flex-wrap items-center gap-3 text-[13px]"><Link className="text-primary hover:underline" to="/jobs/new">Create another workflow</Link><span className="text-muted-foreground" aria-hidden="true">·</span><Link className="text-muted-foreground hover:text-foreground hover:underline" to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress</Link></div>}
    </>}
  </div>;
}

export function CompletedJobOutput({ api, job, showReports = true }: { api: JobsApi; job: BackendJob; showReports?: boolean }) {
  const outputTypes = Object.keys(job.artifacts ?? {}).filter((type): type is ArtifactType => /^(output|output_\d+|output_current(?:_\d+)?)$/.test(type) && typeof job.artifacts?.[type]?.key === "string");
  const reports = artifactTypes.filter((type) => type !== "output" && typeof job.artifacts?.[type]?.key === "string");
  const counts = [["updated_rows", "Rows updated"], ["skipped_rows", "Rows skipped"], ["rejected_decisions", "Decisions rejected"], ["formula_cells_verified", "Formula cells checked"]].filter(([key]) => typeof job.result_summary?.[key] === "number");
  const outputKey = typeof job.artifacts?.output?.key === "string" ? job.artifacts.output.key as string : undefined;
  const outputs = outputTypes.length ? outputTypes : outputKey ? ["output" as const] : [];
  return <section aria-label="Completed job output" className="completed-output">
    <div className="completion-heading"><CheckCircle2 className="size-5 shrink-0 text-[var(--success)]" aria-hidden="true" /><div><h2 className="text-base font-semibold">{outputKey ? "Your workbook is ready" : "Processing completed"}</h2><p className="mt-0.5 text-[13px] text-muted-foreground">{outputPolicies[getOutputPolicy(job.config.standardize, job.config.update)].title}.</p></div></div>
    <div aria-label="Artifact downloads" className="output-files">{outputs.length ? outputs.map((type) => <div key={type} className="output-file"><ArtifactDownload api={api} jobId={job.job_id} type={type} expectedKey={job.artifacts?.[type]?.key as string | undefined} /></div>) : <div className="output-file"><ArtifactDownload api={api} jobId={job.job_id} type="output" /></div>}</div>
    {counts.length > 0 && <dl aria-label="Processing counts" className="result-facts">{counts.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{job.result_summary?.[key]?.toLocaleString()}</dd></div>)}</dl>}
    <p className="text-[13px] text-muted-foreground">Open the workbook in Excel to calculate formulas and check that the results match your instructions.</p>
    {showReports ? <details className="reports-disclosure"><summary>Supporting reports{reports.length ? ` (${reports.length})` : ""}</summary><div className="mt-2 divide-y">{reports.length ? reports.map((type) => <ArtifactDownload key={type} api={api} jobId={job.job_id} type={type} expectedKey={job.artifacts?.[type]?.key as string} />) : <p className="py-2 text-[13px] text-muted-foreground">No supporting reports are available for this job.</p>}</div></details> : <Link className="w-fit text-[13px] font-medium text-primary hover:underline" to={`/jobs/${encodeURIComponent(job.job_id)}/result`}>View result and downloads</Link>}
  </section>;
}

function ArtifactDownload({ api, jobId, type, expectedKey }: { api: JobsApi; jobId: string; type: ArtifactType; expectedKey?: string }) {
  const available = Boolean(expectedKey);
  const [link, setLink] = useState<SignedLink>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const active = useRef<AbortController>();
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!link) return;
    const remaining = link.expiresAt - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [link]);
  async function prepare() {
    if (active.current || !available) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(undefined); setLink(undefined);
    try {
      const result = await api.getArtifact(jobId, type, controller.signal);
      if (result.key !== expectedKey) throw new ApiError("protocol", "The download does not match this job's published artifact. Refresh the result before downloading.");
      if (!controller.signal.aborted) { setLink(result); setExpired(result.expiresAt <= Date.now()); }
    } catch (failure) { if (!controller.signal.aborted) setError(message(failure)); }
    finally { if (active.current === controller) active.current = undefined; if (!controller.signal.aborted) setBusy(false); }
  }
  const isOutput = type === "output" || type.startsWith("output_");
  return <article className="download-row"><div className="flex min-w-0 items-center gap-2.5">{isOutput ? <FileSpreadsheet className="size-7 shrink-0 text-primary" aria-hidden="true" /> : <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}<div className="min-w-0"><h3 className="truncate text-sm font-medium">{isOutput && expectedKey ? expectedKey.split("/").at(-1) : isOutput ? "Output workbook (.xlsx)" : labels[type as keyof typeof labels]}</h3>{isOutput && <p className="mt-0.5 text-[13px] text-muted-foreground">Output workbook · Excel (.xlsx)</p>}</div></div>
    <div className="download-actions">{!available ? <p className="text-[13px] text-muted-foreground">No output file is available. Refresh the result or check job progress.</p> : <>
      {link && !expired && <a className="download-link" href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={(event) => { if (link.expiresAt <= Date.now()) { event.preventDefault(); setExpired(true); } }}><Download aria-hidden="true" className="size-3.5" />{isOutput ? "Download workbook" : "Download report"}<span className="sr-only"> (opens in new tab)</span></a>}
      <Button variant={isOutput && (!link || expired) ? "default" : link && !expired ? "ghost" : "outline"} size="sm" disabled={busy} aria-busy={busy} onClick={() => { void prepare(); }}>{busy ? "Preparing link…" : link ? "Refresh download link" : "Prepare download"}{!link && <Download aria-hidden="true" />}</Button>
    </>}</div>
    {link && expired && <p role="status" className="download-feedback">Link expired. Refresh the download link to continue.</p>}
    {link && !expired && <p className="download-feedback">Ready to download. Link expires at {new Date(link.expiresAt).toLocaleTimeString()}.</p>}
    {error && <p role="alert" className="download-feedback text-destructive">{error}</p>}
  </article>;

}
function message(error: unknown) { return error instanceof ApiError ? `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ""}` : "The result could not be loaded. Refresh to try again."; }
