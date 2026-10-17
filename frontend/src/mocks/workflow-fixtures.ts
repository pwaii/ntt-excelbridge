// MOCK ONLY: synthetic deterministic frontend fixtures. No backend operations have
// occurred. Never imported by routes, pages, API clients, or production state.
import type { CellContent } from "@/types/cell-content";
import type { IssueViewModel, JobViewModel, PatternRuleViewModel, UpdateMatchViewModel } from "@/types/workflow";
import type { ReviewSubmissionState } from "@/types/review";

export const MOCK_NOTICE = "MOCK: synthetic UI examples; no job has been created or processed.";

export const mockJob = {
  id: "mock-job-not-created", statusLabel: "Mock review state",
  reviewRevision: { serverToken: "mock-server-revision-A" },
} as const satisfies JobViewModel;

export const mockIssues = [{
  id: "mock-issue-blank", summary: "Mock blank value", locationLabel: "Mock sheet, B4",
  severityLabel: "Mock warning", status: "proposed",
  before: { origin: "data", value: "" },
}] as const satisfies readonly IssueViewModel[];

// One object per VALUE PATTERN, not per affected cell. Counts/examples are mock.
export const mockPatternRules = [
  { id: "mock-rule-dates", kind: "value-pattern-rule", originalPattern: "DD/MM/YYYY", transformation: "Convert to ISO date YYYY-MM-DD", examples: [{ before: { origin: "data", value: "16/10/2026" }, after: { origin: "data", value: "2026-10-16" } }], affectedCellCount: 24, confidence: 0.94, status: "proposed" },
  { id: "mock-rule-trim", kind: "value-pattern-rule", originalPattern: "Outer whitespace", transformation: "Trim outer whitespace", examples: [{ before: { origin: "data", value: " Example " }, after: { origin: "data", value: "Example" } }], affectedCellCount: 8, status: "human_accepted" },
  { id: "mock-rule-yes", kind: "value-pattern-rule", originalPattern: "Y / Yes", transformation: "Map explicitly reviewed values to true", examples: [{ before: { origin: "data", value: "Y" }, after: { origin: "data", value: "true" } }], confidence: 0.8, status: "human_edited" },
  { id: "mock-rule-identifiers", kind: "value-pattern-rule", originalPattern: "Zero-prefixed identifier", transformation: "Remove leading zeroes (rejected mock proposal)", examples: [{ before: { origin: "data", value: "00123" }, after: { origin: "data", value: "123" } }], status: "human_rejected" },
] as const satisfies readonly PatternRuleViewModel[];

export const mockUpdateMatches = [
  { id: "mock-match-exact", kind: "update-match", matchType: "exact", currentRowLabel: "Mock current row 2", candidateLabels: ["Mock main row 8"], confidence: 0.99, status: "proposed" },
  { id: "mock-match-normalized", kind: "update-match", matchType: "normalized", currentRowLabel: "Mock current row 3", candidateLabels: ["Mock main row 9"], confidence: 0.95, status: "human_accepted" },
  { id: "mock-match-ambiguous", kind: "update-match", matchType: "ambiguous", currentRowLabel: "Mock current row 4", candidateLabels: ["Mock main row 10", "Mock main row 11"], confidence: 0.97, status: "proposed" },
  { id: "mock-match-duplicate", kind: "update-match", matchType: "duplicate", currentRowLabel: "Mock current row 5", candidateLabels: ["Mock main row 12", "Mock main row 13"], status: "human_rejected" },
  { id: "mock-match-conflict", kind: "update-match", matchType: "conflict", currentRowLabel: "Mock current row 6", candidateLabels: ["Mock main row 14"], status: "human_edited" },
  { id: "mock-match-unmatched", kind: "update-match", matchType: "unmatched", currentRowLabel: "Mock current row 7", candidateLabels: [], status: "proposed" },
] as const satisfies readonly UpdateMatchViewModel[];

export const mockCellContents = [
  { origin: "data", value: "=UNTRUSTED(A1)" },
  { origin: "data", value: "<img src=x onerror=alert(1)>" },
  { origin: "approved-formula", value: "=SUM(B2:C2)", approvalId: "mock-human-approval-not-real" },
] as const satisfies readonly CellContent[];

export const mockPendingReview = {
  state: "pending",
  submission: { revision: mockJob.reviewRevision, decisions: [{ proposalId: "mock-rule-trim", decision: "accept" }] },
} as const satisfies ReviewSubmissionState;

export const mockRevisionConflict = {
  state: "reload-required", reason: "revision-conflict", httpStatus: 409,
  code: "REVIEW_REVISION_CONFLICT", submission: mockPendingReview.submission,
} as const satisfies ReviewSubmissionState;
