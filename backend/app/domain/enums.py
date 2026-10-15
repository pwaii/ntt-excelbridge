"""Shared enums — the vocabulary of the workflow. See plan §6, §11, §14."""
from enum import Enum


class JobStatus(str, Enum):
    DRAFT = "DRAFT"
    UPLOADING = "UPLOADING"
    UPLOADED = "UPLOADED"
    INSPECTING = "INSPECTING"
    DETECTED = "DETECTED"
    SEMANTIC_REVIEW_PENDING = "SEMANTIC_REVIEW_PENDING"
    QUALITY_REVIEW_PENDING = "QUALITY_REVIEW_PENDING"
    NORMALIZATION_PENDING = "NORMALIZATION_PENDING"
    FORMULA_REVIEW_PENDING = "FORMULA_REVIEW_PENDING"
    STANDARDIZATION_PENDING = "STANDARDIZATION_PENDING"
    UPDATE_PENDING = "UPDATE_PENDING"
    TRANSFORMATION_REVIEW_PENDING = "TRANSFORMATION_REVIEW_PENDING"
    APPLYING = "APPLYING"
    VALIDATING_OUTPUT = "VALIDATING_OUTPUT"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    COST_GUARD_REACHED = "COST_GUARD_REACHED"  # §15 — halts new AI calls


class EntityType(str, Enum):
    JOB = "job"
    ISSUE = "issue"
    PROPOSAL = "proposal"
    REVIEW = "review"
    EVENT = "event"


class OutputPolicy(str, Enum):
    STANDARDIZE_ONLY = "standardize_only"
    UPDATE_ONLY = "update_only"
    BOTH = "both"
    NEITHER = "neither"


class ReviewDecision(str, Enum):
    ACCEPT = "accept"
    REJECT = "reject"
    EDIT = "edit"
    IGNORE = "ignore"


class ProposalStatus(str, Enum):
    PROPOSED = "proposed"
    HUMAN_ACCEPTED = "human_accepted"
    HUMAN_EDITED = "human_edited"
    HUMAN_REJECTED = "human_rejected"


class MatchType(str, Enum):
    EXACT = "exact"
    NORMALIZED = "normalized"
    AMBIGUOUS = "ambiguous"
    DUPLICATE = "duplicate"
    CONFLICT = "conflict"
    UNMATCHED = "unmatched"


class ErrorCode(str, Enum):
    UNSUPPORTED_FILE = "UNSUPPORTED_FILE"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    TOO_MANY_ROWS = "TOO_MANY_ROWS"
    MAIN_FILE_REQUIRED = "MAIN_FILE_REQUIRED"
    REVIEW_REVISION_CONFLICT = "REVIEW_REVISION_CONFLICT"  # -> HTTP 409
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    MODEL_OUTPUT_INVALID = "MODEL_OUTPUT_INVALID"
    COST_GUARD_REACHED = "COST_GUARD_REACHED"
    VALIDATION_FAILED = "VALIDATION_FAILED"
