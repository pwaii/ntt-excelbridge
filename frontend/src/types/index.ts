// Shared frontend types. Mirror backend app/domain/{enums,schemas}.py.
// Prefer generating from BE's OpenAPI once available (§18); these are the Day-1 hand-written stand-ins.

export type JobStatus =
  | "DRAFT" | "UPLOADING" | "UPLOADED" | "INSPECTING" | "DETECTED"
  | "SEMANTIC_REVIEW_PENDING" | "QUALITY_REVIEW_PENDING" | "NORMALIZATION_PENDING"
  | "FORMULA_REVIEW_PENDING" | "STANDARDIZATION_PENDING" | "UPDATE_PENDING"
  | "TRANSFORMATION_REVIEW_PENDING" | "APPLYING" | "VALIDATING_OUTPUT"
  | "COMPLETED" | "FAILED" | "CANCELLED" | "COST_GUARD_REACHED";

export type OutputPolicy = "standardize_only" | "update_only" | "both" | "neither";
export type ReviewDecision = "accept" | "reject" | "edit" | "ignore";
export type ProposalStatus = "proposed" | "human_accepted" | "human_edited" | "human_rejected";
export type MatchType = "exact" | "normalized" | "ambiguous" | "duplicate" | "conflict" | "unmatched";

export interface Job {
  job_id: string;
  owner_id: string;
  status: JobStatus;
  config: {
    comment_name: string;
    output_header?: string | null;
    standardize: boolean;
    update: boolean;
    input_sheet?: string | null;
    main_sheet?: string | null;
    key_column?: string | null;
  };
  files: Record<string, {
    filename: string;
    key: string;
    content_type?: string | null;
    size_bytes?: number | null;
    etag?: string | null;
    uploaded: boolean;
  }>;
  revision: number;
  created_at: string;
  updated_at: string;
  output_hash?: string | null;
}

export interface PresignedUpload {
  slot: "input" | "main";
  filename: string;
  key: string;
  url: string;
  expires_in: number;
}

export interface JobResponse {
  job: Job;
  request_id: string;
}

export interface CreateJobResponse extends JobResponse {
  uploads: PresignedUpload[];
}

export interface Issue {
  issue_id: string;
  type: string; // duplicate | blank_row | blank_column | type_mismatch
  sheet: string;
  coordinates: string; // e.g. "B4" or "B4:B9"
  severity: string;
  reason: string;
  before?: string;
  after?: string;
  status: ProposalStatus;
}

export interface Proposal {
  proposal_id: string;
  tool: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  status: ProposalStatus;
  payload: unknown; // shape depends on tool; see docs/ai-plan.md
}

export interface ReviewRevision {
  expected_revision: number;
  approved_by: string;
  decisions: Record<string, { decision: ReviewDecision; edited_value?: string; reason?: string }>;
}

export type ArtifactType = "final_xlsx" | "change_report" | "review_summary";
export interface Artifact {
  type: ArtifactType;
  url: string; // short-lived presigned
}
