import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw, Send, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowLoading } from "@/components/ui/workflow-loading";
import { decisionError, reviewGates, submissionBlocker, type QualityReviewFlow } from "@/quality/controller";
import { qualityKinds, qualityLabels, transformationKinds, transformationLabels, matchTypes, type DecisionDraft, type QualityItem } from "@/quality/types";

const control = "field-control mt-1.5";

export function QualityReviewWorkspace({ flow, jobId }: { flow: QualityReviewFlow; jobId: string }) {
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const transformation = state.stage === "transformation";
  const kinds = transformation ? transformationKinds : qualityKinds;
  const labels = useMemo(() => ({ ...qualityLabels, ...transformationLabels }), []);
  const reviewName = transformation ? "Transformation" : "Quality";

  const [kind, setKind] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [decision, setDecision] = useState("all");
  const [sort, setSort] = useState("risk");
  const [matchFilter, setMatchFilter] = useState("all");
  const [workbookFilter, setWorkbookFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [navCounter, setNavCounter] = useState(0);
  const [navDir, setNavDir] = useState<"forward" | "back">("forward");
  const [advancing, setAdvancing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => { void flow.load(); return () => flow.dispose(); }, [flow]);

  const items = state.snapshot?.items ?? [];
  const sourceFiles = useMemo(() =>
    [...new Set(items.map(i => i.filename).filter((f): f is string => Boolean(f)))].sort(),
    [items]);
  const hasMatches = items.some(i => i.kind === "update-match");

  const filtered = useMemo(() =>
    (state.snapshot?.items ?? []).filter(item =>
      (workbookFilter === "all" || item.filename === workbookFilter)
      && (item.kind !== "update-match" || matchFilter === "all" || item.match?.type === matchFilter)
      && (kind === "all" || item.kind === kind)
      && (severity === "all" || item.severity === severity)
      && (decision === "all" || (decision === "pending"
        ? item.status === "proposed" && !state.drafts[item.id]
        : Boolean(state.drafts[item.id]) || item.status !== "proposed"))
    ).sort((a, b) => sort === "risk"
      ? (a.confidence ?? -1) - (b.confidence ?? -1) || a.id.localeCompare(b.id)
      : ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || a.id.localeCompare(b.id)
    ),
    [state.snapshot, state.drafts, kind, severity, decision, sort, matchFilter, workbookFilter]);

  const required = items.filter(i => i.requiresDecision && i.status === "proposed");
  const pending = required.filter(i => !state.drafts[i.id] || decisionError(state.drafts[i.id], i));
  const completed = required.length - pending.length;
  const blocker = submissionBlocker(state);
  const locked = state.phase !== "ready" || state.reloadRequired || !reviewGates[state.stage ?? "quality"].includes(state.snapshot?.status ?? "");
  const stagePassed = !!state.snapshot && !reviewGates[state.stage ?? "quality"].includes(state.snapshot.status);
  const activeFilters = kind !== "all" || severity !== "all" || decision !== "all" || matchFilter !== "all" || workbookFilter !== "all";
  const progressPct = required.length ? Math.round(completed / required.length * 100) : 0;

  const safeIndex = Math.min(currentIndex, Math.max(0, filtered.length - 1));
  const current = filtered[safeIndex];

  function clearFilters() {
    setKind("all"); setSeverity("all"); setDecision("all"); setMatchFilter("all"); setWorkbookFilter("all");
    setCurrentIndex(0);
  }

  function goTo(index: number, dir: "forward" | "back" = "forward") {
    if (index < 0 || index >= filtered.length || advancing) return;
    setNavDir(dir);
    setNavCounter(c => c + 1);
    setCurrentIndex(index);
  }

  function navigate(dir: 1 | -1) {
    goTo(safeIndex + dir, dir === 1 ? "forward" : "back");
  }

  function handleDecide(draft: DecisionDraft | undefined) {
    if (!current) return;
    flow.decide(current.id, draft);
    if (draft && !decisionError(draft, current)) {
      if (!advancing && safeIndex < filtered.length - 1) {
        setAdvancing(true);
        setTimeout(() => {
          const nextUndecided = filtered.findIndex((item, i) =>
            i > safeIndex && item.requiresDecision && item.status === "proposed" && !state.drafts[item.id]);
          const next = nextUndecided !== -1 ? nextUndecided : safeIndex + 1;
          if (next < filtered.length) { setNavDir("forward"); setNavCounter(c => c + 1); setCurrentIndex(next); }
          setAdvancing(false);
        }, 350);
      }
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (advancing || locked) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === "j") { e.preventDefault(); navigate(1); }
      if (e.key === "ArrowLeft" || e.key === "k") { e.preventDefault(); navigate(-1); }
      if (!current?.requiresDecision || current.status !== "proposed") return;
      if (e.key === "a" && current.allowedDecisions.includes("accept")) handleDecide({ decision: "accept" });
      if (e.key === "r" && current.allowedDecisions.includes("reject")) handleDecide({ decision: "reject" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advancing, locked, current, safeIndex, filtered, state.drafts]);

  return (
    <div className="review-queue">
      <div className="review-topbar">
        <span className="review-topbar-title">{reviewName} review</span>
        <div className="review-topbar-progress">
          <div className="review-progress-track">
            <div className="review-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="review-topbar-count">{completed} / {required.length} decided</span>
        </div>
        {!blocker && state.phase === "ready" && required.length > 0 && (
          <label className="review-topbar-confirm">
            <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
            I confirm
          </label>
        )}
        {stagePassed ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress <ArrowRight aria-hidden="true" /></Link>
          </Button>
        ) : (
          <>
            <Link to={`/jobs/${encodeURIComponent(jobId)}`} className="review-topbar-back">← Progress</Link>
            <Button size="sm" disabled={Boolean(blocker) || (required.length > 0 && !confirm) || locked} aria-busy={state.phase === "submitting"} onClick={() => { void flow.submit(); }}>
              <Send aria-hidden="true" />{state.phase === "submitting" ? "Submitting…" : "Submit review"}
            </Button>
          </>
        )}
      </div>

      <div className="review-queue-body">
        {filtered.length > 0 && (
          <nav className="review-sidebar-strip" aria-label="Finding navigator">
            {filtered.map((item, i) => {
              const status = dotState(item, state.drafts[item.id]);
              return (
                <button key={item.id} type="button" className="review-dot-btn"
                  data-status={status} data-current={i === safeIndex ? "true" : undefined}
                  title={`${i + 1}. ${item.title}`}
                  aria-label={`Finding ${i + 1}: ${item.title} — ${status}`}
                  aria-current={i === safeIndex ? "true" : undefined}
                  onClick={() => goTo(i, i > safeIndex ? "forward" : "back")} />
              );
            })}
          </nav>
        )}

        <div className="review-stage">
          {state.phase === "loading" && !state.snapshot && (
            <WorkflowLoading label={`Loading ${reviewName.toLowerCase()} review…`} />
          )}
          {state.error && (
            <div role="alert" className="notice notice-error">
              {state.error}
              {state.reloadRequired && <p className="mt-1 text-sm">Reload before continuing.</p>}
              {!state.snapshot && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => { void flow.load(); }}>
                  <RefreshCw aria-hidden="true" />Reload review
                </Button>
              )}
            </div>
          )}
          {state.phase === "submitted" && (
            <section role="status" className="notice notice-success flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <h2 className="font-semibold">Review submitted</h2>
                <p className="mt-1 text-sm">{completed} decisions saved. Open job progress for the next step.</p>
                <details className="mt-2 text-xs"><summary>Submission details</summary>
                  <p className="mt-2">Review ID: {state.reviewId}. Status: {state.reportedStatus}. Check job progress for processing status.</p>
                </details>
              </div>
              <Button asChild><Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress <ArrowRight aria-hidden="true" /></Link></Button>
            </section>
          )}
          {state.snapshot && items.length === 0 && (
            <div className="empty-state p-8" aria-label="Empty review">
              <h2 className="font-semibold text-lg">{state.snapshot.complete ? "This report contains no findings." : "No review items are available yet."}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{state.snapshot.complete ? "Nothing to decide. Open job progress for the next step." : "This report is incomplete — reload to check for remaining items."}</p>
              <div className="mt-5 flex gap-2">
                <Button asChild><Link to={`/jobs/${encodeURIComponent(jobId)}`}>View job progress <ArrowRight aria-hidden="true" /></Link></Button>
                <Button variant="ghost" onClick={() => { void flow.load(); }}><RefreshCw aria-hidden="true" />Reload</Button>
              </div>
            </div>
          )}
          {filtered.length === 0 && items.length > 0 && (
            <div className="empty-state p-8">
              <h3 className="font-medium">No findings match these filters.</h3>
              <p className="mt-1 text-sm text-muted-foreground">Clear filters to return to all review items.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Show all items</Button>
            </div>
          )}
          {current && state.phase !== "submitted" && (
            <FindingCard key={navCounter} dir={navDir} item={current} draft={state.drafts[current.id]}
              disabled={locked || !current.requiresDecision || current.status !== "proposed"}
              index={safeIndex} total={filtered.length} labels={labels}
              onDecide={handleDecide} onPrev={() => navigate(-1)} onNext={() => navigate(1)} />
          )}

          {state.snapshot && state.phase !== "submitted" && filtersOpen && (
            <div className="review-queue-footer">
              {(
                <div className="review-filter-panel" aria-label="Filters">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wide">Filters</span>
                    <Button variant="ghost" size="sm" onClick={() => setFiltersOpen(false)}><X className="size-3.5" /></Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium">Issue type
                      <select className={control} value={kind} onChange={e => { setKind(e.target.value); setCurrentIndex(0); }}>
                        <option value="all">All ({items.length})</option>
                        {kinds.filter(k => items.some(i => i.kind === k)).map(k =>
                          <option key={k} value={k}>{labels[k]} ({items.filter(i => i.kind === k).length})</option>)}
                      </select>
                    </label>
                    {sourceFiles.length > 1 && (
                      <label className="text-xs font-medium">Current workbook
                        <select className={control} value={workbookFilter} onChange={e => { setWorkbookFilter(e.target.value); setCurrentIndex(0); }}>
                          <option value="all">All workbooks ({items.length})</option>
                          {sourceFiles.map(f => <option key={f} value={f}>{f} ({items.filter(i => i.filename === f).length})</option>)}
                        </select>
                      </label>
                    )}
                    <label className="text-xs font-medium">Severity
                      <select className={control} value={severity} onChange={e => { setSeverity(e.target.value); setCurrentIndex(0); }}>
                        <option value="all">All severities</option>
                        <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                      </select>
                    </label>
                    <label className="text-xs font-medium">Decision
                      <select className={control} value={decision} onChange={e => { setDecision(e.target.value); setCurrentIndex(0); }}>
                        <option value="all">All items</option>
                        <option value="pending">Undecided</option>
                        <option value="decided">Decided or drafted</option>
                      </select>
                    </label>
                    <label className="text-xs font-medium">Sort
                      <select className={control} value={sort} onChange={e => setSort(e.target.value)}>
                        <option value="risk">Lowest confidence first</option>
                        <option value="severity">Highest severity first</option>
                      </select>
                    </label>
                    {hasMatches && (
                      <label className="text-xs font-medium">Match type
                        <select className={control} value={matchFilter} onChange={e => { setMatchFilter(e.target.value); setCurrentIndex(0); }}>
                          <option value="all">All matches</option>
                          {matchTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  {activeFilters && <Button variant="ghost" size="sm" className="mt-3" onClick={clearFilters}>Clear filters</Button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type FindingCardProps = {
  dir: "forward" | "back";
  item: QualityItem;
  draft?: DecisionDraft;
  disabled: boolean;
  index: number;
  total: number;
  labels: Record<string, string>;
  onDecide(draft: DecisionDraft | undefined): void;
  onPrev(): void;
  onNext(): void;
};

function FindingCard({ dir, item, draft, disabled, index, total, labels, onDecide, onPrev, onNext }: FindingCardProps) {
  const [pendingForm, setPendingForm] = useState<"edit" | "ignore" | null>(
    draft?.decision === "edit" || draft?.decision === "ignore" ? draft.decision : null
  );
  const [editedValue, setEditedValue] = useState(draft?.edited_value ?? item.cells[0]?.after ?? item.cells[0]?.before ?? "");
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [flashDecision, setFlashDecision] = useState<string | null>(null);

  const formDraft: DecisionDraft | undefined = pendingForm === "edit"
    ? { decision: "edit", edited_value: editedValue, reason }
    : pendingForm === "ignore"
    ? { decision: "ignore", reason }
    : undefined;
  const formError = formDraft ? decisionError(formDraft, item) : undefined;

  function pickVerdict(value: DecisionDraft["decision"]) {
    if (disabled) return;
    if (value === "accept" || value === "reject") {
      setPendingForm(null);
      setFlashDecision(value);
      setTimeout(() => setFlashDecision(null), 360);
      onDecide({ decision: value });
      return;
    }
    if (pendingForm === value) { setPendingForm(null); return; }
    setPendingForm(value);
    setEditedValue(draft?.edited_value ?? item.cells[0]?.after ?? item.cells[0]?.before ?? "");
    setReason(draft?.reason ?? "");
  }

  function confirmForm() {
    if (!pendingForm || formError) return;
    onDecide(formDraft!);
    setPendingForm(null);
  }

  return (
    <article className="finding-card" data-dir={dir} aria-label={`Finding ${index + 1} of ${total}: ${item.title}`}>
      <div className="card-nav">
        <button type="button" className="card-nav-btn" disabled={index === 0} onClick={onPrev} aria-label="Previous finding">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="card-nav-count">{index + 1} / {total}</span>
        <button type="button" className="card-nav-btn" disabled={index === total - 1} onClick={onNext} aria-label="Next finding">
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="finding-meta">
        <span className="finding-badge finding-badge-type">{labels[item.kind] ?? item.kind}</span>
        <span className={`finding-badge finding-badge-sev finding-badge-${item.severity}`}>{item.severity}</span>
        {item.confidence !== undefined && (
          <span className="finding-confidence" data-level={item.confidence >= 0.85 ? "high" : item.confidence >= 0.7 ? "medium" : "low"}>
            {Math.round(item.confidence * 100)}% confidence
          </span>
        )}
        <span className="finding-location">{locationLabel(item)}{item.filename ? ` · ${item.filename}` : ""}</span>
      </div>

      <h2 className="finding-title">{item.title}</h2>
      <p className="finding-reason">{item.reason}</p>

      {item.cells.length > 0 && (
        <div className="finding-diff" aria-label="Before and proposed after values">
          <table>
            <thead><tr><th className="col-ref"></th><th>Before</th><th>After (proposed)</th></tr></thead>
            <tbody>
              {item.cells.map((cell, i) => (
                <tr key={`${cell.coordinate}-${i}`}>
                  <td className="col-ref">{cell.coordinate}</td>
                  <td className="col-before">{cell.before === null ? <em className="text-muted-foreground not-italic">Empty</em> : cell.before}</td>
                  <td className="col-after">{cell.after === undefined ? "—" : cell.after === null ? <em className="text-muted-foreground not-italic">Empty</em> : cell.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {item.pattern !== undefined && (
        <p className="finding-pattern">
          <span className="font-medium">Pattern:</span> {item.pattern}
          {item.affectedCount !== undefined && <> · {item.affectedCount} affected cells</>}
        </p>
      )}

      {item.formula && (
        <section aria-label="Formula evidence" className="evidence-block mt-3">
          <h4 className="text-sm font-medium">Formula</h4>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-sm">{item.formula.text}</pre>
          <p className="mt-2 text-sm">{item.formula.syntax === "verified" ? "Syntax checked. Formula results have not been calculated. Confirm that this calculation matches your instructions." : item.formula.syntax === "invalid" ? "Invalid syntax." : "Syntax unverified."}</p>
          {item.formula.diagnostic && <p className="mt-1 break-words text-sm">{item.formula.diagnostic}</p>}
          <p className="mt-2 text-sm text-muted-foreground">Referenced columns: {item.formula.referencedColumns.join(", ") || "None"}</p>
        </section>
      )}
      {item.kind === "formula" && !item.formula && <p className="mt-3 text-sm text-muted-foreground">Formula evidence unavailable. Acceptance blocked.</p>}
      {item.match && (
        <details className="finding-evidence mt-3">
          <summary>Show evidence</summary>
          <div className="mt-3">
            <section aria-label="Match evidence" className="evidence-block">
              <span className="rounded-full border px-3 py-1 text-xs font-medium">{item.match.type}</span>
              <p className="mt-3 break-all text-sm">Source key: {item.match.sourceKey}</p>
              <p className="mt-2 break-all text-sm">Candidate target keys: {item.match.targetKeys.join(", ") || "None"}</p>
              {item.match.type === "unmatched" && <p className="mt-2 text-sm text-muted-foreground">Skipped. No new row will be inserted.</p>}
            </section>
          </div>
        </details>
      )}

      {item.requiresDecision ? (
        <div className="verdict-section">
          {item.formula && item.formula.syntax !== "verified" && (
            <p role="note" className="notice notice-warning text-xs mb-3">Accept blocked until syntax checks pass. Reject or ignore to proceed.</p>
          )}
          <div className="verdict-row" role="group" aria-label="Your decision">
            {item.allowedDecisions.map(value => {
              const blocked = Boolean(decisionError({ decision: value, edited_value: "", reason: "reason" }, item));
              const isActive = draft?.decision === value || pendingForm === value;
              return (
                <button key={value} type="button" className={`verdict-btn verdict-btn-${value}`}
                  data-active={isActive ? "true" : undefined}
                  data-flash={flashDecision === value ? "true" : undefined}
                  disabled={disabled || blocked} aria-pressed={isActive}
                  onClick={() => pickVerdict(value)}>
                  {value[0].toUpperCase() + value.slice(1)}
                  {!disabled && (value === "accept" || value === "reject") && (
                    <span className="kbd-hint" aria-hidden="true">{value === "accept" ? "A" : "R"}</span>
                  )}
                </button>
              );
            })}
          </div>

          {pendingForm && (
            <div className="verdict-form">
              {pendingForm === "edit" && item.match && (
                <label className="block text-sm">Target row
                  <select className={control} value={editedValue} onChange={e => setEditedValue(e.target.value)}>
                    <option value="">Choose a target row</option>
                    {item.match.targetKeys.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
              )}
              {pendingForm === "edit" && !item.match && (
                <label className="block text-sm">Replacement value
                  <textarea className={control} value={editedValue} onChange={e => setEditedValue(e.target.value)} />
                </label>
              )}
              <label className="block text-sm mt-2">
                Reason {pendingForm === "ignore" ? "(required)" : "(optional)"}
                <textarea className={control} value={reason} onChange={e => setReason(e.target.value)} />
              </label>
              {formError && <p role="alert" className="text-sm text-destructive mt-2">{formError}</p>}
              <Button size="sm" className="mt-3" disabled={Boolean(formError)} onClick={confirmForm}>
                Confirm {pendingForm}
              </Button>
            </div>
          )}

          {!disabled && !pendingForm && (
            <p className="verdict-keyboard-hint">
              Press <kbd>A</kbd> to accept · <kbd>R</kbd> to reject · <kbd>←</kbd><kbd>→</kbd> to navigate
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center mt-6">Decision recorded.</p>
      )}
    </article>
  );
}

function locationLabel(item: QualityItem) {
  return [item.sheet, item.column, item.row === undefined ? undefined : `Row ${item.row}`].filter(Boolean).join(" · ") || "Location not supplied";
}

function dotState(item: QualityItem, draft?: DecisionDraft): string {
  if (draft?.decision === "accept") return "accepted";
  if (draft?.decision === "reject") return "rejected";
  if (draft?.decision === "edit") return "edited";
  if (draft?.decision === "ignore") return "ignored";
  if (item.status === "human_accepted") return "accepted";
  if (item.status === "human_rejected") return "rejected";
  if (item.status === "human_edited") return "edited";
  if (item.status === "human_ignored") return "ignored";
  if (!item.requiresDecision) return "reference";
  return "pending";
}
