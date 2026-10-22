"""AWS Lambda entry points used by the SAM template and Step Functions."""

from __future__ import annotations

import json
from hashlib import sha256
from io import BytesIO
from typing import Any

from openpyxl import load_workbook

from app.domain.enums import JobStatus
from app.domain.state_machine import ORDER
from app.main import _api_gateway_base_path, app
from app.services.review_report import all_children
from app.settings import settings
from app.storage.dynamo_store import DynamoStore, RevisionConflictError
from app.storage.s3_store import S3Store
from app.workers.apply_changes import (
    apply_accepted_changes,
    apply_accepted_updates,
    apply_workbook_changes,
)
from app.workers.bedrock_worker import run_tool_segment
from app.workers.inspect_workbook import inspect_bytes, manifest_json
from app.workers.matching import build_tool5_inputs, load_canonical_rows
from app.workers.quality_rules import run_quality_rules
from app.workers.validate_output import validate_output


def api_handler(event, context):
    from mangum import Mangum

    return Mangum(app, api_gateway_base_path=_api_gateway_base_path(event))(event, context)


def _stores() -> tuple[DynamoStore, S3Store]:
    return DynamoStore(), S3Store()


# The primary input keeps every existing key/SK unchanged so single-input jobs
# (and their tests) are byte-identical; only extra slots get a namespace suffix.
def _artifact_map_key(base: str, slot: str) -> str:
    return base if slot == "input" else f"{base}_{slot}"


def _artifact_filename(name: str, slot: str) -> str:
    return name if slot == "input" else f"{slot}-{name}"


def _issue_sk(issue_id: str, slot: str) -> str:
    return f"ISSUE#{issue_id}" if slot == "input" else f"ISSUE#{slot}#{issue_id}"


def inspect_handler(event: dict[str, Any], context) -> dict[str, Any]:
    dynamo, s3 = _stores()
    job_id = event["job_id"]
    slot = event.get("slot", "input")
    item = dynamo.get_job(job_id)
    if not item:
        raise ValueError("job not found")
    source = s3.get_bytes(item["files"][slot]["key"])
    manifest = inspect_bytes(source, sheet_name=item.get("config", {}).get("input_sheet"), header_row=item.get("config", {}).get("input_header_row"))
    manifest.update({"job_id": job_id, "input_sha256": sha256(source).hexdigest(), "slot": slot})
    key = s3.artifact_key(job_id, "inspection", _artifact_filename("manifest.json", slot))
    if not s3.object_exists(key):
        s3.put_bytes(key, manifest_json(manifest), "application/json")
    artifacts = dict(item.get("artifacts", {}))
    artifacts[_artifact_map_key("inspection", slot)] = {"key": key, "content_type": "application/json"}
    updated = dynamo.update_job(job_id, int(item["revision"]), {"status": "DETECTED", "artifacts": artifacts})
    return {"job_id": job_id, "slot": slot, "manifest_key": key, "revision": updated["revision"]}


def quality_handler(event: dict[str, Any], context) -> dict[str, Any]:
    dynamo, s3 = _stores()
    job_id = event["job_id"]
    slot = event.get("slot", "input")
    item = dynamo.get_job(job_id)
    if not item:
        raise ValueError("job not found")
    source = s3.get_bytes(item["files"][slot]["key"])
    manifest = inspect_bytes(source, sheet_name=item.get("config", {}).get("input_sheet"), header_row=item.get("config", {}).get("input_header_row"))
    report = run_quality_rules(source, manifest)
    key = s3.artifact_key(job_id, "quality", _artifact_filename("quality-report.json", slot))
    if not s3.object_exists(key):
        s3.put_bytes(key, json.dumps(report, indent=2).encode("utf-8"), "application/json")
    for issue in report["issues"]:
        dynamo.put_child(job_id, _issue_sk(issue["issue_id"], slot), {"entity_type": "issue", "issue_id": issue["issue_id"], "kind": issue["kind"], "summary": issue["message"], "artifact_key": key, "slot": slot})
    artifacts = dict(item.get("artifacts", {}))
    artifacts[_artifact_map_key("quality", slot)] = {"key": key, "content_type": "application/json", "issue_count": report["issue_count"]}
    if item.get("status") == "DETECTED":
        updated = item
    else:
        updated = dynamo.update_job(job_id, int(item["revision"]), {"status": "DETECTED", "artifacts": artifacts})
    if updated.get("artifacts") != artifacts:
        updated = dynamo.update_job(job_id, int(updated["revision"]), {"artifacts": artifacts})
    type_mismatch_count = sum(1 for issue in report["issues"] if issue["kind"] == "type_mismatch")
    return {
        "job_id": job_id,
        "quality_key": key,
        "issue_count": report["issue_count"],
        "type_mismatch_count": type_mismatch_count,
        "revision": updated["revision"],
    }


def bedrock_handler(event: dict[str, Any], context) -> dict[str, Any]:
    dynamo, s3 = _stores()
    job_id = event["job_id"]
    item = dynamo.get_job(job_id)
    if not item:
        raise ValueError("job not found")
    # Keep the pre-AI snapshot only for input selection. The model call can be
    # slow enough for an API or another worker to advance the job revision.
    initial_revision = int(item["revision"])
    slot = event.get("slot", "input")
    tool = event["tool"]
    if tool == "tool2" and not event.get("inputs"):
        batch = _tool_inputs(item, s3, tool, slot)
        proposals = []
        for mismatch in batch.get("mismatches", []):
            proposal_inputs = {
                "column_id": mismatch.get("column_id", ""),
                "target_type": mismatch.get("target_type", "string"),
                "samples": mismatch.get("samples", []),
                "type_distribution": mismatch.get("type_distribution", {}),
                "constraints": mismatch.get("constraints", {}),
            }
            proposals.append(run_tool_segment(job_id, tool, proposal_inputs, dynamo, s3, slot))
        proposal = {"tool": tool, "proposals": proposals, "status": "proposed"}
    else:
        inputs = event.get("inputs") or _tool_inputs(item, s3, tool, slot)
        proposal = run_tool_segment(job_id, tool, inputs, dynamo, s3, slot)
    status_by_tool = {
        "tool3": "FORMULA_REVIEW_PENDING",
        "tool4": "STANDARDIZATION_PENDING",
        "tool5": "UPDATE_PENDING",
    }
    if tool in status_by_tool:
        target = JobStatus(status_by_tool[tool])
        latest = dynamo.get_job(job_id)
        if not latest:
            raise ValueError("job not found after AI processing")
        latest_revision = int(latest["revision"])
        revision_changed = latest_revision != initial_revision
        expected_segment = event.get("segment")
        current_segment = latest.get("workflow_segment")
        same_segment = (
            expected_segment is None
            or current_segment is None
            or int(current_segment) == int(expected_segment)
        )
        predecessors = {
            "tool3": {JobStatus.NORMALIZATION_PENDING},
            "tool4": {JobStatus.FORMULA_REVIEW_PENDING},
            "tool5": {
                JobStatus.FORMULA_REVIEW_PENDING,
                JobStatus.STANDARDIZATION_PENDING,
            },
        }
        current_status = JobStatus(latest["status"])
        status_order = {status: index for index, status in enumerate(ORDER)}
        target_index = status_order[target]
        # A later status means another worker already won the race. Never move
        # it backward merely because this invocation used an older snapshot.
        already_advanced = status_order.get(current_status, -1) >= target_index
        if same_segment and not already_advanced and current_status in predecessors[tool]:
            # A changed revision is expected when another worker/API write won
            # the race. The latest revision is the one used for the CAS below.
            expected_write_revision = latest_revision if revision_changed else initial_revision
            try:
                dynamo.update_job(
                    job_id,
                    expected_write_revision,
                    {
                        "status": target.value,
                        "error_code": None,
                        "error_detail": None,
                    },
                )
            except RevisionConflictError:
                # Reconcile once. A concurrent winner is success; a different
                # live step must not be overwritten by this stale AI call.
                reconciled = dynamo.get_job(job_id)
                if not reconciled:
                    raise ValueError("job disappeared after AI processing")
                reconciled_status = JobStatus(reconciled["status"])
                if not (
                    reconciled_status == target
                    or status_order.get(reconciled_status, -1) > target_index
                ):
                    raise
        # ``initial_revision`` is intentionally not reused for the write:
        # latest revision + step checks above are the concurrency boundary.
    return proposal


def quality_gate_handler(event: dict[str, Any], context) -> dict[str, Any]:
    dynamo, _ = _stores()
    item = dynamo.get_job(event["job_id"])
    if not item:
        raise ValueError("job not found")
    target_status = "TRANSFORMATION_REVIEW_PENDING" if event.get("gate") == "transformation" else "QUALITY_REVIEW_PENDING"
    updated = dynamo.update_job(event["job_id"], int(item["revision"]), {"status": target_status})
    return {"job_id": event["job_id"], "revision": updated["revision"], "status": updated["status"]}


def _tool_inputs(item: dict[str, Any], s3: S3Store, tool: str, slot: str = "input") -> dict[str, Any]:
    source = s3.get_bytes(item["files"][slot]["key"])
    manifest = inspect_bytes(source, sheet_name=item.get("config", {}).get("input_sheet"), header_row=item.get("config", {}).get("input_header_row"))
    first_sheet = manifest["sheets"][0] if manifest["sheets"] else {"headers": [], "columns": []}
    if tool == "tool1":
        return {
            "comment_name": item.get("config", {}).get("comment_name", "new column"),
            "output_header": item.get("config", {}).get("output_header"),
            "current_headers": first_sheet.get("headers", []),
            "normalized_headers": [column.get("normalized_name") for column in first_sheet.get("columns", [])],
            "main_headers": [],
            "type_summaries": [column.get("type_distribution", {}) for column in first_sheet.get("columns", [])],
            "samples": [column.get("samples", []) for column in first_sheet.get("columns", [])],
        }
    if tool == "tool3":
        return {
            "meaning": item.get("config", {}).get("comment_name", "new column"),
            "source_headers": first_sheet.get("headers", []),
            "allowed_functions": ["IF", "SUM", "AVERAGE", "MIN", "MAX", "ROUND", "IFERROR"],
            "samples": [column.get("samples", []) for column in first_sheet.get("columns", [])],
            "expected_type": "text",
        }
    if tool == "tool2":
        quality_report = {}
        quality_key = item.get("artifacts", {}).get(_artifact_map_key("quality", slot), {}).get("key")
        if quality_key:
            quality_report = json.loads(s3.get_bytes(quality_key))
        type_issues = [issue for issue in quality_report.get("issues", []) if issue.get("kind") == "type_mismatch"]
        columns = {
            (sheet.get("name"), column.get("name")): column
            for sheet in manifest.get("sheets", [])
            for column in sheet.get("columns", [])
        }
        return {
            "mismatches": [
                {
                    "column_id": issue.get("column"),
                    "target_type": issue.get("proposed_target_type", "string"),
                    "type_distribution": issue.get("type_distribution", columns.get((issue.get("sheet"), issue.get("column")), {}).get("type_distribution", {})),
                    "samples": columns.get((issue.get("sheet"), issue.get("column")), {}).get("samples", []),
                    "constraints": {"sheet": issue.get("sheet"), "column": issue.get("column")},
                }
                for issue in type_issues
            ],
            "column_id": "",
            "target_type": "string",
            "samples": [],
            "type_distribution": {},
            "constraints": {"allowed_target_types": ["string", "integer", "number", "date", "datetime", "boolean"]},
        }
    if tool == "tool4":
        main_file = item.get("files", {}).get("main")
        main_rows = load_canonical_rows(s3.get_bytes(main_file["key"]), item.get("config", {}).get("main_sheet"), item.get("config", {}).get("main_header_row") or 1) if main_file else []
        current_rows = load_canonical_rows(
            source,
            item.get("config", {}).get("input_sheet"),
            item.get("config", {}).get("input_header_row") or 1,
        )
        main_fields = {
            str(field)
            for row in main_rows
            for field in row
            if field != "row_id"
        }
        shared_columns = [
            column
            for column in first_sheet.get("columns", [])
            if column.get("name") in main_fields
        ]
        source_values = sorted(
            {
                (str(field), str(row[field]))
                for row in current_rows
                for field in main_fields
                if field in row and row[field] is not None and str(row[field]).strip()
            }
        )
        candidates = sorted(
            {
                str(row[field])
                for row in main_rows
                for field in main_fields
                if row.get(field) is not None and str(row[field]).strip()
            }
        )
        return {
            "source_values": [
                {"field": field, "value": value} for field, value in source_values
            ],
            "canonical_candidates": candidates,
            "samples": shared_columns,
        }
    if tool == "tool5":
        main_file = item.get("files", {}).get("main")
        if not main_file:
            raise ValueError("main workbook is required for Tool #5")
        current_rows = load_canonical_rows(s3.get_bytes(item["files"][slot]["key"]), item.get("config", {}).get("input_sheet"), item.get("config", {}).get("input_header_row") or 1)
        main_rows = load_canonical_rows(s3.get_bytes(main_file["key"]), item.get("config", {}).get("main_sheet"), item.get("config", {}).get("main_header_row") or 1)
        key_column = item.get("config", {}).get("key_column")
        if not key_column:
            raise ValueError("key_column is required for Tool #5")
        main_key = item.get("config", {}).get("main_key_column") or key_column
        if main_key != key_column:
            main_rows = [{**row, key_column: row.get(main_key)} for row in main_rows]
        return build_tool5_inputs(current_rows, main_rows, key_column, settings.max_candidate_matches)
    raise ValueError(f"unsupported tool input: {tool}")


def _review_decision(decisions: dict[str, Any], decision_id: str) -> tuple[str | None, str | None]:
    value = decisions.get(decision_id, {})
    if not isinstance(value, dict):
        return getattr(value, "decision", None), None
    decision = value.get("decision")
    return getattr(decision, "value", decision), value.get("edited_value")


def _review_reason(decisions: dict[str, Any], decision_id: str) -> str | None:
    value = decisions.get(decision_id, {})
    if isinstance(value, dict):
        return value.get("reason")
    return getattr(value, "reason", None)


def apply_handler(event: dict[str, Any], context) -> dict[str, Any]:
    dynamo, s3 = _stores()
    item = dynamo.get_job(event["job_id"])
    if not item:
        raise ValueError("job not found")
    source = s3.get_bytes(item["files"]["input"]["key"])
    config = item.get("config", {})
    standardize = bool(config.get("standardize"))
    update = bool(config.get("update"))
    policy = "both" if standardize and update else "standardize_only" if standardize else "update_only" if update else "neither"
    main_file = item.get("files", {}).get("main")
    main_source = s3.get_bytes(main_file["key"]) if main_file else None
    decisions: dict[str, Any] = {}
    quality_report: dict[str, Any] = {}
    review_records = all_children(dynamo, event["job_id"], "REVIEW#")
    review_records.sort(key=lambda record: int(record.get("revision", 0)))
    for review_record in review_records:
        review_key = review_record.get("artifact_key")
        if review_key:
            decisions.update(json.loads(s3.get_bytes(review_key)).get("decisions", {}))
    for reference in sorted(item.get("review_artifacts", {}).values(), key=lambda entry: int(entry["revision"])):
        decisions.update(json.loads(s3.get_bytes(reference["key"])).get("decisions", {}))
    if not review_records and item.get("last_review_key"):
        decisions = json.loads(s3.get_bytes(item["last_review_key"])).get("decisions", {})
    quality_artifact = item.get("artifacts", {}).get("quality", {})
    if quality_artifact.get("key"):
        quality_report = json.loads(s3.get_bytes(quality_artifact["key"]))

    mappings: list[dict[str, Any]] = []
    type_rules: list[dict[str, Any]] = []
    update_matches: list[dict[str, Any]] = []
    formula = None
    decision_audit: list[dict[str, Any]] = []

    for proposal in all_children(dynamo, event["job_id"], "PROPOSAL#"):
        proposal_id = str(proposal.get("proposal_id"))
        decision_value, edited_value = _review_decision(decisions, proposal_id)
        decision_audit.append({
            "decision_id": proposal_id,
            "proposal_id": proposal.get("parent_proposal_id", proposal_id),
            "tool": proposal.get("tool"),
            "decision": decision_value or "not_submitted",
            "reason": _review_reason(decisions, proposal_id),
        })
        if not proposal.get("artifact_key"):
            continue
        proposal_body = json.loads(s3.get_bytes(proposal["artifact_key"]))
        payload = proposal_body.get("payload", {})
        tool = proposal.get("tool")

        if tool == "tool3" and decision_value in {"accept", "edit"}:
            workbook = load_workbook(BytesIO(source), data_only=False)
            try:
                worksheet = workbook[config.get("input_sheet")] if config.get("input_sheet") else workbook.worksheets[0]
                headers = [cell.value for cell in worksheet[config.get("input_header_row") or 1]]
                target_header = payload.get("target_header") or config.get("output_header") or config.get("comment_name")
                target_column = headers.index(target_header) + 1 if target_header in headers else (worksheet.max_column or 0) + 1
                formula = {
                    "formula_template": edited_value if decision_value == "edit" and edited_value else payload.get("formula_template", ""),
                    "target_header": target_header,
                    "target_column": target_column,
                    "start_row": (config.get("input_header_row") or 1) + 1,
                    "end_row": worksheet.max_row or 2,
                }
            finally:
                workbook.close()
        elif tool == "tool4":
            mappings_payload = payload.get("mappings", [])
            mapping_index = proposal.get("proposal_index")
            selected_mappings = [mappings_payload[int(mapping_index)]] if mapping_index is not None else mappings_payload
            for mapping in selected_mappings:
                mapping = dict(mapping)
                mapping["proposal_id"] = proposal_id
                if decision_value == "edit" and edited_value is not None:
                    mapping["canonical_value"] = edited_value
                mappings.append(mapping)
        elif tool == "tool2":
            rules = payload.get("rules", [])
            index = proposal.get("proposal_index")
            if index is not None and int(index) < len(rules):
                rule = dict(rules[int(index)])
                rule["proposal_id"] = proposal_id
                rule["column_id"] = payload.get("column_id")
                rule["target_type"] = payload.get("target_type")
                matching_issue = next(
                    (
                        issue
                        for issue in quality_report.get("issues", [])
                        if issue.get("kind") == "type_mismatch" and issue.get("column") == payload.get("column_id")
                    ),
                    None,
                )
                rule["constraints"] = {"sheet": matching_issue.get("sheet")} if matching_issue else {}
                type_rules.append(rule)
        elif tool == "tool5":
            matches = payload.get("matches", [])
            index = proposal.get("proposal_index")
            if index is not None and int(index) < len(matches):
                match = dict(matches[int(index)])
                match["decision_id"] = proposal_id
                if decision_value == "edit" and edited_value in match.get("candidate_main_row_ids", []):
                    match["selected_main_row_id"] = edited_value
                    match["match_type"] = "normalized"
                update_matches.append(match)

    quality_decision_audit = [
        {
            "decision_id": issue["issue_id"],
            "decision": _review_decision(decisions, issue["issue_id"])[0] or "not_submitted",
            "kind": issue["kind"],
            "reason": _review_reason(decisions, issue["issue_id"]),
        }
        for issue in quality_report.get("issues", [])
    ]

    audit: list[dict[str, Any]] = []
    if policy in {"standardize_only", "both", "neither"}:
        input_stage, stage_audit = apply_accepted_changes(
            source,
            quality_report=quality_report,
            decisions=decisions,
            type_rules=type_rules,
            standardization_mappings=mappings if standardize else [],
            formula=formula if not update else None,
            sheet_name=config.get("input_sheet"),
            header_row=config.get("input_header_row") or 1,
            include_quality_deletions=policy != "both",
        )
        audit.extend(stage_audit)
    else:
        input_stage = source

    if policy in {"update_only", "both"}:
        if not main_source:
            raise ValueError("main workbook is required by the selected output policy")
        if not config.get("key_column"):
            raise ValueError("key_column is required by the selected output policy")
        output, update_audit = apply_accepted_updates(
            main_source,
            input_stage if policy == "both" else source,
            update_matches,
            decisions,
            key_column=config["key_column"],
            main_key_column=config.get("main_key_column"),
            current_header_row=config.get("input_header_row") or 1,
            main_header_row=config.get("main_header_row") or 1,
            main_sheet=config.get("main_sheet"),
            current_sheet=config.get("input_sheet"),
            conflict_policy=config.get("conflict_policy", "reject_all"),
        )
        audit.extend(update_audit)
        if formula:
            # Generated formulas belong to the final main-derived output, including Update-only.
            output_book = load_workbook(BytesIO(output), read_only=True, data_only=False)
            try:
                sheet = output_book[config["main_sheet"]] if config.get("main_sheet") else output_book.worksheets[0]
                header_row = config.get("main_header_row") or 1
                headers = [cell.value for cell in sheet[header_row]]
                target = formula["target_header"]
                output_formula = {**formula, "target_column": headers.index(target) + 1 if target in headers else sheet.max_column + 1, "start_row": header_row + 1, "end_row": sheet.max_row}
            finally:
                output_book.close()
            output, formula_audit = apply_workbook_changes(output, sheet_name=config.get("main_sheet"), formula=output_formula, header_row=header_row)
            audit.extend(formula_audit)
    else:
        output = input_stage

    audit = decision_audit + quality_decision_audit + audit
    for decision_record in decision_audit + quality_decision_audit:
        decision_id = str(decision_record["decision_id"])
        record_kind = "issue" if decision_record.get("kind") else "proposal"
        dynamo.put_child(
            event["job_id"],
            f"EVENT#decision#{record_kind}#{decision_id}",
            {
                "entity_type": "event",
                "event_type": "review_decision",
                "decision_id": decision_id,
                "record_kind": record_kind,
                "decision": decision_record.get("decision", "not_submitted"),
                "tool": decision_record.get("tool"),
                "kind": decision_record.get("kind"),
                "reason": decision_record.get("reason"),
            },
        )
    output_key = s3.artifact_key(event["job_id"], "output", "final.xlsx")
    if not s3.object_exists(output_key):
        s3.put_bytes(output_key, output, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    audit_key = s3.artifact_key(event["job_id"], "output", "change-report.json")
    summary_key = s3.artifact_key(event["job_id"], "output", "review-summary.md")
    audit_body = {"audit_version": "2", "output_policy": policy, "changes": audit}
    summary_body = "\n".join([
        "# Review summary",
        "",
        f"- Output policy: `{policy}`",
        f"- Decision records: {len(decision_audit) + len(quality_decision_audit)}",
        f"- Mutation records: {len(audit)}",
        f"- Output SHA-256: `{sha256(output).hexdigest()}`",
        "",
        "The source workbook objects were not modified. Unmatched update rows are skipped by the demo policy.",
    ])
    if not s3.object_exists(audit_key):
        s3.put_bytes(audit_key, json.dumps(audit_body, indent=2).encode("utf-8"), "application/json")
    if not s3.object_exists(summary_key):
        s3.put_bytes(summary_key, summary_body.encode("utf-8"), "text/markdown")
    artifacts = dict(item.get("artifacts", {}))
    artifacts["output"] = {
        "key": output_key,
        "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "size_bytes": len(output),
        "sha256": sha256(output).hexdigest(),
    }
    artifacts["audit"] = {"key": audit_key, "content_type": "application/json"}
    artifacts["review_summary"] = {"key": summary_key, "content_type": "text/markdown"}
    updated = dynamo.update_job(
        event["job_id"],
        int(item["revision"]),
        {"status": "VALIDATING_OUTPUT", "artifacts": artifacts, "error_code": None, "error_detail": None, "result_summary": {
            "updated_rows": sum(record.get("action") == "updated" for record in audit),
            "skipped_rows": sum(record.get("action") == "skipped" for record in audit),
            "rejected_decisions": sum(record.get("decision") == "reject" for record in decision_audit + quality_decision_audit),
            "formula_cells_verified": sum(record.get("syntax_verified") is True for record in audit),
            "execution_mode": "reviewed-workflow",
        }},
    )
    return {"job_id": event["job_id"], "revision": updated["revision"], "output_key": output_key}


def validate_handler(event: dict[str, Any], context) -> dict[str, Any]:
    dynamo, s3 = _stores()
    item = dynamo.get_job(event["job_id"])
    if not item:
        raise ValueError("job not found")
    output_key = item.get("artifacts", {}).get("output", {}).get("key")
    if not output_key:
        raise ValueError("output artifact is missing")
    source = s3.get_bytes(item["files"]["input"]["key"])
    output = s3.get_bytes(output_key)
    config = item.get("config", {})
    expected_sheet = config.get("main_sheet") if config.get("update") else config.get("input_sheet")
    validation = validate_output(source, output, expected_sheet=expected_sheet)
    validation_key = s3.artifact_key(event["job_id"], "output", "validation.json")
    if not s3.object_exists(validation_key):
        s3.put_bytes(validation_key, json.dumps(validation, indent=2).encode("utf-8"), "application/json")
    artifacts = dict(item.get("artifacts", {}))
    artifacts["validation"] = {"key": validation_key, "content_type": "application/json"}
    updated = dynamo.update_job(
        event["job_id"],
        int(item["revision"]),
        {"status": "COMPLETED", "output_hash": validation["output_sha256"], "artifacts": artifacts},
    )
    return {"job_id": event["job_id"], "revision": updated["revision"], "status": updated["status"]}


def failure_handler(event: dict[str, Any], context) -> dict[str, Any]:
    dynamo, _ = _stores()
    item = dynamo.get_job(event["job_id"])
    if not item or item.get("status") in {"COMPLETED", "CANCELLED"}:
        return {"job_id": event["job_id"], "status": item.get("status") if item else "NOT_FOUND"}
    updated = dynamo.update_job(
        event["job_id"],
        int(item["revision"]),
        {"status": "FAILED", "error_code": "WORKFLOW_FAILED", "error_detail": "workflow segment failed; retry is available"},
    )
    return {"job_id": event["job_id"], "status": updated["status"]}
