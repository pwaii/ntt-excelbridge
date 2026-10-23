"""Single-tool Bedrock worker boundary.

The worker receives a tool name and S3-backed bounded inputs, validates the
response through the existing adapters, and stores only a short proposal summary
in DynamoDB.  Raw prompts and full model responses remain in S3.
"""

from __future__ import annotations

import json
from typing import Any

from app.ai.tool1_semantics import run_tool1
from app.ai.tool2_types import run_tool2
from app.ai.tool3_formulas import run_tool3
from app.ai.tool4_standardize import run_tool4
from app.ai.tool5_update import run_tool5
from app.storage.dynamo_store import DynamoStore
from app.storage.s3_store import S3Store


def _safe_item_summary(tool: str, item: dict[str, Any]) -> dict[str, Any]:
    """Return metadata safe to keep in DynamoDB.

    Full model payloads—including examples, reasons, patterns, and workbook
    values—are already stored in the private S3 proposal artifact. DynamoDB
    only needs enough metadata for list views and routing decisions.
    """

    if tool == "tool2":
        return {
            "kind": "type_rule",
            "status": item.get("status"),
            "confidence": item.get("confidence"),
        }
    if tool == "tool5":
        return {
            "kind": "row_match",
            "match_type": item.get("match_type"),
            "confidence": item.get("confidence"),
            "recommended_action": item.get("recommended_action"),
        }
    return {"kind": "proposal_item"}


def run_tool_segment(job_id: str, tool: str, inputs: dict[str, Any], dynamo: DynamoStore, s3: S3Store, slot: str = "input") -> dict[str, Any]:
    runners = {
        "tool1": run_tool1,
        "tool2": run_tool2,
        "tool3": run_tool3,
        "tool4": run_tool4,
        "tool5": run_tool5,
    }
    if tool not in runners:
        raise ValueError(f"unsupported backend tool: {tool}")
    result = runners[tool](inputs)
    payload = result.payload.model_dump(mode="json")
    proposal_id = f"{tool}-{result.meta.input_hash[:8]}-{result.meta.output_hash[:16]}"
    key = s3.artifact_key(job_id, "proposals", f"{proposal_id}.json")
    body = {"proposal_id": proposal_id, "tool": tool, "meta": result.meta.model_dump(mode="json"), "payload": payload}
    if not s3.object_exists(key):
        s3.put_bytes(key, json.dumps(body, indent=2).encode("utf-8"), "application/json")
    payload_items = []
    if tool == "tool2":
        payload_items = payload.get("rules", [])
    elif tool == "tool5":
        payload_items = payload.get("matches", [])
    elif tool == "tool4":
        payload_items = payload.get("mappings", [])

    if payload_items:
        item_ids = []
        for index, item in enumerate(payload_items):
            item_id = f"{proposal_id}:item:{index}"
            item_ids.append(item_id)
            dynamo.put_child(
                job_id,
                f"PROPOSAL#{item_id}",
                {
                    "entity_type": "proposal",
                    "proposal_id": item_id,
                    "parent_proposal_id": proposal_id,
                    "proposal_index": index,
                    "tool": tool,
                    "artifact_key": key,
                    "status": "proposed",
                    "output_hash": result.meta.output_hash,
                    "summary": _safe_item_summary(tool, item),
                    "slot": slot,
                },
            )
    else:
        item_ids = [proposal_id]
        dynamo.put_child(
            job_id,
            f"PROPOSAL#{proposal_id}",
            {
                "entity_type": "proposal",
                "proposal_id": proposal_id,
                "tool": tool,
                "artifact_key": key,
                "status": "proposed",
                "output_hash": result.meta.output_hash,
                "slot": slot,
            },
        )
    return {"proposal_id": proposal_id, "proposal_item_ids": item_ids, "artifact_key": key, "tool": tool, "status": "proposed"}
