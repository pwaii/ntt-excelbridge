"""Job state transitions (§6). Monotonic forward with optional-state skipping.

Optional states (FORMULA/STANDARDIZATION/UPDATE) may be skipped depending on job
config, so a transition is valid if it moves strictly forward in ORDER. Terminal
states FAILED/CANCELLED are reachable from any live state; COMPLETED only from
VALIDATING_OUTPUT.
"""
from app.domain.enums import JobStatus as S

ORDER = [
    S.DRAFT, S.UPLOADING, S.UPLOADED, S.INSPECTING, S.DETECTED,
    S.SEMANTIC_REVIEW_PENDING, S.QUALITY_REVIEW_PENDING, S.NORMALIZATION_PENDING,
    S.FORMULA_REVIEW_PENDING, S.STANDARDIZATION_PENDING, S.UPDATE_PENDING,
    S.TRANSFORMATION_REVIEW_PENDING, S.APPLYING, S.VALIDATING_OUTPUT,
]
_INDEX = {s: i for i, s in enumerate(ORDER)}
TERMINAL = {S.COMPLETED, S.FAILED, S.CANCELLED}


def validate_transition(frm: S, to: S) -> None:
    """Raise ValueError if `frm -> to` is not an allowed transition."""
    if frm in TERMINAL:
        if frm is S.FAILED and to not in TERMINAL:
            return  # retry: a failed job may re-enter a live state
        raise ValueError(f"{frm} is terminal; no transition to {to}")
    if frm == to:
        return  # idempotent re-entry: partial-upload confirms keep status UPLOADING
    if to == S.COMPLETED:
        if frm is not S.VALIDATING_OUTPUT:
            raise ValueError(f"COMPLETED only reachable from VALIDATING_OUTPUT, not {frm}")
        return
    if to in (S.FAILED, S.CANCELLED, S.COST_GUARD_REACHED):
        return  # reachable from any live state
    if _INDEX.get(to, -1) <= _INDEX.get(frm, -1):
        raise ValueError(f"transition {frm} -> {to} is not forward")
