// Temporary frontend display vocabulary. Server enum mapping awaits BE OpenAPI.
export type OutputPolicy = "standardize_only" | "update_only" | "both" | "neither";
export type ReviewDecision = "accept" | "reject" | "edit" | "ignore";
export type ProposalStatus = "proposed" | "human_accepted" | "human_edited" | "human_rejected";
export type MatchType = "exact" | "normalized" | "ambiguous" | "duplicate" | "conflict" | "unmatched";

export const proposalStatusLabels = {
  proposed: "Proposed", human_accepted: "Human accepted",
  human_edited: "Human edited", human_rejected: "Human rejected",
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
