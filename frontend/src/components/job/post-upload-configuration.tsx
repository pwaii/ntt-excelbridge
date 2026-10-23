import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowLoading } from "@/components/ui/workflow-loading";
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
  const visibleBlockers = readiness.blockers.filter((blocker) => {
    const role = flow.roles.find((candidate) => blocker.startsWith(`${candidate}:`));
    if (!role) return true;
    const choice = state.choices[role] ?? { sheetName: null, keyColumnId: null, header: null };
    const sheet = state.snapshot?.workbooks[role]?.sheets.find((item) => item.sheetName === choice.sheetName);
    const needsHeader = !sheet || !headerConfirmed(sheet, choice.header);
    return !needsHeader || !(blocker.endsWith("select a required key column.") || blocker.endsWith("reload backend columns for the confirmed header."));
  });
  const policy = outputPolicies[getOutputPolicy(flow.configuration.standardize, flow.configuration.update)];
  return <section aria-labelledby="metadata-title" className="worksheet-workspace space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="metadata-title" className="text-sm font-semibold">Confirm your worksheets</h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose a worksheet and confirm its header row before starting.</p></div>
      {state.configurationSaved && <span role="status" className="status-badge notice-success"><CheckCircle2 className="size-3.5" aria-hidden="true" />Ready to start</span>}
    </div>
    {state.phase === "loading" && <WorkflowLoading label="Loading worksheets..." />}
    {state.error && <p role="alert" className="notice notice-error">{state.error.message}{state.error.requestId && <span className="mt-1 block break-all text-xs">Request ID: {state.error.requestId}</span>}</p>}
    {flow.roles.filter((role) => role !== "main").length > 1 && <p className="notice text-xs leading-relaxed">For now, all current workbooks must use the same worksheet name, header row, and (for updates) key column. The backend applies the primary current workbook's settings to every current file.</p>}
    {!state.snapshot && state.phase !== "loading" && <p className="text-sm text-muted-foreground">Worksheet details are unavailable. Reload worksheets to try again.</p>}
    <fieldset disabled={busy} hidden={state.phase === "loading" && !state.snapshot} className="worksheet-grid min-w-0">
      <legend className="sr-only">Workbook configuration</legend>
      {requiredWorkbookRoles(flow.configuration, flow.roles.filter((role) => role !== "main")).map((role) => {
        const workbook = state.snapshot?.workbooks[role];
        const choice = state.choices[role] ?? { sheetName: null, keyColumnId: null, header: null };
        const sheet = workbook?.sheets.find((item) => item.sheetName === choice.sheetName);
        const columnsReady = sheet && headerConfirmed(sheet, choice.header) && sheet.columnsHeaderRow === choice.header?.row;
        return <section key={role} aria-labelledby={`${role}-metadata-label`} className="worksheet-configuration min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 id={`${role}-metadata-label`} className="text-sm font-semibold">{role === "main" ? "Main workbook" : `Current workbook ${role === "current" ? "1" : role.slice("current_".length)}${workbook?.filename ? ` · ${workbook.filename}` : ""}`}</h3>
          {workbook?.sizeBytes !== undefined && <p className="text-xs tabular-nums text-muted-foreground">{formatFileSize(workbook.sizeBytes)}</p>}</div>
          {workbook?.warnings.map((warning, index) => <p key={index} role="status" className="text-xs text-muted-foreground">{warning}</p>)}
          {workbook?.errors.map((error, index) => <p key={index} role="alert" className="text-xs text-destructive">{error}</p>)}
          <div>
            <label htmlFor={`${role}-metadata-sheet`} className="mb-1.5 block text-sm font-medium">Worksheet <span className="text-muted-foreground">(required)</span></label>
            <select id={`${role}-metadata-sheet`} value={choice.sheetName ?? ""} disabled={!workbook?.sheets.length || busy} onChange={(event) => flow.selectSheet(role, event.target.value)} className="field-control max-w-xl">
              <option value="" disabled>{workbook?.sheets.length ? "Select a worksheet" : "No worksheet metadata available"}</option>
              {workbook?.sheets.map((item) => <option key={item.sheetName} value={item.sheetName}>{item.sheetName}</option>)}
            </select>
          </div>
          {sheet && <>
            {sheet.dataRowCount !== undefined ? <p className="text-xs tabular-nums text-muted-foreground">Data rows: {sheet.dataRowCount.toLocaleString()}</p> : <p className="text-xs text-muted-foreground">Row count not provided by the backend.</p>}
            <LargeFileWarning metadata={sheet} label={role === "current" ? "Current workbook" : "Main workbook"} />
            {sheet.headerRowBounds ? <HeaderRowConfirmation key={`${role}-${choice.sheetName}`} id={`${role}-metadata-header`} label={role === "current" ? "Current workbook" : "Main workbook"} metadata={sheet} confirmation={choice.header} onChange={(header) => flow.setHeader(role, header)} /> : <p className="text-xs text-muted-foreground">Header settings could not be loaded. Reload worksheets to try again.</p>}
            {flow.configuration.update && <div>
              <label htmlFor={`${role}-metadata-key`} className="mb-1 block text-xs font-medium">Key column {workbook?.keyRule === "required" && "(required)"}</label>
              <p id={`${role}-key-help`} className="mb-2 max-w-prose text-xs leading-relaxed text-muted-foreground">Match records using an account code or customer ID.</p>
              <select id={`${role}-metadata-key`} value={choice.keyColumnId ?? ""} aria-describedby={`${role}-key-help matching-key-warning`} disabled={busy || !columnsReady || !sheet.columns?.length || workbook?.keyRule === "not-applicable" || workbook?.keyRule === "unknown"} onChange={(event) => flow.selectKey(role, event.target.value || null)} className="field-control max-w-xl">
                <option value="">{workbook?.keyRule === "not-applicable" ? "Key selection not required by backend" : "Choose a column to match rows"}</option>
                {columnsReady && sheet.columns?.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
              </select>
            </div>}
          </>}
        </section>;
      })}
    </fieldset>
    {flow.configuration.update && <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p id="matching-key-warning">Choose matching identifiers in both files, preferably with no blanks or duplicates. Duplicate keys can cause skipped updates or conflicts.</p>
      <details>
      <summary className="cursor-pointer font-medium text-foreground">Matching rules and duplicate keys</summary>
      <ul className="mt-2 max-w-prose list-disc space-y-1.5 pl-4">
        <li>Choose the same type of identifier in both files. For example, account code "1001" should refer to the same account in each file, even on different row numbers.</li>
        <li>Matching ignores letter case and whitespace: "AC 001" and "ac001" count as the same key.</li>
        <li><strong className="font-medium text-foreground">Duplicates in main:</strong> updates to records with a duplicated destination key are skipped, even if you accept a match.</li>
        <li><strong className="font-medium text-foreground">Duplicates in current:</strong> records targeting the same main row are handled by the conflict policy.</li>
        <li><strong className="font-medium text-foreground">Standardize does not remove duplicate keys.</strong> Making different values consistent can create duplicates. Check key values in both files; duplicate-row checks do not catch every repeated key.</li>
        <li>Review matches before approving updates. Records without an accepted match are skipped, not added to the main workbook.</li>
      </ul>
      </details>
    </div>}
    <details className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed"><summary className="cursor-pointer font-medium">Output policy: {policy.title}</summary><p className="mt-2 text-muted-foreground">{policy.description}</p></details>
    {!readiness.canStart && !busy && state.snapshot && <div className="notice"><p className="mb-2 text-xs font-medium">Before you can continue</p><ul aria-label="Workflow start requirements" className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{visibleBlockers.map((blocker, index) => <li key={index}>{flow.roles.reduce((message, role) => message.replace(`${role}:`, `${role === "main" ? "Main workbook" : `Current workbook ${role === "current" ? "1" : role.slice("current_".length)}`}:`), blocker).replace("explicitly confirm", "confirm").replace("reload metadata", "reload worksheets").replace("reload backend columns", "reload column names")}</li>)}</ul></div>}
    <div className="action-bar">
      <Button variant="ghost" disabled={busy} onClick={() => { void flow.load(); }}><RefreshCw aria-hidden="true" />Reload worksheets</Button>
      <div className="action-buttons">
      <Button variant="outline" disabled={!readiness.canStart || busy || state.configurationSaved} onClick={() => { void flow.save(); }}>{state.configurationSaved ? "Setup saved" : "Save setup"}</Button>
      <Button disabled={!readiness.canStart || busy} aria-busy={state.phase === "starting"} onClick={() => { void flow.start(); }}>{state.phase === "starting" ? <><RefreshCw aria-hidden="true" className="processing-indicator" />Starting workflow…</> : <>Start workflow<ArrowRight aria-hidden="true" /></>}</Button>
      </div>
    </div>
      <p className="text-xs text-muted-foreground">Confirm the worksheet and header for each current workbook{flow.configuration.standardize || flow.configuration.update ? " and the main workbook" : ""}. Start saves all selections and begins processing.</p>
  </section>;
}
