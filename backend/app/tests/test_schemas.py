"""Self-check for the scaffold's only real logic: state transitions (§6)."""
import pytest

from app.domain.enums import JobStatus as S
from app.domain.schemas import JobConfig
from app.domain.state_machine import validate_transition


def test_forward_and_optional_skip_ok():
    validate_transition(S.DRAFT, S.UPLOADING)
    validate_transition(S.QUALITY_REVIEW_PENDING, S.UPDATE_PENDING)  # skip optional states


def test_backward_and_terminal_rejected():
    with pytest.raises(ValueError):
        validate_transition(S.UPLOADED, S.DRAFT)
    with pytest.raises(ValueError):
        validate_transition(S.COMPLETED, S.FAILED)
    with pytest.raises(ValueError):
        validate_transition(S.INSPECTING, S.COMPLETED)  # only from VALIDATING_OUTPUT


def test_failure_reachable_from_live_state():
    validate_transition(S.INSPECTING, S.FAILED)


def test_non_terminal_self_transition_ok():
    validate_transition(S.UPLOADING, S.UPLOADING)  # partial-upload confirm stays UPLOADING
    with pytest.raises(ValueError):
        validate_transition(S.COMPLETED, S.COMPLETED)  # terminal self still blocked


def test_retry_reenters_live_state_from_failed():
    validate_transition(S.FAILED, S.NORMALIZATION_PENDING)  # retry segment 2
    validate_transition(S.FAILED, S.INSPECTING)             # retry segment 1
    with pytest.raises(ValueError):
        validate_transition(S.FAILED, S.COMPLETED)          # cannot retry straight to terminal
    with pytest.raises(ValueError):
        validate_transition(S.CANCELLED, S.INSPECTING)      # cancelled stays terminal


def test_output_policy_and_main_file_requirement():
    assert JobConfig(comment_name="x", standardize=True, update=True, key_column="CustomerID").output_policy().value == "both"
    assert JobConfig(comment_name="x").requires_main_file() is False
    assert JobConfig(comment_name="x", update=True, key_column="CustomerID").requires_main_file() is True
    assert JobConfig(comment_name="x", update=True, key_column="CustomerID").conflict_policy == "reject_all"
    # Keys are chosen from actual metadata after upload and enforced at Start.
    assert JobConfig(comment_name="x", update=True).key_column is None
