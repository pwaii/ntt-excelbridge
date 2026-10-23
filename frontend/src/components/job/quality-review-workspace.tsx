import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, ChevronLeft, ChevronRight, RefreshCw, Send, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowLoading } from "@/components/ui/workflow-loading";
import { bulkCandidates, decisionError, reviewGates, submissionBlocker, type QualityReviewFlow } from "@/quality/controller";
import { qualityKinds, qualityLabels, transformationKinds, transformationLabels, matchTypes, type DecisionDraft, type QualityItem } from "@/quality/types";
import { proposalStatusLabels } from "@/types/review";

const control = "field-control mt-1.5";
const pageSize = 50;
const rowHeight = 56;
const viewportRows = 7;
const reviewHelp: Record<QualityItem["kind"], string> = {
  "duplicate-row": "Compare the rows before approving removal of a duplicate.",
  "blank-row": "Check that the row is empty before approving its removal.",
  "blank-column": "Check the header and sample values before removing this column.",
  "type-mismatch": "Check whether the proposed value keeps its meaning and uses the right data type.",
  semantic: "Check that this interpretation matches the column and your instructions.",
  "normalization-rule": "One rule can change many values. Check the pattern and affected cells before approving.",
  formula: "Check the calculation and its columns. Syntax checks do not calculate or verify the result.",
  standardization: "Compare the proposed value with your main workbook.",
  "update-match": "Check the source and target rows. Rows without a match are skipped.",
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
  const [workbookFilter, setWorkbookFilter] = useState("all");
  const [kind, setKind] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [decision, setDecision] = useState("all");
  const [sort, setSort] = useState("risk");
  const [page, setPage] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLElement>(null);
  useEffect(() => { void flow.load(); return () => flow.dispose(); }, [flow]);
  const items = state.snapshot?.items ?? [];
  const sourceFiles = useMemo(() => [...new Set(items.map((item) => item.filename).filter((filename): filename is string => Boolean(filename)))].sort((a, b) => a.localeCompare(b)), [items]);
  const filtered = useMemo(() => (state.snapshot?.items ?? []).filter((item) =>
    (workbookFilter === "all" || item.filename === workbookFilter)
    && (item.kind !== "update-match" || matchFilter === "all" || item.match?.type === matchFilter)
    && (kind === "all" || item.kind === kind) && (severity === "all" || item.severity === severity)
    && (decision === "all" || (decision === "pending" ? item.status === "proposed" && !state.drafts[item.id] : Boolean(state.drafts[item.id]) || item.status !== "proposed")),
  ).sort((a, b) => sort === "risk"
    ? (a.confidence ?? -1) - (b.confidence ?? -1) || a.id.localeCompare(b.id)
    : ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || a.id.localeCompare(b.id)), [state.snapshot, state.drafts, kind, severity, decision, sort, matchFilter, workbookFilter]);
  const candidates = bulkCandidates(state, Number(threshold) / 100, filtered.map((item) => item.id));
  const required = items.filter((item) => item.requiresDecision && item.status === "proposed");
  const pending = required.filter((item) => !state.drafts[item.id] || decisionError(state.drafts[item.id], item));
  const completed = required.length - pending.length;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const start = Math.min(Math.floor(offset / rowHeight), Math.max(0, rows.length - 1));
  const end = Math.min(rows.length, start + viewportRows + 3);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  const blocker = submissionBlocker(state);
  const locked = state.phase !== "ready" || state.reloadRequired || !reviewGates[state.stage ?? "quality"].includes(state.snapshot?.status ?? "");
  const activeFilters = kind !== "all" || severity !== "all" || decision !== "all" || matchFilter !== "all" || workbookFilter !== "all";
  const hasMatches = items.some((item) => item.kind === "update-match");
  const resetWindow = () => { setPage(0); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; };
  function clearFilters() { setKind("all"); setSeverity("all"); setDecision("all"); setMatchFilter("all"); setWorkbookFilter("all"); setBulkConfirm(false); resetWindow(); }
  function select(item: QualityItem) { setSelectedId(item.id); setMobileDetailOpen(true); requestAnimationFrame(() => details.current?.focus()); }
  function returnToFindings() {
    setMobileDetailOpen(false);
    requestAnimationFrame(() => viewport.current?.querySelector<HTMLButtonElement>('tr[aria-selected="true"] button')?.focus());
  }
  function nextItem(direction: number) {
    const index = filtered.findIndex((item) => item.id === selected?.id);
    const nextIndex = Math.max(0, Math.min(filtered.length - 1, index + direction));
    const next = filtered[nextIndex];
    if (next) { setPage(Math.floor(nextIndex / pageSize)); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; select(next); }
  }
  function showPending() { const next = pending[0]; if (!next) return; clearFilters(); setSort("risk"); const ordered = [...items].sort((a, b) => (a.confidence ?? -1) - (b.confidence ?? -1) || a.id.localeCompare(b.id)); setPage(Math.floor(ordered.findIndex((item) => item.id === next.id) / pageSize)); select(next); }
  return <div className="review-workspace">
    {state.phase === "loading" && <WorkflowLoading label={`Loading ${reviewName.toLowerCase()} review...`} />}
    {state.error && <div role="alert" className="notice notice-error">{state.error}{state.reloadRequired && <p className="mt-1">Reload this review to check its latest status before continuing.</p>}{!state.snapshot && <Button variant="outline" size="sm" className="mt-3" onClick={() => { void flow.load(); }}>Reload review</Button>}</div>}
    {state.phase === "submitted" && <section role="status" className="notice notice-success flex flex-wrap items-center justify-between gap-4 p-5">
      <div><h2 className="font-semibold">Review submitted</h2><p className="mt-1 text-sm">Decisions saved. Open job progress for the next step.</p><details className="mt-2 text-xs"><summary>Submission details</summary><p className="mt-2">Review ID: {state.reviewId}. Status: {state.reportedStatus}. Check job progress for processing status.</p></details></div>
      <Button asChild><Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress<ArrowRight aria-hidden="true" /></Link></Button>
    </section>}
    {state.snapshot && (items.length === 0 ? <section className="panel p-6 sm:p-8" aria-label="Empty review">
      <h2 className="text-lg font-semibold">{state.snapshot.complete ? "This report contains no findings." : "No review items are available yet"}</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{state.snapshot.complete ? "There are no decisions to submit. Open job progress to see the next step." : "This report is incomplete. Reload the review before checking for remaining decisions."}</p>
      <div className="mt-5 flex flex-wrap gap-2"><Button asChild><Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress<ArrowRight aria-hidden="true" /></Link></Button><Button variant="ghost" onClick={() => { void flow.load(); }}><RefreshCw aria-hidden="true" />Reload review</Button></div>
    </section> : <>
      <details open={state.phase !== "submitted"} className="review-content"><summary hidden={state.phase !== "submitted"} className="cursor-pointer text-xs font-medium">View submitted review</summary>
      <div className="review-progress">
        <div className="min-w-0"><p className="font-semibold">{state.phase === "submitted" ? "Decisions submitted" : pending.length ? `${pending.length} ${pending.length === 1 ? "decision" : "decisions"} left to review` : required.length ? "Ready to submit" : "No decisions required"}</p><p className="mt-1 text-[13px] text-muted-foreground">{state.phase === "submitted" ? `${completed} decisions submitted.` : `${completed} of ${required.length} decisions ready. Drafts are saved when you submit.`}</p></div>
        <div className="flex flex-wrap items-center gap-2">{pending.length > 0 && <Button variant="outline" size="sm" disabled={locked} onClick={showPending}>Review next undecided<ArrowRight aria-hidden="true" /></Button>}
        <Button variant="ghost" size="sm" disabled={state.phase === "loading" || state.phase === "submitting"} onClick={() => { setConfirm(false); setBulkConfirm(false); setSelectedId(undefined); void flow.load(); }}><RefreshCw aria-hidden="true" />{state.phase !== "submitted" && Object.keys(state.drafts).length ? "Reload & discard drafts" : "Reload review"}</Button></div>
        <progress aria-label="Review decision progress" max={Math.max(1, required.length)} value={completed} className="review-progress-track" />
      </div>
      {!state.snapshot.complete && <p role="status" className="notice notice-warning">This report is incomplete. Reload the review before submitting.</p>}
      <div className="review-split" data-detail-open={mobileDetailOpen}>
        <section aria-labelledby="quality-findings" className="review-list">
          <div className="review-list-heading"><div><h2 id="quality-findings" className="text-sm font-semibold">{reviewName} findings</h2><p className="mt-1 text-xs text-muted-foreground">{items.length} {items.length === 1 ? "proposal" : "proposals"}</p></div></div>
          <div className="review-filters">
            <label className="text-xs font-medium">Issue type<select className={control} value={kind} onChange={(e) => { setKind(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All types ({items.length})</option>{kinds.filter((key) => items.some((item) => item.kind === key)).map((key) => <option key={key} value={key}>{labels[key]} ({items.filter((item) => item.kind === key).length})</option>)}</select></label>
            {sourceFiles.length > 1 && <label className="text-xs font-medium">Current workbook<select className={control} value={workbookFilter} onChange={(e) => { setWorkbookFilter(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All workbooks ({items.length})</option>{sourceFiles.map((filename) => <option key={filename} value={filename}>{filename} ({items.filter((item) => item.filename === filename).length})</option>)}</select></label>}
            <details className="filter-disclosure"><summary className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium"><SlidersHorizontal className="size-3.5" aria-hidden="true" />Filters & sort{activeFilters && <span className="text-primary">· Active</span>}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium">Severity<select className={control} value={severity} onChange={(e) => { setSeverity(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <label className="text-xs font-medium">Decision<select className={control} value={decision} onChange={(e) => { setDecision(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All items</option><option value="pending">Undecided</option><option value="decided">Decided or drafted</option></select></label>
              <label className="text-xs font-medium">Sort<select className={control} value={sort} onChange={(e) => { setSort(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="risk">Lowest confidence first</option><option value="severity">Highest severity first</option></select></label>
              {hasMatches && <label className="text-xs font-medium">Match type<select className={control} value={matchFilter} onChange={(e) => { setMatchFilter(e.target.value); setBulkConfirm(false); resetWindow(); }}><option value="all">All matches</option>{matchTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select><span className="mt-1 block font-normal text-muted-foreground">Filters row matches only. Formulas stay visible.</span></label>}
            </div></details>
            {activeFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
          </div>
          <p id="quality-table-help" className="sr-only">Missing confidence is shown first. Use Previous issue and Next issue to browse every filtered item.</p>
          {!filtered.length ? <div role="status" className="empty-state"><h3 className="font-medium">{items.length ? "No findings match these filters." : "This report contains no findings."}</h3><p className="mt-1 text-sm text-muted-foreground">{items.length ? "Clear filters to return to all review items." : "There are no review decisions available. Check job progress for the next step."}</p>{items.length > 0 && <Button className="mt-4" variant="outline" size="sm" onClick={clearFilters}>Show all items</Button>}</div> : <>
            <div ref={viewport} tabIndex={0} role="region" aria-label={`Scrollable ${reviewName.toLowerCase()} findings`} aria-describedby="quality-table-help" className="review-scroll" onScroll={(e) => setOffset(e.currentTarget.scrollTop)}>
              <table aria-label={`${reviewName} findings`} aria-rowcount={rows.length + 1} className="data-table review-table">
                <thead><tr><th scope="col" className="w-[58%]">Finding</th><th scope="col" className="w-[22%]">Location</th><th scope="col" className="w-[20%]">Decision</th></tr></thead>
                <tbody>{start > 0 && <tr aria-hidden="true"><td colSpan={3} style={{ height: start * rowHeight, padding: 0 }} /></tr>}
                {rows.slice(start, end).map((item, index) => <tr key={item.id} aria-rowindex={start + index + 2} aria-selected={selected?.id === item.id} style={{ height: rowHeight }}>
                  <td><button type="button" className="finding-title" onClick={() => select(item)}>{item.title}</button>{item.filename && <span className="mt-1 block truncate text-xs font-medium text-primary" title={item.filename}>{item.filename}</span>}<span className="mt-1 block truncate text-xs text-muted-foreground">{labels[item.kind]} · {item.confidence === undefined ? "Confidence unavailable" : `${Math.round(item.confidence * 100)}% confidence`}</span></td>
                  <td><span className="block truncate text-xs" title={location(item)}>{location(item)}</span><span className={`mt-1 block text-xs capitalize ${item.severity === "high" ? "text-destructive" : "text-muted-foreground"}`}>{item.severity} priority</span></td>
                  <td className="text-xs">{state.drafts[item.id] ? <span className="inline-flex items-center gap-1 text-primary"><Check className="size-3" aria-hidden="true" />{state.phase === "submitted" ? "Submitted" : "Draft"}: {state.drafts[item.id].decision}</span> : item.requiresDecision && item.status === "proposed" ? "Needs decision" : proposalStatusLabels[item.status]}</td>
                </tr>)}
                {end < rows.length && <tr aria-hidden="true"><td colSpan={3} style={{ height: (rows.length - end) * rowHeight, padding: 0 }} /></tr>}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3"><p aria-live="polite" className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "item" : "items"}{pages > 1 && ` · Page ${currentPage + 1} of ${pages}`}</p>{pages > 1 && <div className="flex gap-1"><Button variant="ghost" size="sm" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; }}><ChevronLeft aria-hidden="true" />Previous page</Button><Button variant="ghost" size="sm" disabled={currentPage >= pages - 1} onClick={() => { setPage(currentPage + 1); setOffset(0); if (viewport.current) viewport.current.scrollTop = 0; }}>Next page<ChevronRight aria-hidden="true" /></Button></div>}</div>
          </>}
        </section>
        <section ref={details} tabIndex={-1} aria-labelledby="finding-details" className="review-details">
          <Button variant="ghost" size="sm" className="review-back" onClick={returnToFindings}><ChevronLeft aria-hidden="true" />All findings</Button>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"><h2 id="finding-details" className="text-sm font-semibold">Finding details</h2><div className="flex gap-1" hidden={filtered.length < 2}><Button size="sm" variant="ghost" disabled={!filtered.length || filtered[0]?.id === selected?.id} onClick={() => nextItem(-1)}>Previous issue</Button><Button size="sm" variant="ghost" disabled={!filtered.length || filtered.at(-1)?.id === selected?.id} onClick={() => nextItem(1)}>Next issue</Button></div></div>
          {selected ? <FindingEditor key={selected.id} item={selected} draft={state.drafts[selected.id]} submitted={state.phase === "submitted"} disabled={locked || !selected.requiresDecision || selected.status !== "proposed"} onChange={(draft) => { setConfirm(false); setBulkConfirm(false); flow.decide(selected.id, draft); }} /> : <p className="py-6 text-sm text-muted-foreground">Choose a finding to see its evidence and make a decision.</p>}
        </section>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-t pt-4">
        <details className="min-w-0 flex-1" aria-label="Bulk review"><summary className="w-fit cursor-pointer text-sm font-medium">Accept high-confidence proposals</summary><div className="mt-4 max-w-2xl space-y-3"><p className="text-xs leading-relaxed text-muted-foreground">Optional: create acceptance drafts for eligible filtered items across all pages. Ambiguous, duplicate, conflict and unmatched groups require individual review. Confidence is not a guarantee of correctness.</p>
          <label className="block max-w-xs text-xs font-medium">Minimum confidence<select className={control} value={threshold} disabled={locked} onChange={(e) => { setThreshold(e.target.value); setBulkConfirm(false); }}><option value="95">95%</option><option value="99">99%</option><option value="100">100%</option></select></label>
          <p className="text-sm" aria-live="polite">{candidates.length} eligible filtered proposals.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={bulkConfirm} disabled={locked || !candidates.length} onChange={(e) => setBulkConfirm(e.target.checked)} />I have reviewed this scope and want to accept these {candidates.length} proposals.</label>
          <Button variant="outline" size="sm" disabled={locked || !bulkConfirm || !candidates.length} onClick={() => { candidates.forEach((item) => flow.decide(item.id, { decision: "accept" })); setConfirm(false); setBulkConfirm(false); }}>Create acceptance drafts</Button></div></details>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Review details</summary><p className="mt-2">Revision {state.snapshot.revision}. {state.snapshot.complete ? "Complete review loaded." : "Partial report."}</p><p className="mt-1">{Object.keys(state.drafts).length} {state.phase === "submitted" ? "submitted decisions." : "draft decisions. Filtering does not discard drafts."}</p><div aria-label="Transformation decision summary">{(["accept", "edit", "reject", "ignore"] as const).map((value) => <p key={value} className="capitalize">{value === "accept" ? "Accept" : value}{state.phase === "submitted" ? " decisions" : " drafts"}: {Object.values(state.drafts).filter((draft) => draft.decision === value).length}</p>)}</div>{hasMatches && <div aria-label="Match counts" className="mt-2">{matchTypes.map((type) => <p key={type}>{type}: {items.filter((item) => item.match?.type === type).length}</p>)}</div>}</details>
      </div>
      {state.phase !== "submitted" && <section className="review-submit" data-ready={!blocker} aria-label={`Submit ${reviewName.toLowerCase()} review`}>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Submit {reviewName.toLowerCase()} review</h2><p id="review-submit-help" role="status" className="mt-1 text-[13px] text-muted-foreground">{pending.length && !locked ? `${pending.length} required ${pending.length === 1 ? "decision remains" : "decisions remain"}. Review each item before submitting.` : blocker ?? (!confirm ? "Confirm your decisions to continue." : "Your decisions are ready to submit.")}</p>
          {!blocker && <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} disabled={locked} onChange={(e) => setConfirm(e.target.checked)} />I have reviewed these decisions and want to submit them.</label>}
        </div>
        {pending.length > 0 && !locked && <Button variant="ghost" size="sm" onClick={showPending}>Review remaining</Button>}
        <Button disabled={Boolean(blocker) || !confirm} aria-describedby="review-submit-help" aria-busy={state.phase === "submitting"} onClick={() => { void flow.submit(); }}><Send aria-hidden="true" />{state.phase === "submitting" ? "Submitting review..." : "Submit review"}</Button>
      </section>}
      </details>
    </>)}
  </div>;
}
function location(item: QualityItem) { return [item.sheet, item.column, item.row === undefined ? undefined : `Row ${item.row}`].filter(Boolean).join(" · ") || "Location not supplied"; }
function FindingEditor({ item, draft, submitted, disabled, onChange }: { item: QualityItem; draft?: DecisionDraft; submitted: boolean; disabled: boolean; onChange(draft: DecisionDraft | undefined): void }) {
  const error = draft && decisionError(draft, item);
  return <div className="mt-3 space-y-3">
    <div><h3 className="font-medium">{item.title}</h3>{item.filename && <p className="mt-1 break-all text-xs font-medium text-primary">Source workbook: {item.filename}</p>}<p className="mt-1 break-words text-xs text-muted-foreground">{location(item)} · {proposalStatusLabels[item.status]}</p></div>
    <p className="whitespace-pre-wrap break-words text-sm">{item.reason}</p>
    {item.kind !== "formula" && <p className="text-sm leading-relaxed text-muted-foreground">{reviewHelp[item.kind]}</p>}
    {item.pattern !== undefined && <p className="break-words text-sm"><span className="font-medium">Value pattern: </span>{item.pattern}{item.affectedCount === undefined ? "" : ` · ${item.affectedCount} affected cells`}</p>}
    {item.cells.length ? <div className="overflow-x-auto"><table aria-label="Before and proposed after values" className="w-full min-w-0 table-fixed text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th scope="col" className="w-[24%] p-2">Cell</th><th scope="col" className="p-2">Before</th><th scope="col" className="p-2">Proposed after</th></tr></thead><tbody>{item.cells.map((cell, index) => <tr key={`${cell.coordinate}-${index}`} className="border-t"><th scope="row" className="break-all p-2 font-normal">{cell.coordinate}</th><td className="whitespace-pre-wrap break-all p-2">{cell.before === null ? <span className="text-muted-foreground">Empty cell</span> : cell.before}</td><td className="whitespace-pre-wrap break-all p-2">{cell.after === undefined ? "Not supplied" : cell.after === null ? "Empty cell" : cell.after}</td></tr>)}</tbody></table></div> : !item.formula && !item.match && <p className="text-sm text-muted-foreground">No cell samples are available for this item.</p>}
    {item.formula && <section aria-label="Formula evidence" className="evidence-block"><h4 className="font-medium">Formula proposal</h4><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-sm">{item.formula.text}</pre><p className="mt-2 text-sm">Referenced columns: {item.formula.referencedColumns.join(", ") || "None supplied"}</p><p className="mt-2 text-sm">{item.formula.syntax === "verified" ? "Syntax checked" : item.formula.syntax === "invalid" ? "Invalid syntax" : "Syntax unverified"}. Formula results have not been calculated. Confirm that this calculation matches your instructions.</p>{item.formula.diagnostic && <p className="mt-2 break-words text-sm">{item.formula.diagnostic}</p>}</section>}
    {item.formula && item.formula.syntax !== "verified" && <p role="note" className="notice notice-warning text-xs">This formula cannot be accepted until its syntax checks pass. Reject it to decline this proposal, or ignore it with a reason.</p>}
    {item.kind === "formula" && !item.formula && <p role="note" className="text-sm">Formula evidence is unavailable. Acceptance is blocked until the backend supplies syntax verification.</p>}
    {item.match && <section aria-label="Match evidence" className="evidence-block"><span className="rounded-full border px-3 py-1 text-xs font-medium">{item.match.type}</span><p className="mt-3 break-all text-sm">Source key: {item.match.sourceKey}</p><p className="mt-2 break-all text-sm">Candidate target keys: {item.match.targetKeys.join(", ") || "None"}</p>{item.match.type === "unmatched" && <p className="mt-2 text-sm">Skipped. No new row will be inserted.</p>}</section>}
    {item.requiresDecision ? <fieldset disabled={disabled} className="space-y-3"><legend className="text-sm font-medium">Your decision</legend>
      <label className="block text-sm"><span className="sr-only">Decision for this finding</span><select aria-invalid={Boolean(error)} className={control} value={draft?.decision ?? ""} onChange={(e) => { const value = e.target.value as DecisionDraft["decision"] | ""; onChange(value ? { decision: value, ...(value === "edit" ? { edited_value: item.cells[0]?.after ?? item.cells[0]?.before ?? "" } : {}) } : undefined); }}><option value="">Choose a decision</option>{item.allowedDecisions.map((value) => <option key={value} value={value} disabled={Boolean(decisionError({ decision: value, edited_value: "", reason: "Decision reason" }, item))}>{value === "ignore" ? "Ignore with reason" : value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
      {draft?.decision === "edit" && item.match && <label className="block text-sm">Target row<select className={control} value={draft.edited_value ?? ""} onChange={(e) => onChange({ ...draft, edited_value: e.target.value })}><option value="">Choose a target row</option>{item.match.targetKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>}
      {draft?.decision === "edit" && !item.match && <label className="block text-sm">Edited value<textarea className={control} value={draft.edited_value ?? ""} onChange={(e) => onChange({ ...draft, edited_value: e.target.value })} /><span className="text-xs text-muted-foreground">Enter the replacement text. Leave blank only if you intend to clear the value.</span></label>}
      {draft && <label className="block text-sm">Reason {draft.decision === "ignore" ? "(required)" : "(optional)"}<textarea className={control} value={draft.reason ?? ""} aria-invalid={Boolean(error)} aria-describedby={error ? "decision-error" : undefined} onChange={(e) => onChange({ ...draft, reason: e.target.value })} /></label>}
      <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">What do the decisions mean?</summary><p className="mt-2 leading-relaxed">Accept keeps the proposal. Reject declines it. Edit replaces the proposed value where supported. Ignore leaves the finding unresolved with your recorded reason.</p></details>
      {error && <p id="decision-error" role="alert" className="text-sm text-destructive">{error}</p>}
    </fieldset> : <p className="notice text-sm">For reference only. No decision is required for this item.</p>}
    {item.requiresDecision && <p className="text-xs text-muted-foreground">{draft ? submitted ? `Submitted: ${draft.decision}.` : `Draft: ${draft.decision}. Submit the review to save.` : "Choose a decision above to continue."}</p>}
  </div>;
}
