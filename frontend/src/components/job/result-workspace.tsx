import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, RefreshCw } from "lucide-react";
import { ApiError } from "@/api/errors";
import { artifactTypes, type ArtifactType, type BackendJob, type JobsApi } from "@/api/jobs-api";
import { Button } from "@/components/ui/button";
import { getOutputPolicy, outputPolicies } from "@/lib/output-policy";

const labels: Record<ArtifactType, string> = { output: "Output workbook (.xlsx)", manifest: "Processing manifest (.json)", quality: "Quality report", proposals: "Proposals report", inspection: "Inspection report" };
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
  return <div className="mt-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="break-all text-xs text-muted-foreground">Job ID: {jobId}</p><Button variant="outline" disabled={loading} onClick={() => { void load(); }}><RefreshCw aria-hidden="true" />Refresh result</Button></div>
    {loading && <p role="status" className="rounded-2xl border bg-card p-6">Loading result from backend…</p>}
    {error && <p role="alert" className="rounded-xl border p-4 text-sm text-destructive">{error}</p>}
    {job && <>
      <section className="rounded-2xl border bg-card p-6" aria-label="Result summary"><h2 className="text-lg font-semibold">{job.status === "COMPLETED" ? "Backend processing completed" : "Result is not ready"}</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Backend status</dt><dd className="mt-1 font-medium">{job.status}</dd></div><div><dt className="text-muted-foreground">Server revision</dt><dd className="mt-1">{job.revision}</dd></div><div><dt className="text-muted-foreground">Created</dt><dd className="mt-1"><time dateTime={job.created_at}>{new Date(job.created_at).toLocaleString()}</time></dd></div><div><dt className="text-muted-foreground">Last updated</dt><dd className="mt-1"><time dateTime={job.updated_at}>{new Date(job.updated_at).toLocaleString()}</time></dd></div></dl>
        <p className="mt-4 text-sm text-muted-foreground">Configured output policy: {outputPolicies[getOutputPolicy(job.config.standardize, job.config.update)].title}. Original uploads are preserved.</p>
        {job.status !== "COMPLETED" && <p role="status" className="mt-4 text-sm">{["FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(job.status) ? "Processing stopped. Review job progress for the reported status." : "Open job progress to reconnect to processing or complete a required review."}</p>}
        <Button asChild variant="outline" className="mt-4"><Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress</Link></Button>
      </section>
      <section aria-label="Artifact downloads" className="rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Downloads</h2><p className="mt-2 text-sm text-muted-foreground">Download links are temporary. Generate a new link when one expires. Files are downloaded directly from storage.</p>
        {job.status === "COMPLETED" ? <div className="mt-5 grid gap-4 md:grid-cols-2">{artifactTypes.map((type) => <ArtifactDownload key={type} api={api} jobId={jobId} type={type} expectedKey={typeof job.artifacts?.[type]?.key === "string" ? job.artifacts[type].key as string : undefined} />)}</div> : <p className="mt-4 text-sm text-muted-foreground">Downloads become available after backend completion.</p>}
      </section>
      <section aria-label="Processing evidence" className="rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Processing evidence</h2><p className="mt-2 text-sm text-muted-foreground">The connected worker currently validates and copies workbooks. A completed job alone does not certify AI corrections, standardization, merging, or formula calculation.</p><p className="mt-3 text-sm text-muted-foreground">Applied/updated/skipped/rejected counts, formula syntax results and the human review audit summary are not supplied by the current job response. A change report JSON and review summary Markdown require backend artifact support.</p>
        {job.output_hash && <p className="mt-3 break-all text-xs">Output hash reported by backend: {job.output_hash}</p>}
      </section>
    </>}
  </div>;
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
  return <article className="rounded-xl border p-4"><h3 className="font-medium">{labels[type]}</h3>
    {!available ? <p className="mt-3 text-sm text-muted-foreground">Not published by backend.</p> : <>
      <Button variant="outline" className="mt-3" disabled={busy} onClick={() => { void prepare(); }}>{busy ? "Preparing link…" : link ? "Generate new link" : "Generate download link"}</Button>
      {link && !expired && <div className="mt-3"><a className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={(event) => { if (link.expiresAt <= Date.now()) { event.preventDefault(); setExpired(true); } }}><Download aria-hidden="true" className="size-4" />Download {labels[type]} (opens in new tab)</a><p className="mt-2 text-xs text-muted-foreground">Link expires at {new Date(link.expiresAt).toLocaleTimeString()}.</p></div>}
      {link && expired && <p role="status" className="mt-3 text-sm">Link expired. Generate a new link.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </>}
  </article>;
}
function message(error: unknown) { return error instanceof ApiError ? `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ""}` : "The result could not be loaded. Refresh to try again."; }
