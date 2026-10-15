"""Pydantic schemas: job config, API review requests, and the five Bedrock tool
outputs. Tool outputs are the trust boundary — every AI response is parsed through
these and rejected if it doesn't fit (§10). Keep in sync with prompts/ and frontend/src/types.
"""
from typing import Optional
from pydantic import BaseModel, Field

from app.domain.enums import MatchType, OutputPolicy, ReviewDecision


# --- Job configuration (§5.1) ---
class JobConfig(BaseModel):
    comment_name: str
    output_header: Optional[str] = None  # derived from comment_name if empty (§3.1)
    standardize: bool = False
    update: bool = False
    input_sheet: Optional[str] = None
    main_sheet: Optional[str] = None
    key_column: Optional[str] = None  # business key for matching (§3.2)

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
    edited_value: Optional[str] = None
    reason: Optional[str] = None


class ReviewRequest(BaseModel):
    expected_revision: int
    decisions: dict[str, ReviewItemDecision]  # keyed by issue/proposal id
    approved_by: str  # authenticated Cognito subject


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


# --- Tool #2: type normalization (§10.3) ---
class Tool2CellProposal(BaseModel):
    row_id: str
    original: str
    normalized: str
    confidence: float = Field(ge=0, le=1)
    status: str  # safe | ambiguous | reject
    reason: str


class Tool2Output(BaseModel):
    column_id: str
    target_type: str
    proposals: list[Tool2CellProposal]


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
    current_row_id: str
    candidate_main_row_ids: list[str]
    selected_main_row_id: Optional[str] = None
    match_type: MatchType
    confidence: float = Field(ge=0, le=1)
    reason: str
    recommended_action: str  # e.g. human_review


class Tool5Output(BaseModel):
    matches: list[Tool5Match]
