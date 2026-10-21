// TEMPORARY FRONTEND VIEW MODELS, not request/response DTOs or tool schemas.
// A future adapter must validate BE responses before mapping into these models.
import type { JobFormValues } from "@/schemas/job-creation";
import type { CellContent } from "./cell-content";
import type { HeaderConfirmationViewModel, WorkbookMetadata } from "./workbook";
import type { MatchType, OutputPolicy, ProposalStatus, ReviewRevisionViewModel } from "./review";
import type { WorkflowReadiness } from "./workflow-readiness";

export interface WorkbookSelectionViewModel {
  readonly file: File | null; // Browser selection, not proof of upload.
  readonly selectedSheet: string | null;
  readonly selectedKeyColumn: string | null;
  readonly metadata: WorkbookMetadata | null;
  readonly header: HeaderConfirmationViewModel;
}

export interface JobConfigurationViewModel {
  // Reuse validated local fields. Prompt is the UI name for Comment Name.
  readonly form: Omit<JobFormValues, "currentFile" | "currentFiles" | "mainFile">;
  readonly current: WorkbookSelectionViewModel;
  readonly main: WorkbookSelectionViewModel;
  readonly outputPolicy: OutputPolicy;
  readonly localValidation: "incomplete" | "valid" | "invalid";
  readonly readiness: WorkflowReadiness;
}

export interface JobViewModel {
  readonly id: string;
  // No claim to enumerate unpublished backend statuses.
  readonly statusLabel: string;
  readonly reviewRevision: ReviewRevisionViewModel | null;
}

export interface IssueViewModel {
  readonly id: string;
  readonly summary: string;
  readonly locationLabel: string;
  readonly severityLabel: string;
  readonly status: ProposalStatus;
  readonly before?: CellContent;
  readonly after?: CellContent;
}

interface ProposalBaseViewModel {
  readonly id: string;
  readonly status: ProposalStatus;
  // Optional [0,1] display score, validated by a future adapter. No auto-approval.
  readonly confidence?: number;
}

export interface PatternRuleViewModel extends ProposalBaseViewModel {
  readonly kind: "value-pattern-rule";
  readonly originalPattern: string;
  readonly transformation: string;
  readonly examples: readonly { readonly before: CellContent; readonly after: CellContent }[];
  readonly affectedCellCount?: number;
}

export interface UpdateMatchViewModel extends ProposalBaseViewModel {
  readonly kind: "update-match";
  readonly matchType: MatchType;
  readonly currentRowLabel: string;
  // Backend candidates only; FE does not generate, rank, or cap candidates.
  readonly candidateLabels: readonly string[];
}

export type ProposalViewModel = PatternRuleViewModel | UpdateMatchViewModel;

export type ArtifactViewModel =
  | { readonly kind: "final-xlsx"; readonly base: "current-derived" | "main-derived"; readonly availability: "awaiting-backend" }
  | { readonly kind: "change-report-json" | "review-summary-markdown"; readonly availability: "awaiting-backend" };
