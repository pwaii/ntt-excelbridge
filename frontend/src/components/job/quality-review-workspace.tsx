import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ListChecks, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bulkCandidates, decisionError, reviewGates, submissionBlocker, type QualityReviewFlow } from "@/quality/controller";
import { qualityKinds, qualityLabels, transformationKinds, transformationLabels, matchTypes, type DecisionDraft, type QualityItem } from "@/quality/types";
import { proposalStatusLabels } from "@/types/review";

const control = "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const pageSize = 50;
const rowHeight = 72;
const viewportRows = 7;
const reviewHelp: Record<QualityItem["kind"], string> = {
  "duplicate-row": "Compare the full row evidence before deciding which duplicate should be removed.",
  "blank-row": "Confirm the row has no meaningful values before accepting its removal.",
  "blank-column": "Check the column header and samples before accepting its removal.",
  "type-mismatch": "Check whether the proposed value preserves meaning and the intended data type.",
  semantic: "Check that the proposed column meaning matches your workbook and prompt.",
  "normalization-rule": "This decision covers a pattern and its affected values. Inspect its scope before accepting.",
  formula: "Check the formula text and referenced columns. Syntax verification does not mean the formula has been calculated.",
  standardization: "Check each source value and proposed target value against the main workbook vocabulary.",
  "update-match": "Check source and candidate target keys. Resolve ambiguous, duplicate and conflict groups individually. Unmatched rows are skipped.",
};
export function QualityReviewWorkspace({ flow, jobId }: { flow: QualityReviewFlow; jobId: string }) {
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const transformation = state.stage === "transformation";
  const kinds = transformation ? transformationKinds : qualityKinds;
  const labels = { ...qualityLabels, ...transformationLabels };
  const reviewName = transformation ? "Transformation" : "Quality";
  const [threshold, setThreshold] = useState("95");
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [matchFilter, setMatchFilter] = useState("all");
  const [kind, setKind] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [decision, setDecision] = useState("all");
  const [sort, setSort] = useState("risk");
  const [page, setPage] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLElement>(null);
  useEffect(() => { void flow.load(); return () => flow.dispose(); }, [flow]);
  const filtered = useMemo(() => (state.snapshot?.items ?? []).filter((item) =>
    (matchFilter === "all" || item.match?.type === matchFilter) && (kind === "all" || item.kind === kind) && (severity === "all" || item.severity === severity)
    && (decision === "all" || (decision === "pending" ? item.status === "proposed" && !state.drafts[item.id] : Boolean(state.drafts[item.id]) || item.status !== "proposed")),
  ).sort((a, b) => sort === "risk"
    ? (a.confidence ?? -1) - (b.confidence ?? -1) || a.id.localeCompare(b.id)
    : ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || a.id.localeCompare(b.id)), [state.snapshot, state.drafts, kind, severity, decision, sort, matchFilter]);
  const candidates = bulkCandidates(state, Number(threshold) / 100, filtered.map((item) => item.id));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const start = Math.min(Math.floor(offset / rowHeight), Math.max(0, rows.length - 1));
  const end = Math.min(rows.length, start + viewportRows + 3);
  const selected = filtered.find((item) => item.id === selectedId);
  const blocker = submissionBlocker(state);
  const locked = state.phase !== "ready" || state.reloadRequired || !reviewGates[state.stage ?? "quality"].includes(state.snapshot?.status ?? "");
  const resetWindow = () => { setPage(0); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; };
  function select(item: QualityItem) { setSelectedId(item.id); requestAnimationFrame(() => details.current?.focus()); }
  function nextItem(direction: number) {
    const index = filtered.findIndex((item) => item.id === selectedId);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + direction))];
    if (next) { setPage(Math.floor(filtered.indexOf(next) / pageSize)); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; select(next); }
  }
  return <div className="mt-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Decisions stay as drafts until you submit the review. Workbook values are displayed as text.</p>
      <Button variant="outline" disabled={state.phase === "loading" || state.phase === "submitting"} onClick={() => { setConfirm(false); setBulkConfirm(false); setSelectedId(undefined); void flow.load(); }}>Reload review and discard drafts</Button>
    </div>
    {state.phase === "loading" && <p role="status" className="rounded-2xl border bg-card p-6">Loading {reviewName.toLowerCase()} review…</p>}
    {state.error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{state.error}{state.reloadRequired ? " Reload server state before submitting again." : ""}</p>}
    {state.phase === "submitted" && <section role="status" className="rounded-2xl border bg-accent p-6">
      <h2 className="font-semibold">Review recorded by backend</h2><p className="mt-2 text-sm">Review ID: {state.reviewId}. Backend status: {state.reportedStatus}. This acknowledgement does not prove that the next workflow segment has started.</p>
      <Button asChild className="mt-4" variant="outline"><Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress</Link></Button>
    </section>}
    {state.snapshot && <>
      <section aria-label={`${reviewName} summary`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kinds.map((key) => <div key={key} className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{labels[key]}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{state.snapshot!.items.filter((item) => item.kind === key).length}</p></div>)}
      </section>
      <p className="text-xs text-muted-foreground">Counts refer to loaded review items, not affected rows. Revision {state.snapshot.revision}. {state.snapshot.complete ? "Complete review loaded." : "Partial report: submission is blocked until all required items are available."}</p>
      {transformation && <section aria-label="Transformation decision summary" className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Transformation decision summary</h2><p className="mt-2 text-sm">Accept drafts: {Object.values(state.drafts).filter((draft) => draft.decision === "accept").length} · Edit drafts: {Object.values(state.drafts).filter((draft) => draft.decision === "edit").length} · Reject drafts: {Object.values(state.drafts).filter((draft) => draft.decision === "reject").length} · Ignore drafts: {Object.values(state.drafts).filter((draft) => draft.decision === "ignore").length}</p><p className="mt-2 text-xs text-muted-foreground">These are decisions on proposals. The backend applies approved changes and reports output row counts.</p></section>}
      {transformation && <section className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Update matches</h2><p className="mt-2 text-sm text-muted-foreground">Exact and normalized matches still require review. Ambiguous, duplicate and conflict groups require individual decisions. Unmatched rows are skipped; no rows are inserted.</p>
        <label className="mt-3 block text-sm">Match type<select className={control} value={matchFilter} onChange={(e) => { setMatchFilter(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All matches</option>{matchTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <div aria-label="Match counts" className="mt-3 flex flex-wrap gap-2">{matchTypes.map((type) => <span key={type} className="rounded-full border px-3 py-1 text-xs">{type}: {state.snapshot!.items.filter((item) => item.match?.type === type).length}</span>)}</div><p className="mt-2 text-xs text-muted-foreground">Counts are loaded proposals, not applied or updated rows. Applied output counts are not supplied by the job contract.</p></section>}
      <section aria-labelledby="quality-findings" className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b p-5"><h2 id="quality-findings" className="flex items-center gap-2 text-lg font-semibold"><ListChecks aria-hidden="true" className="size-5 text-primary" />{reviewName} findings</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium">Issue type<select className={control} value={kind} onChange={(e) => { setKind(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All types</option>{kinds.map((key) => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
            <label className="text-xs font-medium">Severity<select className={control} value={severity} onChange={(e) => { setSeverity(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <label className="text-xs font-medium">Decision<select className={control} value={decision} onChange={(e) => { setDecision(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All items</option><option value="pending">Undecided</option><option value="decided">Decided or drafted</option></select></label>
            <label className="text-xs font-medium">Sort<select className={control} value={sort} onChange={(e) => { setSort(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="risk">Lowest confidence first</option><option value="severity">Highest severity first</option></select></label>
          </div>
          <p id="quality-table-help" className="mt-3 text-xs text-muted-foreground">Missing confidence is shown first. Scroll to browse rows, or use Previous/Next issue in the details panel to reach every filtered item by keyboard.</p>
        </div>
        {!filtered.length ? <p role="status" className="p-6 text-sm text-muted-foreground">{state.snapshot.items.length ? "No findings match these filters." : "The backend report contains no findings. No review decisions are available."}</p> : <>
          <div ref={viewport} tabIndex={0} role="region" aria-label={`Scrollable ${reviewName.toLowerCase()} findings`} aria-describedby="quality-table-help" className="max-h-[504px] overflow-auto focus-visible:outline-2 focus-visible:outline-ring" onScroll={(e) => setOffset(e.currentTarget.scrollTop)}>
            <table aria-label={`${reviewName} findings`} aria-rowcount={rows.length + 1} className="w-full min-w-[600px] table-fixed text-left text-sm">
              <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground"><tr><th scope="col" className="w-[42%] p-3">Finding</th><th scope="col" className="w-[20%] p-3">Location</th><th scope="col" className="w-[14%] p-3">Severity</th><th scope="col" className="w-[24%] p-3">Review status</th></tr></thead>
              <tbody>
                {start > 0 && <tr aria-hidden="true"><td colSpan={4} style={{ height: start * rowHeight, padding: 0 }} /></tr>}
                {rows.slice(start, end).map((item, index) => <tr key={item.id} aria-rowindex={start + index + 2} className={`border-t ${selectedId === item.id ? "bg-accent" : "hover:bg-muted/40"}`} style={{ height: rowHeight }}>
                  <td className="p-3"><button type="button" className="block w-full truncate text-left font-medium underline decoration-primary/30 underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => select(item)}>{item.title}</button><span className="block truncate text-xs text-muted-foreground">{item.match && <span className="mr-1 rounded-full border px-1.5 capitalize">{item.match.type}</span>}{labels[item.kind]}{item.confidence === undefined ? " · Confidence unavailable" : ` · ${Math.round(item.confidence * 100)}% confidence`}</span></td>
                  <td className="truncate p-3" title={location(item)}>{location(item)}</td><td className="p-3 capitalize">{item.severity}</td>
                  <td className="p-3 text-xs">{state.drafts[item.id] ? `Draft: ${state.drafts[item.id].decision}` : proposalStatusLabels[item.status]}</td>
                </tr>)}
                {end < rows.length && <tr aria-hidden="true"><td colSpan={4} style={{ height: (rows.length - end) * rowHeight, padding: 0 }} /></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><p aria-live="polite" className="text-xs text-muted-foreground">Page {currentPage + 1} of {pages} · {filtered.length} filtered items</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; }}><ChevronLeft aria-hidden="true" />Previous page</Button><Button variant="outline" size="sm" disabled={currentPage >= pages - 1} onClick={() => { setPage(currentPage + 1); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; }}>Next page<ChevronRight aria-hidden="true" /></Button></div></div>
        </>}
      </section>
      <section ref={details} tabIndex={-1} aria-labelledby="finding-details" className="rounded-2xl border bg-card p-5 focus-visible:outline-2 focus-visible:outline-ring">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="finding-details" className="text-lg font-semibold">Finding details</h2><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!filtered.length || filtered[0]?.id === selectedId} onClick={() => nextItem(-1)}>Previous issue</Button><Button size="sm" variant="outline" disabled={!filtered.length || filtered.at(-1)?.id === selectedId} onClick={() => nextItem(1)}>Next issue</Button></div></div>
        {selected ? <FindingEditor item={selected} draft={state.drafts[selected.id]} disabled={locked || !selected.requiresDecision || selected.status !== "proposed"} onChange={(draft) => { setConfirm(false); setBulkConfirm(false); flow.decide(selected.id, draft); }} /> : <p className="mt-3 text-sm text-muted-foreground">Select a finding to inspect its evidence and choose a decision.</p>}
      </section>
      <section className="rounded-2xl border bg-card p-5" aria-label="Bulk review"><h2 className="font-semibold">Accept high-confidence proposals</h2><p className="mt-2 text-sm text-muted-foreground">Applies to all filtered items across pages. Existing drafts are preserved. Ambiguous, duplicate, conflict and unmatched groups are excluded. This creates human decision drafts; submission remains separate.</p>
        <label className="mt-3 block text-sm">Minimum confidence<select className={control} value={threshold} disabled={locked} onChange={(e) => { setThreshold(e.target.value); setBulkConfirm(false); }}><option value="95">95%</option><option value="99">99%</option><option value="100">100%</option></select></label>
        <p className="mt-3 text-sm" aria-live="polite">{candidates.length} eligible filtered proposals.</p>
        <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={bulkConfirm} disabled={locked || !candidates.length} onChange={(e) => setBulkConfirm(e.target.checked)} />I have reviewed this scope and want to accept these {candidates.length} proposals.</label>
        <Button className="mt-3" variant="outline" disabled={locked || !bulkConfirm || !candidates.length} onClick={() => { candidates.forEach((item) => flow.decide(item.id, { decision: "accept" })); setConfirm(false); setBulkConfirm(false); }}>Create acceptance drafts</Button>
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Submit {reviewName.toLowerCase()} review</h2><p className="mt-2 text-sm text-muted-foreground">{Object.keys(state.drafts).length} draft decisions. Filtering does not discard drafts. No changes are applied by this page.</p>
        <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={confirm} disabled={locked || Boolean(blocker)} onChange={(e) => setConfirm(e.target.checked)} />I have reviewed these decisions and want to submit them to the backend.</label>
        <p id="review-submit-help" className="mt-3 text-xs text-muted-foreground">{blocker ?? (!confirm ? "Confirm your decisions above before submitting." : "The backend records your decisions and controls the next workflow segment.")}</p>
        <Button className="mt-4" disabled={Boolean(blocker) || !confirm} aria-describedby="review-submit-help" aria-busy={state.phase === "submitting"} onClick={() => { void flow.submit(); }}><Send aria-hidden="true" />{state.phase === "submitting" ? "Submitting review…" : "Submit review"}</Button>
      </section>
    </>}
  </div>;
}
function location(item: QualityItem) { return [item.sheet, item.column, item.row === undefined ? undefined : `Row ${item.row}`].filter(Boolean).join(" · ") || "Location not supplied"; }
function FindingEditor({ item, draft, disabled, onChange }: { item: QualityItem; draft?: DecisionDraft; disabled: boolean; onChange(draft: DecisionDraft | undefined): void }) {
  const error = draft && decisionError(draft, item);
  return <div className="mt-4 space-y-4">
    <div><h3 className="font-medium">{item.title}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{location(item)} · {proposalStatusLabels[item.status]}</p></div>
    <p className="whitespace-pre-wrap break-words text-sm">{item.reason}</p>
    <p className="rounded-xl bg-accent p-3 text-sm">{reviewHelp[item.kind]}</p>
    {item.pattern !== undefined && <p className="break-words text-sm"><span className="font-medium">Value pattern: </span>{item.pattern}{item.affectedCount === undefined ? "" : ` · ${item.affectedCount} affected cells reported by backend`}</p>}
    {item.cells.length ? <div className="overflow-x-auto"><table aria-label="Before and proposed after values" className="w-full min-w-[360px] table-fixed text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th scope="col" className="w-24 p-2">Cell</th><th scope="col" className="p-2">Before</th><th scope="col" className="p-2">Proposed after</th></tr></thead><tbody>{item.cells.map((cell, index) => <tr key={`${cell.coordinate}-${index}`} className="border-t"><th scope="row" className="break-all p-2 font-normal">{cell.coordinate}</th><td className="whitespace-pre-wrap break-all p-2">{cell.before === null ? <span className="text-muted-foreground">Empty cell</span> : cell.before}</td><td className="whitespace-pre-wrap break-all p-2">{cell.after === undefined ? "Not supplied" : cell.after === null ? "Empty cell" : cell.after}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No row/cell evidence was supplied.</p>}
    {item.formula && <section aria-label="Formula evidence" className="rounded-xl border p-4"><h4 className="font-medium">Formula proposal</h4><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-sm">{item.formula.text}</pre><p className="mt-2 text-sm">Referenced columns: {item.formula.referencedColumns.join(", ") || "None supplied"}</p><p className="mt-2 text-sm">{item.formula.syntax === "verified" ? "Syntax verified" : item.formula.syntax === "invalid" ? "Invalid syntax" : "Syntax unverified"}. Formula results have not been calculated in the browser.</p>{item.formula.diagnostic && <p className="mt-2 break-words text-sm">{item.formula.diagnostic}</p>}</section>}
    {item.kind === "formula" && !item.formula && <p role="note" className="text-sm">Formula evidence is unavailable. Acceptance is blocked until the backend supplies syntax verification.</p>}
    {item.match && <section aria-label="Match evidence" className="rounded-xl border p-4"><span className="rounded-full border px-3 py-1 text-xs font-medium">{item.match.type}</span><p className="mt-3 break-all text-sm">Source key: {item.match.sourceKey}</p><p className="mt-2 break-all text-sm">Candidate target keys: {item.match.targetKeys.join(", ") || "None"}</p>{item.match.type === "unmatched" && <p className="mt-2 text-sm">Skipped. No new row will be inserted.</p>}</section>}
    <fieldset disabled={disabled} className="space-y-3"><legend className="text-sm font-medium">Your decision</legend>
      <label className="block text-sm">Decision for this finding<select aria-invalid={Boolean(error)} className={control} value={draft?.decision ?? ""} onChange={(e) => { const value = e.target.value as DecisionDraft["decision"] | ""; onChange(value ? { decision: value, ...(value === "edit" ? { edited_value: item.cells[0]?.after ?? item.cells[0]?.before ?? "" } : {}) } : undefined); }}><option value="">Choose a decision</option>{item.allowedDecisions.map((value) => <option key={value} value={value} disabled={Boolean(decisionError({ decision: value, edited_value: "", reason: "Decision reason" }, item))}>{value === "ignore" ? "Ignore with reason" : value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
      {draft?.decision === "edit" && item.match && <label className="block text-sm">Target row<select className={control} value={draft.edited_value ?? ""} onChange={(e) => onChange({ ...draft, edited_value: e.target.value })}><option value="">Choose a target row</option>{item.match.targetKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>}
      {draft?.decision === "edit" && !item.match && <label className="block text-sm">Edited value<textarea className={control} value={draft.edited_value ?? ""} onChange={(e) => onChange({ ...draft, edited_value: e.target.value })} /><span className="text-xs text-muted-foreground">This is text, not an evaluated formula. An empty value is allowed when intentional.</span></label>}
      {draft && <label className="block text-sm">Reason {draft.decision === "ignore" ? "(required)" : "(optional)"}<textarea className={control} value={draft.reason ?? ""} aria-invalid={Boolean(error)} aria-describedby={error ? "decision-error" : undefined} onChange={(e) => onChange({ ...draft, reason: e.target.value })} /></label>}
      <p className="text-xs text-muted-foreground">Accept keeps the proposal. Reject declines it. Edit replaces the proposed value where supported. Ignore leaves the finding unresolved with your recorded reason.</p>
      {error && <p id="decision-error" role="alert" className="text-sm text-destructive">{error}</p>}
    </fieldset>
    <p className="text-xs text-muted-foreground">{draft ? `Draft: ${draft.decision}. Not submitted or applied.` : "No new decision selected."}</p>
  </div>;
}
