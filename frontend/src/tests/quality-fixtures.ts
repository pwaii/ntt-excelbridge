import type { QualityItem, QualitySnapshot } from "@/quality/types";
import base from "./fixtures/backend/current-get.json";

// Synthetic normalized UI data only. Never imported by application routes.
export const qualityJobId = base.job.job_id;
export function qualityItem(overrides: Partial<QualityItem> = {}): QualityItem {
  return { id: "issue-1", kind: "type-mismatch", title: "Date format differs", severity: "medium", reason: "Dates use a different format.",
    sheet: "Synthetic sheet", row: 3, column: "A", cells: [{ coordinate: "A3", before: "31/12/2025", after: "2025-12-31" }],
    confidence: 0.7, status: "proposed", requiresDecision: true, allowedDecisions: ["accept", "reject", "edit", "ignore"], ...overrides };
}
export function qualitySnapshot(overrides: Partial<QualitySnapshot> = {}): QualitySnapshot {
  return { jobId: qualityJobId, revision: 7, status: "QUALITY_REVIEW_PENDING", complete: true, items: [qualityItem()], ...overrides };
}
export function qualityReceipt(revision = 8) {
  return { ...base, job: { ...base.job, revision, status: "QUALITY_REVIEW_PENDING" as const }, review_id: "synthetic-review-1" };
}
