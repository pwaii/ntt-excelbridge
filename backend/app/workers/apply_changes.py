"""Apply only explicitly accepted changes to a new workbook copy."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import Any

from openpyxl import load_workbook

from app.workers.formulas import verify_formula
from app.workers.inspect_workbook import normalize_text


def escape_data_value(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def normalize_value(value: Any, pattern: str, target_type: str) -> Any:
    if value is None:
        return value
    text = str(value).strip()
    upper = text.upper()
    if "DD/MM/YYYY" in pattern.upper():
        return datetime.strptime(text, "%d/%m/%Y").strftime("%Y-%m-%d")
    if target_type.lower() in {"bool", "boolean"} or "BOOLEAN" in pattern.upper():
        if upper in {"Y", "YES", "TRUE", "1"}:
            return True
        if upper in {"N", "NO", "FALSE", "0"}:
            return False
    if target_type.lower() in {"int", "integer"}:
        return int(text)
    if target_type.lower() in {"decimal", "number", "float"}:
        return float(text)
    return value


def materialize_formula(template: str, row_number: int) -> str:
    return template.replace("{row}", str(row_number)).replace("{ROW}", str(row_number))


def apply_workbook_changes(source: bytes, *, sheet_name: str | None = None, data_updates: dict[str, Any] | None = None, formula: dict[str, Any] | None = None, row_deletions: set[int] | None = None, header_row: int = 1) -> tuple[bytes, list[dict[str, Any]]]:
    workbook = load_workbook(BytesIO(source), data_only=False)
    audit: list[dict[str, Any]] = []
    try:
        worksheet = workbook[sheet_name] if sheet_name else workbook.worksheets[0]
        for address, value in (data_updates or {}).items():
            target_worksheet = worksheet
            cell_address = address
            if "!" in address:
                sheet_title, cell_address = address.rsplit("!", 1)
                target_worksheet = workbook[sheet_title]
            cell = target_worksheet[cell_address]
            cell.value = escape_data_value(value)
            audit.append({"cell": f"{target_worksheet.title}!{cell_address}", "origin": "data", "old": None, "new": cell.value})
        for row_number in sorted(row_deletions or set(), reverse=True):
            worksheet.delete_rows(row_number, 1)
            audit.append({"row": f"{worksheet.title}!{row_number}", "origin": "data", "action": "delete"})
        if formula:
            target_column = int(formula["target_column"])
            target_header = formula.get("target_header")
            if target_header:
                header_cell = worksheet.cell(row=header_row, column=target_column)
                if header_cell.value in (None, ""):
                    header_cell.value = target_header
                    audit.append({"cell": f"{worksheet.title}!{header_cell.coordinate}", "origin": "data", "new": target_header})
            start_row = int(formula.get("start_row", 2))
            end_row = min(int(formula.get("end_row", worksheet.max_row or start_row)), worksheet.max_row or start_row)
            template = str(formula["formula_template"])
            verify_formula(template.replace("{row}", str(start_row)), min_row=start_row, max_row=end_row, target_column=target_column)
            for row_number in range(start_row, end_row + 1):
                formula_text = materialize_formula(template, row_number)
                verify_formula(formula_text, min_row=start_row, max_row=end_row, target_column=target_column)
                cell = worksheet.cell(row=row_number, column=target_column)
                cell.value = formula_text
                audit.append({"cell": f"{worksheet.title}!{cell.coordinate}", "origin": "approved-formula", "new": formula_text, "syntax_verified": True})
        stream = BytesIO()
        workbook.save(stream)
        return stream.getvalue(), audit
    finally:
        workbook.close()


def apply_accepted_changes(source: bytes, *, quality_report: dict[str, Any] | None = None, decisions: dict[str, Any] | None = None, type_rules: list[dict[str, Any]] | None = None, standardization_mappings: list[dict[str, Any]] | None = None, formula: dict[str, Any] | None = None, sheet_name: str | None = None, include_quality_deletions: bool = True, header_row: int = 1) -> tuple[bytes, list[dict[str, Any]]]:
    """Translate reviewed issue/proposal decisions into deterministic cell edits."""

    decisions = decisions or {}
    probe = load_workbook(BytesIO(source), read_only=True, data_only=False)
    try:
        selected_sheet_name = sheet_name or probe.worksheets[0].title
    finally:
        probe.close()
    row_deletions: set[int] = set()
    for issue in (quality_report or {}).get("issues", []):
        if not include_quality_deletions:
            continue
        if issue.get("sheet") != selected_sheet_name:
            continue
        decision = decisions.get(issue["issue_id"], {})
        decision_value = decision.get("decision") if isinstance(decision, dict) else getattr(decision, "decision", None)
        decision_value = getattr(decision_value, "value", decision_value)
        if decision_value != "accept":
            continue
        if issue["kind"] == "blank_row":
            row_deletions.update(issue.get("row_numbers", []))
        elif issue["kind"] == "duplicate_rows":
            row_deletions.update(issue.get("row_numbers", [])[1:])

    data_updates: dict[str, Any] = {}
    workbook = load_workbook(BytesIO(source), data_only=False)
    try:
        worksheet = workbook[sheet_name] if sheet_name else workbook.worksheets[0]
        headers = {normalize_text(cell.value): cell.column for cell in worksheet[header_row] if cell.value is not None}
        for rule in type_rules or []:
            rule_id = rule.get("proposal_id") or f"rule:{rule.get('column_id')}:{rule.get('pattern')}"
            decision = decisions.get(rule_id, {})
            decision_value = decision.get("decision") if isinstance(decision, dict) else getattr(decision, "decision", None)
            decision_value = getattr(decision_value, "value", decision_value)
            if decision_value != "accept":
                continue
            column_name = rule.get("column_id") or rule.get("column")
            rule_sheet = (rule.get("constraints") or {}).get("sheet")
            rule_worksheet = workbook[rule_sheet] if rule_sheet and rule_sheet in workbook.sheetnames else worksheet
            rule_headers = {normalize_text(cell.value): cell.column for cell in rule_worksheet[header_row] if cell.value is not None}
            if column_name not in rule_headers:
                continue
            column = rule_headers[column_name]
            for row in range(header_row + 1, (rule_worksheet.max_row or header_row) + 1):
                cell = rule_worksheet.cell(row=row, column=column)
                if str(cell.value).strip() == "":
                    continue
                try:
                    normalized = normalize_value(cell.value, str(rule.get("pattern", "")), str(rule.get("target_type", "")))
                except (TypeError, ValueError):
                    continue
                if normalized != cell.value:
                    data_updates[f"{rule_worksheet.title}!{cell.coordinate}"] = normalized
        for mapping in standardization_mappings or []:
            source_field = normalize_text(mapping.get("source_field"))
            source_value = mapping.get("source_value")
            canonical_value = mapping.get("canonical_value")
            proposal_id = mapping.get("proposal_id") or f"mapping:{source_field}:{source_value}"
            decision = decisions.get(proposal_id, {})
            decision_value = decision.get("decision") if isinstance(decision, dict) else getattr(decision, "decision", None)
            decision_value = getattr(decision_value, "value", decision_value)
            if decision_value not in {"accept", "edit"} or source_field not in headers:
                continue
            column = headers[source_field]
            for row in range(header_row + 1, (worksheet.max_row or header_row) + 1):
                cell = worksheet.cell(row=row, column=column)
                if str(cell.value).strip() == str(source_value).strip():
                    data_updates[cell.coordinate] = canonical_value
        # Close the read-only planning workbook before the writer reopens it.
    finally:
        workbook.close()
    return apply_workbook_changes(source, sheet_name=sheet_name, data_updates=data_updates, formula=formula, row_deletions=row_deletions, header_row=header_row)


def _decision_value(decisions: dict[str, Any], decision_id: str) -> str | None:
    decision = decisions.get(decision_id, {})
    value = decision.get("decision") if isinstance(decision, dict) else getattr(decision, "decision", None)
    return getattr(value, "value", value)


def _split_row_id(row_id: str) -> tuple[str, int]:
    try:
        sheet, row = row_id.rsplit("!", 1)
        return sheet, int(row)
    except (AttributeError, ValueError) as error:
        raise ValueError(f"invalid workbook row id: {row_id}") from error


def apply_accepted_updates(
    main_source: bytes,
    current_source: bytes,
    matches: list[dict[str, Any]],
    decisions: dict[str, Any],
    *,
    key_column: str,
    main_key_column: str | None = None,
    current_header_row: int = 1,
    main_header_row: int = 1,
    main_sheet: str | None = None,
    current_sheet: str | None = None,
    conflict_policy: str = "reject_all",
    prior_destinations: set[tuple[str, int]] | None = None,
) -> tuple[bytes, list[dict[str, Any]]]:
    """Merge accepted current-row values into a new main-workbook copy.

    The function validates row IDs against the workbooks, protects duplicate
    destination rows, skips unmatched rows, and records every decision. Formula
    cells remain formulas; ordinary values pass through the data escaper.
    """

    if not normalize_text(key_column):
        raise ValueError("key_column is required for update merging")
    if conflict_policy not in {"reject_all", "latest_wins", "merge"}:
        raise ValueError(f"unsupported update conflict policy: {conflict_policy}")
    main_book = load_workbook(BytesIO(main_source), data_only=False)
    current_book = load_workbook(BytesIO(current_source), data_only=False)
    audit: list[dict[str, Any]] = []
    # Seeded by the caller when merging several current workbooks into one main in
    # sequence: a destination an earlier file already wrote becomes a cross-file
    # collision the existing conflict skip (below) catches instead of overwriting.
    used_destinations: set[tuple[str, int]] = prior_destinations if prior_destinations is not None else set()
    try:
        main_ws = main_book[main_sheet] if main_sheet else main_book.worksheets[0]
        current_ws = current_book[current_sheet] if current_sheet else current_book.worksheets[0]
        main_headers = {normalize_text(cell.value): cell.column for cell in main_ws[main_header_row] if cell.value is not None}
        current_headers = {normalize_text(cell.value): cell.column for cell in current_ws[current_header_row] if cell.value is not None}
        normalized_key = normalize_text(key_column)
        shared_headers = [header for header in current_headers if header in main_headers and header != normalized_key]
        main_key_column = main_headers.get(normalize_text(main_key_column or key_column))
        duplicate_keys: set[str] = set()
        if main_key_column:
            seen_keys: dict[str, int] = {}
            for row in range(main_header_row + 1, main_ws.max_row + 1):
                key = str(main_ws.cell(row=row, column=main_key_column).value or "").strip().casefold()
                if not key:
                    continue
                seen_keys[key] = seen_keys.get(key, 0) + 1
            duplicate_keys = {key for key, count in seen_keys.items() if count > 1}

        destination_groups: dict[tuple[str, int], list[dict[str, Any]]] = {}
        for match in matches:
            decision_id = str(match.get("decision_id") or match.get("proposal_id") or match.get("current_row_id"))
            if _decision_value(decisions, decision_id) not in {"accept", "edit"} or not match.get("selected_main_row_id"):
                continue
            try:
                destination = _split_row_id(str(match["selected_main_row_id"]))
            except ValueError:
                continue
            destination_groups.setdefault(destination, []).append(match)
        conflict_destinations = {
            destination for destination, group in destination_groups.items() if len(group) > 1
        }
        conflict_winners: set[int] = set()
        if conflict_policy == "latest_wins":
            for destination in conflict_destinations:
                winner = max(
                    destination_groups[destination],
                    key=lambda match: _split_row_id(str(match["current_row_id"]))[1],
                )
                conflict_winners.add(id(winner))

        for match in matches:
            decision_id = str(match.get("decision_id") or match.get("proposal_id") or match.get("current_row_id"))
            decision = _decision_value(decisions, decision_id)
            current_row_id = str(match.get("current_row_id"))
            destination_id = match.get("selected_main_row_id")
            base_audit = {
                "decision_id": decision_id,
                "current_row_id": current_row_id,
                "selected_main_row_id": destination_id,
                "decision": decision or "not_submitted",
                "match_type": match.get("match_type"),
            }
            if decision not in {"accept", "edit"}:
                audit.append({**base_audit, "action": "skipped", "reason": "review decision was not accept"})
                continue
            if not destination_id:
                audit.append({**base_audit, "action": "skipped", "reason": "unmatched or no selected destination"})
                continue
            current_sheet_name, current_row = _split_row_id(current_row_id)
            main_sheet_name, main_row = _split_row_id(str(destination_id))
            if current_sheet_name != current_ws.title or main_sheet_name != main_ws.title:
                audit.append({**base_audit, "action": "skipped", "reason": "row belongs to a different selected sheet"})
                continue
            destination_key = ""
            if main_key_column:
                destination_key = str(main_ws.cell(row=main_row, column=main_key_column).value or "").strip().casefold()
            if destination_key in duplicate_keys:
                audit.append({**base_audit, "action": "skipped", "reason": "destination business key is duplicated"})
                continue
            destination = (main_sheet_name, main_row)
            if destination in conflict_destinations and conflict_policy == "reject_all":
                audit.append({**base_audit, "action": "skipped", "reason": "conflict policy reject_all"})
                continue
            if destination in conflict_destinations and conflict_policy == "latest_wins" and id(match) not in conflict_winners:
                audit.append({**base_audit, "action": "skipped", "reason": "conflict policy latest_wins"})
                continue
            if destination in used_destinations and conflict_policy != "merge":
                audit.append({**base_audit, "action": "skipped", "reason": "destination row already matched by another current row"})
                continue
            if current_row <= current_header_row or current_row > current_ws.max_row or main_row <= main_header_row or main_row > main_ws.max_row:
                audit.append({**base_audit, "action": "skipped", "reason": "row is outside workbook bounds"})
                continue
            changed_cells = []
            for header in shared_headers:
                source_cell = current_ws.cell(row=current_row, column=current_headers[header])
                destination_cell = main_ws.cell(row=main_row, column=main_headers[header])
                if source_cell.value in (None, ""):
                    continue
                old_value = destination_cell.value
                if isinstance(source_cell.value, str) and source_cell.value.startswith("="):
                    destination_cell.value = source_cell.value
                    origin = "approved-formula"
                else:
                    destination_cell.value = escape_data_value(source_cell.value)
                    origin = "data"
                if old_value != destination_cell.value:
                    changed_cells.append({
                        "cell": f"{main_ws.title}!{destination_cell.coordinate}",
                        "origin": origin,
                        "old": old_value,
                        "new": destination_cell.value,
                    })
            used_destinations.add(destination)
            audit.append({**base_audit, "action": "updated", "changed_cells": changed_cells})
        stream = BytesIO()
        main_book.save(stream)
        return stream.getvalue(), audit
    finally:
        main_book.close()
        current_book.close()
