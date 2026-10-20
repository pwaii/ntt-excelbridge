import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, RefreshCw, ArrowRight } from "lucide-react";
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
  return <section aria-labelledby="metadata-title" className="panel space-y-5 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="metadata-title" className="text-lg font-semibold">Review workbook metadata</h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose a worksheet, confirm its header row, then save your configuration.</p></div>
      {state.configurationSaved && <span role="status" className="status-badge notice-success"><CheckCircle2 className="size-3.5" aria-hidden="true" />Ready to start</span>}
    </div>
    {state.phase === "loading" && <p role="status" className="text-sm text-muted-foreground">Loading backend workbook metadata…</p>}
    {state.error && <p role="alert" className="notice notice-error">{state.error.message}{state.error.requestId && <span className="mt-1 block break-all text-xs">Request ID: {state.error.requestId}</span>}</p>}
    {!state.snapshot && state.phase !== "loading" && <p className="text-sm text-muted-foreground">Metadata unavailable. No worksheets, columns, header rows or counts are inferred from local files.</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-70">
      <legend className="sr-only">Workbook configuration</legend>
      {requiredWorkbookRoles(flow.configuration).map((role) => {
        const workbook = state.snapshot?.workbooks[role];
        const choice = state.choices[role];
        const sheet = workbook?.sheets.find((item) => item.sheetName === choice.sheetName);
        const columnsReady = sheet && headerConfirmed(sheet, choice.header) && sheet.columnsHeaderRow === choice.header?.row;
        return <section key={role} aria-labelledby={`${role}-metadata-label`} className="min-w-0 space-y-4 border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 id={`${role}-metadata-label`} className="text-sm font-semibold">{role === "current" ? "Current workbook" : "Main workbook"}</h3>
          {workbook?.sizeBytes !== undefined && <p className="text-xs tabular-nums text-muted-foreground">{formatFileSize(workbook.sizeBytes)}</p>}</div>
          {workbook?.warnings.map((warning, index) => <p key={index} role="status" className="text-xs text-muted-foreground">{warning}</p>)}
          {workbook?.errors.map((error, index) => <p key={index} role="alert" className="text-xs text-destructive">{error}</p>)}
          <div>
            <label htmlFor={`${role}-metadata-sheet`} className="mb-1.5 block text-sm font-medium">Worksheet <span className="text-muted-foreground">(required)</span></label>
            <select id={`${role}-metadata-sheet`} value={choice.sheetName ?? ""} aria-describedby={`${role}-sheet-help`} disabled={!workbook?.sheets.length || busy} onChange={(event) => flow.selectSheet(role, event.target.value)} className="field-control max-w-xl">
              <option value="" disabled>{workbook?.sheets.length ? "Select a worksheet" : "No worksheet metadata available"}</option>
              {workbook?.sheets.map((item) => <option key={item.sheetName} value={item.sheetName}>{item.sheetName}</option>)}
            </select>
            <p id={`${role}-sheet-help`} className="mt-2 text-xs text-muted-foreground">{choice.sheetName ? "Confirm the header row below to continue." : "Select the worksheet you want to process. Header settings appear after selection."}</p>
          </div>
          {sheet && <>
            {sheet.dataRowCount !== undefined ? <p className="text-xs tabular-nums text-muted-foreground">Backend row count: {sheet.dataRowCount.toLocaleString()}</p> : <p className="text-xs text-muted-foreground">Row count not provided by the backend.</p>}
            <LargeFileWarning metadata={sheet} label={role === "current" ? "Current workbook" : "Main workbook"} />
            {sheet.headerRowBounds ? <HeaderRowConfirmation key={`${role}-${choice.sheetName}`} id={`${role}-metadata-header`} label={role === "current" ? "Current workbook" : "Main workbook"} metadata={sheet} confirmation={choice.header} onChange={(header) => flow.setHeader(role, header)} /> : <p className="text-xs text-muted-foreground">Header bounds and indexing await the backend contract. Confirmation is unavailable.</p>}
            <div>
              <label htmlFor={`${role}-metadata-key`} className="mb-1 block text-xs font-medium">Key column {workbook?.keyRule === "required" && "(required)"}</label>
              <select id={`${role}-metadata-key`} value={choice.keyColumnId ?? ""} disabled={busy || !columnsReady || !sheet.columns?.length || workbook?.keyRule === "not-applicable" || workbook?.keyRule === "unknown"} onChange={(event) => flow.selectKey(role, event.target.value || null)} className="field-control max-w-xl">
                <option value="">{workbook?.keyRule === "not-applicable" ? "Key selection not required by backend" : "Select a backend-provided column"}</option>
                {columnsReady && sheet.columns?.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
              </select>
              {!columnsReady && workbook?.keyRule !== "not-applicable" && <p className="mt-1 text-xs text-muted-foreground">Confirm the header, then reload backend metadata if the columns belong to a different header row.</p>}
            </div>
          </>}
        </section>;
      })}
    </fieldset>
    <details className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed"><summary className="cursor-pointer font-medium">Output policy: {policy.title}</summary><p className="mt-2 text-muted-foreground">{policy.description}</p></details>
    {!readiness.canStart && <div className="notice"><p className="mb-2 text-xs font-medium">Before you can continue</p><ul aria-label="Workflow start requirements" className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{readiness.blockers.map((blocker, index) => <li key={index}>{blocker.replace(/^current:/, "Current workbook:").replace(/^main:/, "Main workbook:")}</li>)}</ul></div>}
    <div className="action-bar">
      <Button variant="ghost" disabled={busy} onClick={() => { void flow.load(); }}><RefreshCw aria-hidden="true" />Reload backend metadata</Button>
      <div className="action-buttons">
      <Button variant={state.configurationSaved ? "outline" : "default"} disabled={!readiness.canStart || busy || state.configurationSaved} onClick={() => { void flow.save(); }}>{state.configurationSaved ? "Configuration saved" : "Save and confirm configuration"}</Button>
      <Button disabled={!readiness.canStart || busy || !state.configurationSaved} aria-busy={state.phase === "starting"} onClick={() => { void flow.start(); }}>{state.phase === "starting" ? "Starting workflow…" : "Start workflow"}<ArrowRight aria-hidden="true" /></Button>
      </div>
    </div>
    {!state.configurationSaved && <p className="text-xs text-muted-foreground">Save and confirm the worksheet configuration to enable Start.</p>}
  </section>;
}
