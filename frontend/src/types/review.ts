import type { components } from "@/api/generated/backend";

// Display labels follow the published review report vocabulary.
export type OutputPolicy = "standardize_only" | "update_only" | "both" | "neither";
export type ReviewDecision = components["schemas"]["ReviewDecision"];
export type ProposalStatus = NonNullable<components["schemas"]["ReportItem"]["status"]>;
export type MatchType = components["schemas"]["MatchEvidence"]["type"];

export const proposalStatusLabels = {
  proposed: "Proposed", human_accepted: "Human accepted",
  human_edited: "Human edited", human_rejected: "Human rejected",
  human_ignored: "Human ignored",
} as const satisfies Record<ProposalStatus, string>;

// Server-owned; the browser must never increment this. Token format is provisional.
export interface ReviewRevisionViewModel { readonly serverToken: string }

export interface ReviewDecisionDraft {
  readonly proposalId: string;
  readonly decision: ReviewDecision;
  readonly editedValue?: string;
  readonly reason?: string;
}

export interface ReviewSubmissionDraft {
  readonly revision: ReviewRevisionViewModel;
  readonly decisions: readonly ReviewDecisionDraft[];
}

export type ReviewSubmissionState =
  | { readonly state: "idle" }
  | { readonly state: "pending"; readonly submission: ReviewSubmissionDraft }
  | {
      readonly state: "reload-required";
      readonly reason: "revision-conflict";
      readonly httpStatus: 409;
      readonly code: "REVIEW_REVISION_CONFLICT";
      readonly submission: ReviewSubmissionDraft;
    };
