"""Published, bounded review evidence shared by API and gate validation."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Stage = Literal["quality", "transformation"]
Decision = Literal["accept", "reject", "edit", "ignore"]


class ReportModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CellEvidence(ReportModel):
    coordinate: str
    before: str | None = None
    after: str | None = None


class FormulaEvidence(ReportModel):
    text: str
    referenced_columns: list[str]
    syntax: Literal["verified", "invalid", "unverified"]
    diagnostic: str | None = None


class MatchEvidence(ReportModel):
    type: Literal["exact", "normalized", "ambiguous", "duplicate", "conflict", "unmatched"]
    source_key: str
    target_keys: list[str]


class ReportItem(ReportModel):
    id: str
    kind: Literal[
        "duplicate-row",
        "blank-row",
        "blank-column",
        "blank-key-field",
        "type-mismatch",
        "semantic",
        "normalization-rule",
        "formula",
        "standardization",
        "update-match",
    ]
    title: str
    severity: Literal["high", "medium", "low"] = "medium"
    reason: str
    slot: str = "input"  # which input workbook this item belongs to
    filename: str | None = None  # that workbook's filename, for grouping in the gate
    cells: list[CellEvidence] = Field(default_factory=list)
    sheet: str | None = None
    row: int | None = None
    column: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    pattern: str | None = None
    affected_count: int | None = None
    formula: FormulaEvidence | None = None
    match: MatchEvidence | None = None
    status: Literal[
        "proposed", "human_accepted", "human_edited", "human_rejected", "human_ignored"
    ] = "proposed"
    requires_decision: bool = True
    allowed_decisions: list[Decision] = Field(
        default_factory=lambda: ["accept", "reject", "ignore"]
    )


class ReviewReportPage(ReportModel):
    job_id: str
    revision: int
    status: str
    stage: Stage
    items: list[ReportItem]
    total: int
    next_cursor: int | None = None
    complete: bool
    request_id: str
