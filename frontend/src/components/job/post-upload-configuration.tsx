import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HeaderRowConfirmation } from "./header-row-confirmation";
import { LargeFileWarning } from "./large-file-warning";
import { formatFileSize } from "./workbook-file-picker";
import { headerConfirmed } from "@/lib/workflow-readiness";
import { getOutputPolicy, outputPolicies } from "@/lib/output-policy";
import { requiredWorkbookRoles } from "@/metadata/readiness";
import type { MetadataFlow } from "@/metadata/controller";
import type { StartedJob } from "@/metadata/types";

// Mount only after the real Task 9 manifest/adapter is available. No fixtures,
// guessed endpoint, or local workbook parser is used by this component.
export function PostUploadConfiguration({ flow, onStarted }: { flow: MetadataFlow; onStarted?: (job: StartedJob) => void }) {
  const navigate = useNavigate();
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const notified = useRef(false);
  useEffect(() => { notified.current = false; void flow.load(); }, [flow]);
  useEffect(() => {
    if (state.phase === "started" && state.startedJob && !notified.current) {
      notified.current = true; onStarted?.(state.startedJob);
      navigate(`/jobs/${encodeURIComponent(state.startedJob.jobId)}`, { replace: true });
    }
  }, [state.phase, state.startedJob, onStarted, navigate]);
  const busy = ["loading", "saving", "starting", "started"].includes(state.phase);
  const readiness = flow.getReadiness();
  const policy = outputPolicies[getOutputPolicy(flow.configuration.standardize, flow.configuration.update)];
  return <section aria-labelledby="metadata-title" className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6">
    <h2 id="metadata-title" className="text-xl font-semibold">Review workbook metadata</h2>
    <p className="text-xs leading-relaxed text-muted-foreground">This backend currently runs a validation/copy demo. Processing options are saved, but AI transformations and review gates are not applied by this demo pipeline.</p>
    <ol aria-label="Workflow stages" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {["Configure job", "Create job and upload files", "Review workbook metadata", "Confirm header rows", "Start workflow"].map((label) => <li key={label}>{label}</li>)}
    </ol>
    {state.phase === "loading" && <p role="status" className="text-sm text-muted-foreground">Loading backend workbook metadata…</p>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error.message}{state.error.requestId && <span className="block break-all text-xs">Request ID: {state.error.requestId}</span>}</p>}
    {!state.snapshot && state.phase !== "loading" && <p className="text-sm text-muted-foreground">Metadata unavailable. No worksheets, columns, header rows or counts are inferred from local files.</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-70">
      <legend className="sr-only">Workbook configuration</legend>
      {requiredWorkbookRoles(flow.configuration).map((role) => {
        const workbook = state.snapshot?.workbooks[role];
        const choice = state.choices[role];
        const sheet = workbook?.sheets.find((item) => item.sheetName === choice.sheetName);
        const columnsReady = sheet && headerConfirmed(sheet, choice.header) && sheet.columnsHeaderRow === choice.header?.row;
        return <section key={role} aria-labelledby={`${role}-metadata-label`} className="min-w-0 space-y-3 rounded-xl border p-3">
          <h3 id={`${role}-metadata-label`} className="text-sm font-semibold">{role === "current" ? "Current workbook" : "Main workbook"}</h3>
          {workbook?.sizeBytes !== undefined && <p className="text-xs text-muted-foreground">Backend file size: {formatFileSize(workbook.sizeBytes)}</p>}
          {workbook?.warnings.map((warning, index) => <p key={index} role="status" className="text-xs text-muted-foreground">{warning}</p>)}
          {workbook?.errors.map((error, index) => <p key={index} role="alert" className="text-xs text-destructive">{error}</p>)}
          <div>
            <label htmlFor={`${role}-metadata-sheet`} className="mb-1 block text-xs font-medium">Worksheet</label>
            <select id={`${role}-metadata-sheet`} value={choice.sheetName ?? ""} disabled={!workbook?.sheets.length || busy} onChange={(event) => flow.selectSheet(role, event.target.value)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
              <option value="" disabled>{workbook?.sheets.length ? "Select a worksheet" : "No worksheet metadata available"}</option>
              {workbook?.sheets.map((item) => <option key={item.sheetName} value={item.sheetName}>{item.sheetName}</option>)}
            </select>
          </div>
          {sheet && <>
            {sheet.dataRowCount !== undefined ? <p className="text-xs text-muted-foreground">Backend row count: {sheet.dataRowCount.toLocaleString()}</p> : <p className="text-xs text-muted-foreground">Row count not provided by the backend.</p>}
            <LargeFileWarning metadata={sheet} label={role === "current" ? "Current workbook" : "Main workbook"} />
            {sheet.headerRowBounds ? <HeaderRowConfirmation key={`${role}-${choice.sheetName}`} id={`${role}-metadata-header`} label={role === "current" ? "Current workbook" : "Main workbook"} metadata={sheet} confirmation={choice.header} onChange={(header) => flow.setHeader(role, header)} /> : <p className="text-xs text-muted-foreground">Header bounds and indexing await the backend contract. Confirmation is unavailable.</p>}
            <div>
              <label htmlFor={`${role}-metadata-key`} className="mb-1 block text-xs font-medium">Key column {workbook?.keyRule === "required" && "(required)"}</label>
              <select id={`${role}-metadata-key`} value={choice.keyColumnId ?? ""} disabled={busy || !columnsReady || !sheet.columns?.length || workbook?.keyRule === "not-applicable" || workbook?.keyRule === "unknown"} onChange={(event) => flow.selectKey(role, event.target.value || null)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                <option value="">{workbook?.keyRule === "not-applicable" ? "Key selection not required by backend" : "Select a backend-provided column"}</option>
                {columnsReady && sheet.columns?.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
              </select>
              {!columnsReady && workbook?.keyRule !== "not-applicable" && <p className="mt-1 text-xs text-muted-foreground">Confirm the header, then reload backend metadata if the columns belong to a different header row.</p>}
            </div>
          </>}
        </section>;
      })}
    </fieldset>
    <div className="rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed"><p className="font-semibold">Output policy: {policy.title}</p><p className="mt-1 text-muted-foreground">{policy.description}</p></div>
    {!readiness.canStart && <ul aria-label="Workflow start requirements" className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{readiness.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button variant="outline" disabled={busy} onClick={() => { void flow.load(); }}>Reload backend metadata</Button>
      <Button variant="outline" disabled={!readiness.canStart || busy || state.configurationSaved} onClick={() => { void flow.save(); }}>{state.configurationSaved ? "Configuration saved" : "Save and confirm configuration"}</Button>
      <Button className="workflow-primary text-[#081329]" disabled={!readiness.canStart || busy || !state.configurationSaved} aria-busy={state.phase === "starting"} onClick={() => { void flow.start(); }}>{state.phase === "starting" ? "Starting workflow…" : "Start workflow"}</Button>
    </div>
    {!state.configurationSaved && <p className="text-xs text-muted-foreground">Save and confirm the worksheet configuration to enable Start.</p>}
  </section>;
}
