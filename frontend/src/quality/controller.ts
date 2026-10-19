import { ApiError } from "@/api/errors";
import { qualitySnapshotSchema, transformationKinds, type QualityItem, type DecisionDraft, type QualityReviewAdapter, type QualitySnapshot } from "./types";

export type ReviewStage = "quality" | "transformation";
export const reviewGates = { quality: ["QUALITY_REVIEW_PENDING"], transformation: ["FORMULA_REVIEW_PENDING", "TRANSFORMATION_REVIEW_PENDING"] };

export interface QualityState {
  phase: "idle" | "loading" | "ready" | "submitting" | "submitted" | "error";
  snapshot?: QualitySnapshot;
  drafts: Record<string, DecisionDraft>;
  error?: string;
  reloadRequired: boolean;
  reviewId?: string;
  reportedStatus?: string;
  stage?: ReviewStage;
}
export function decisionError(draft: DecisionDraft, item?: QualityItem): string | undefined {
  if (item?.kind === "formula" && ["accept", "edit"].includes(draft.decision) && (item.formula?.syntax !== "verified" || draft.decision === "edit")) return "Only backend syntax-verified formulas may be accepted. Edited formulas require backend revalidation; reject and request a new proposal.";
  if (item?.kind === "update-match" && ["accept", "edit"].includes(draft.decision) && (!item.match || item.match.type === "unmatched" || !item.match.targetKeys.length)) return "Unmatched rows are skipped. A verified match is required before approval.";
  if (draft.decision === "edit" && typeof draft.edited_value !== "string") return "Enter an edited value, including an empty value if intentional.";
  if (draft.decision === "ignore" && !draft.reason?.trim()) return "A reason is required to ignore an issue.";
}
// High confidence never replaces a human decision on ambiguous evidence.
export function bulkCandidates(state: QualityState, threshold: number, ids: readonly string[]): QualityItem[] {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 || state.phase !== "ready" || state.reloadRequired || !state.snapshot?.complete || !reviewGates[state.stage ?? "quality"].includes(state.snapshot.status)) return [];
  const scope = new Set(ids);
  return state.snapshot.items.filter((item) => scope.has(item.id) && item.requiresDecision && item.status === "proposed" && !state.drafts[item.id] && item.allowedDecisions.includes("accept") && item.confidence !== undefined && item.confidence >= threshold && !decisionError({ decision: "accept" }, item) && (item.kind !== "update-match" || Boolean(item.match && ["exact", "normalized"].includes(item.match.type))));
}
export function submissionBlocker(state: QualityState): string | undefined {
  if (state.phase !== "ready" || state.reloadRequired) return "Load a fresh review before submitting.";
  if (!state.snapshot?.complete) return "The complete backend review must be loaded before submitting.";
  if (!reviewGates[state.stage ?? "quality"].includes(state.snapshot.status)) return `This job is not waiting for ${state.stage ?? "quality"} review.`;
  const required = state.snapshot.items.filter((item) => item.requiresDecision && item.status === "proposed");
  if (!required.length) return "No pending decisions to submit.";
  if (required.some((item) => !state.drafts[item.id])) return "Decide every required item before submitting the review.";
  if (Object.entries(state.drafts).some(([id, draft]) => {
    const item = required.find((candidate) => candidate.id === id);
    return !item || !item.allowedDecisions.includes(draft.decision) || Boolean(decisionError(draft, item));
  })) return "Correct invalid or unavailable decisions before submitting.";
}
export function createQualityReviewFlow(jobId: string, adapter: QualityReviewAdapter, stage: ReviewStage = "quality") {
  const emptyDrafts = () => Object.create(null) as Record<string, DecisionDraft>;
  let state: QualityState = { phase: "idle", drafts: emptyDrafts(), reloadRequired: false, stage };
  let active: AbortController | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: QualityState) => { state = next; listeners.forEach((listener) => listener()); };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load() {
      if (active) return;
      const controller = new AbortController(); active = controller; const version = ++generation;
      // Explicit reload discards stale drafts. Never rebase to a new revision.
      publish({ phase: "loading", drafts: emptyDrafts(), reloadRequired: false, stage });
      try {
        const snapshot = qualitySnapshotSchema.parse(await adapter.load(jobId, controller.signal));
        if (controller.signal.aborted || generation !== version) return;
        if (snapshot.jobId !== jobId) throw new ApiError("protocol", "Review job identity mismatch.");
        if (snapshot.items.some((item) => (transformationKinds as readonly string[]).includes(item.kind) !== (stage === "transformation"))) throw new ApiError("protocol", "The report contains items from a different review stage.");
        publish({ phase: "ready", snapshot, drafts: emptyDrafts(), reloadRequired: false, stage });
      } catch (error) {
        if (!controller.signal.aborted && generation === version) publish({ phase: "error", drafts: emptyDrafts(), reloadRequired: true, stage, error: safeError(error, `${stage === "quality" ? "Quality" : "Transformation"} review could not be loaded.`) });
      } finally { if (active === controller) active = undefined; }
    },
    decide(id: string, draft: DecisionDraft | undefined) {
      if (state.phase !== "ready" || state.reloadRequired) return;
      const item = state.snapshot?.items.find((entry) => entry.id === id);
      if (!item || item.status !== "proposed" || !item.requiresDecision || (draft && !item.allowedDecisions.includes(draft.decision))) return;
      const drafts: Record<string, DecisionDraft> = Object.assign(emptyDrafts(), state.drafts);
      if (draft) drafts[id] = { ...draft }; else delete drafts[id];
      publish({ ...state, drafts });
    },
    async submit() {
      if (active || submissionBlocker(state) || !state.snapshot) return;
      const snapshot = state.snapshot;
      const controller = new AbortController(); active = controller; const version = ++generation;
      const decisions = Object.fromEntries(Object.entries(state.drafts).map(([id, draft]) => [id, { ...draft }]));
      publish({ ...state, phase: "submitting", error: undefined });
      try {
        const result = await adapter.submit(jobId, snapshot.revision, decisions, controller.signal);
        if (controller.signal.aborted || version !== generation) return;
        if (result.job.job_id !== jobId || result.job.revision <= snapshot.revision || !result.review_id) throw new ApiError("protocol", "Review acknowledgement mismatch.");
        publish({ ...state, phase: "submitted", reviewId: result.review_id, reportedStatus: result.job.status });
      } catch (error) {
        if (controller.signal.aborted || version !== generation) return;
        const definitive = error instanceof ApiError && [400, 401, 403, 422].includes(error.status ?? 0);
        publish({ ...state, phase: definitive ? "ready" : "error", reloadRequired: !definitive,
          error: error instanceof ApiError && error.status === 409 ? "The server revision changed. Reload the review and decide again; nothing was resubmitted." : safeError(error, "The review outcome is unknown. Reload server state before trying again.") });
      } finally { if (active === controller) active = undefined; }
    },
    dispose() { generation++; active?.abort(); active = undefined; },
  };
}
function safeError(error: unknown, fallback: string) {
  return error instanceof ApiError ? `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ""}` : fallback;
}
export type QualityReviewFlow = ReturnType<typeof createQualityReviewFlow>;
