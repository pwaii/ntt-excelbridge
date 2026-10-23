"""Synchronous, in-process workflow driver for the no-Step-Functions path.

When no state-machine ARN is configured, the API drives the real reviewed
pipeline here instead of through AWS Step Functions. Each segment ends at a
human gate (or COMPLETED), mirroring what a `Map`-based ASL would orchestrate:

    segment 1  inspect + quality for every input slot  -> QUALITY_REVIEW_PENDING
    segment 2  bedrock tools for every input slot       -> TRANSFORMATION_REVIEW_PENDING
    segment 3  apply + validate                          -> COMPLETED

Segments 1 and 3 touch no model. Segment 2 calls Bedrock once per tool per slot
(tool-outer, slot-inner, so the per-tool status advances once in tool order while
every slot still produces its proposals).
"""
from __future__ import annotations

from typing import Any

from app.lambda_handlers import (
    _ordered_input_slots,
    apply_handler,
    bedrock_handler,
    inspect_handler,
    quality_handler,
    quality_gate_handler,
    validate_handler,
)
from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store


def run_quality_segment(job_id: str, dynamo: DynamoStore, s3: S3Store) -> dict[str, Any]:
    """Segment 1: inspect + quality every input slot, then open the quality gate."""
    item = dynamo.get_job(job_id)
    if not item:
        raise ValueError("job not found")
    for slot in _ordered_input_slots(item):
        inspect_handler({"job_id": job_id, "slot": slot}, None)
        quality_handler({"job_id": job_id, "slot": slot}, None)
    quality_gate_handler({"job_id": job_id}, None)
    return dynamo.get_job(job_id)


def _segment2_tools(config: dict[str, Any]) -> list[str]:
    tools = ["tool1", "tool2", "tool3"]
    if config.get("standardize"):
        tools.append("tool4")
    if config.get("update"):
        tools.append("tool5")
    return tools


def run_bedrock_segment(job_id: str, dynamo: DynamoStore, s3: S3Store) -> dict[str, Any]:
    """Segment 2: run each tool across every slot, then open the transformation gate.

    Tool-outer / slot-inner ordering lets ``bedrock_handler``'s per-tool status
    transition fire once (on the first slot) while later slots still emit proposals.
    """
    item = dynamo.get_job(job_id)
    if not item:
        raise ValueError("job not found")
    slots = _ordered_input_slots(item)
    for tool in _segment2_tools(item.get("config", {})):
        for slot in slots:
            bedrock_handler({"job_id": job_id, "slot": slot, "tool": tool, "segment": 2}, None)
    quality_gate_handler({"job_id": job_id, "gate": "transformation"}, None)
    return dynamo.get_job(job_id)


def run_apply_segment(job_id: str, dynamo: DynamoStore, s3: S3Store) -> dict[str, Any]:
    """Segment 3: apply accepted changes for every slot, then validate -> COMPLETED."""
    apply_handler({"job_id": job_id}, None)
    validate_handler({"job_id": job_id}, None)
    return dynamo.get_job(job_id)
