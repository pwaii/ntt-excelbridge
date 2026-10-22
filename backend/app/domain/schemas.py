"""Pydantic schemas: job config, API review requests, and the five Bedrock tool
outputs. Tool outputs are the trust boundary — every AI response is parsed through
these and rejected if it doesn't fit (§10). Keep in sync with prompts/ and frontend/src/types.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import MatchType, OutputPolicy, ReviewDecision


# --- Job configuration (§5.1) ---
class JobConfig(BaseModel):
    comment_name: str = Field(min_length=1, max_length=200)
    output_header: str | None = None  # derived from comment_name if empty (§3.1)
    standardize: bool = False
    update: bool = False
    input_sheet: str | None = None
    main_sheet: str | None = None
    key_column: str | None = None  # business key for matching (§3.2)
    conflict_policy: Literal["reject_all", "latest_wins", "merge"] = "reject_all"
    input_header_row: int | None = Field(default=None, ge=1, le=20)
    main_header_row: int | None = Field(default=None, ge=1, le=20)
    main_key_column: str | None = None

    def output_policy(self) -> OutputPolicy:
        if self.standardize and self.update:
            return OutputPolicy.BOTH
        if self.standardize:
            return OutputPolicy.STANDARDIZE_ONLY
        if self.update:
            return OutputPolicy.UPDATE_ONLY
        return OutputPolicy.NEITHER

    def requires_main_file(self) -> bool:
        return self.standardize or self.update


# --- Review submission (§11) ---
class ReviewItemDecision(BaseModel):
    decision: ReviewDecision
    edited_value: str | None = None
    reason: str | None = None


class ReviewRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    decisions: dict[str, ReviewItemDecision] = Field(min_length=1)  # keyed by issue/proposal id
    approved_by: str | None = None  # populated from authenticated Cognito subject


class CreateJobRequest(BaseModel):
    config: JobConfig
    # `input_filename` remains accepted for older clients. New clients send
    # the complete current-workbook selection in `input_filenames`.
    input_filename: str | None = Field(default=None, min_length=1, max_length=255)
    input_filenames: list[str] = Field(default_factory=list, max_length=8)
    main_filename: str | None = Field(default=None, max_length=255)


class UploadCompleteRequest(BaseModel):
    slot: str = Field(pattern=r"^(input|input_[2-8]|main)$")
    sha256: str | None = Field(default=None, min_length=64, max_length=64, pattern=r"^[0-9a-fA-F]{64}$")


# --- Tool #1: semantic verification (§10.2) ---
class ColumnMatch(BaseModel):
    column_id: str
    confidence: float = Field(ge=0, le=1)
    reason: str


class Tool1Output(BaseModel):
    meaning: str
    existing_column_matches: list[ColumnMatch] = []
    recommended_output_header: str
    interpretation: str
    confidence: float = Field(ge=0, le=1)
    status: str  # confirmed | ambiguous | not_found
    questions_for_human: list[str] = []


# --- Tool #2: type normalization (§10.3, ADR D4: one rule per value-pattern) ---
class Tool2Rule(BaseModel):
    pattern: str            # e.g. "DD/MM/YYYY"
    example_original: str   # a representative raw value (redacted sample)
    normalized_form: str    # e.g. "ISO date YYYY-MM-DD"
    confidence: float = Field(ge=0, le=1)
    status: str             # safe | ambiguous | reject
    reason: str


class Tool2Output(BaseModel):
    column_id: str
    target_type: str
    rules: list[Tool2Rule]


# --- Tool #3: formula generation (§10.4) ---
class Tool3Output(BaseModel):
    formula_template: str
    target_header: str
    expected_type: str
    referenced_headers: list[str]
    explanation: str
    confidence: float = Field(ge=0, le=1)


# --- Tool #4: standardization mapping (§10.5) ---
class Tool4Mapping(BaseModel):
    # Excel cells may be numeric even when the logical field is text.
    model_config = ConfigDict(coerce_numbers_to_str=True)
    source_field: str
    source_value: str
    canonical_field: str
    canonical_value: str
    reason: str
    confidence: float = Field(ge=0, le=1)
    cardinality: str  # one_to_one | many_to_one | unmapped
    action: str       # safe | ambiguous | rejected


class Tool4Output(BaseModel):
    mappings: list[Tool4Mapping]


# --- Tool #5: update matching (§10.6) ---
class Tool5Match(BaseModel):
    # Business keys and row IDs can arrive from Excel as numbers.
    model_config = ConfigDict(coerce_numbers_to_str=True)
    current_row_id: str
    candidate_main_row_ids: list[str]
    selected_main_row_id: str | None = None
    match_type: MatchType
    confidence: float = Field(ge=0, le=1)
    reason: str
    recommended_action: str  # e.g. human_review


class Tool5Output(BaseModel):
    matches: list[Tool5Match]


# --- Response envelope (§10.1, §14.3) ---
# payload is the untrusted model output; meta is Python-computed and trustworthy.
class AuditMeta(BaseModel):
    tool: str
    model_id: str
    prompt_version: str
    input_hash: str
    output_hash: str
    latency_ms: int
    input_tokens: int
    output_tokens: int


class ToolResult[T: BaseModel](BaseModel):
    meta: AuditMeta
    payload: T
