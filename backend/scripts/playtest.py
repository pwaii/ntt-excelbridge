r"""Local playtest driver: one XLSX in, one transformed XLSX out, using the REAL
workers + real Bedrock, with the two human review gates auto-accepted.

This is a demo harness only. It deliberately bypasses invariant #2 (the two human
gates) by accepting every proposal, and it touches NO AWS except the Bedrock call
itself -- no S3, DynamoDB, Step Functions, or Cognito. The transform logic
(inspect -> quality rules -> Tool #1 semantics -> Tool #3 formula -> apply ->
validate) is the same code the deployed Lambda pipeline runs.

shortcut: accept-all gates + single-formula "neither" policy only (no standardize/
update/match). Upgrade to the real review API when demoing the full product.

Run from the backend/ directory with Bedrock creds in the environment:
    $env:AWS_PROFILE="ChallengerAccess-453995432289"; $env:AWS_REGION="us-east-1"
    ..\.venv\Scripts\python.exe -m scripts.playtest --prompt "..." --header "..."
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # make `app` importable

from app.ai.tool1_semantics import run_tool1
from app.ai.tool2_types import run_tool2
from app.ai.tool3_formulas import run_tool3
from app.ai.tool4_standardize import run_tool4
from app.ai.tool5_update import run_tool5
from app.workers.apply_changes import apply_accepted_changes, apply_accepted_updates
from app.workers.inspect_workbook import inspect_bytes
from app.workers.matching import build_tool5_inputs, load_canonical_rows
from app.workers.quality_rules import run_quality_rules
from app.workers.validate_output import validate_output

ALLOWED_FUNCTIONS = ["IF", "SUM", "AVERAGE", "MIN", "MAX", "ROUND", "IFERROR", "CONCAT", "LEN", "LEFT", "UPPER", "LOWER", "TRIM"]


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent.parent
    ap = argparse.ArgumentParser(description="Local XLSX -> transformed XLSX playtest")
    ap.add_argument("--input", default=str(repo_root / "sample-data" / "current.xlsx"))
    ap.add_argument("--prompt", default="A column that combines or summarizes the existing data", help="natural-language description of the column to add")
    ap.add_argument("--header", default="AI Column", help="header for the new output column")
    ap.add_argument("--out", default=str(repo_root / "playtest-output.xlsx"))
    ap.add_argument("--main", default=str(repo_root / "sample-data" / "main.xlsx"), help="main workbook for Tool #4/#5")
    ap.add_argument("--key", default="CustomerID", help="business key column for Tool #5 matching")
    ap.add_argument("--main-out", default=str(repo_root / "playtest-output-main.xlsx"))
    args = ap.parse_args()

    source = Path(args.input).read_bytes()
    manifest = inspect_bytes(source)
    sheet = manifest["sheets"][0] if manifest.get("sheets") else {"headers": [], "columns": []}
    headers = sheet.get("headers", [])
    columns = sheet.get("columns", [])
    header_row = sheet.get("header_row", 1)  # honor detected header row for Tool #4/#5 (AI-009)
    main_path = Path(args.main)
    main_bytes = main_path.read_bytes() if main_path.exists() else None
    main_header_row = inspect_bytes(main_bytes)["sheets"][0].get("header_row", 1) if main_bytes else 1
    print(f"\n== input ==\n{args.input}")
    print(f"sheet: {sheet.get('name')}  headers: {headers}")

    report = run_quality_rules(source, manifest)
    print(f"\n== quality rules ==\n{report['issue_count']} issue(s): " +
          ", ".join(f"{i['kind']}" for i in report["issues"]) or "none")

    # --- Tool #2: normalize each column the rules flagged as a type mismatch ---
    col_by_name = {c.get("name"): c for c in columns}
    type_rules: list[dict] = []
    type_decisions: dict[str, dict] = {}
    for issue in [i for i in report["issues"] if i["kind"] == "type_mismatch"]:
        col = col_by_name.get(issue.get("column"), {})
        try:
            t2 = run_tool2({
                "column_id": issue["column"],
                "target_type": issue.get("proposed_target_type", "string"),
                "samples": col.get("samples", []),
                "type_distribution": issue.get("type_distribution", {}),
                "constraints": {"allowed_target_types": ["string", "integer", "number", "date", "datetime", "boolean"]},
            })
        except Exception as exc:  # reject-whole / parse fail is a valid guardrail outcome
            print(f"\n== Tool #2 REJECTED for '{issue['column']}' ==\n{type(exc).__name__}: {exc}")
            continue
        print(f"\n== Tool #2 (normalize '{issue['column']}' -> {t2.payload.target_type}) ==")
        for idx, rule in enumerate(t2.payload.rules):
            rd = rule.model_dump(mode="json")
            print(f"  rule {idx}: {rd}")
            pid = f"tool2-{issue['column']}-{idx}"
            type_rules.append({
                "proposal_id": pid,
                "column_id": t2.payload.column_id,
                "target_type": t2.payload.target_type,
                "pattern": rd.get("pattern", ""),
                "constraints": {"sheet": issue.get("sheet")},
            })
            type_decisions[pid] = {"decision": "accept"}

    # --- Tool #1: semantic understanding of the requested column ---
    t1 = run_tool1({
        "comment_name": args.prompt,
        "output_header": args.header,
        "current_headers": headers,
        "normalized_headers": [c.get("normalized_name") for c in columns],
        "main_headers": [],
        "type_summaries": [c.get("type_distribution", {}) for c in columns],
        "samples": [c.get("samples", []) for c in columns],
    })
    print(f"\n== Tool #1 (semantics) ==\n{t1.payload.model_dump(mode='json')}")

    # --- Tool #3: propose a formula for the new column ---
    # Only for the formula ("neither") policy. With a main workbook the intent is
    # standardize/update, where the new column comes from Tool #4 mappings, not a formula
    # (a generic formula produces semantically wrong cells — AI-006).
    formula = None
    if main_bytes:
        print("\n== Tool #3 skipped: main workbook present (standardize/update policy) ==")
    else:
        try:
            t3 = run_tool3({
                "meaning": args.prompt,
                "source_headers": headers,
                "allowed_functions": ALLOWED_FUNCTIONS,
                "samples": [c.get("samples", []) for c in columns],
                "expected_type": "text",
            })
            print(f"\n== Tool #3 (formula) ==\n{t3.payload.model_dump(mode='json')}")
            formula = {
                "formula_template": t3.payload.formula_template,
                "target_header": args.header,
                "target_column": len(headers) + 1,  # new column after the last header
                "start_row": 2,
                # end_row omitted: apply_workbook_changes defaults it to the sheet's max_row
            }
        except Exception as exc:  # reject-whole guardrail or a bad formula is a valid demo outcome
            print(f"\n== Tool #3 REJECTED by guardrail (expected sometimes) ==\n{type(exc).__name__}: {exc}")
            print("Proceeding with quality fixes only; no formula column added.")

    # --- Tool #4: standardize current values against main's canonical values ---
    std_mappings: list[dict] = []
    std_decisions: dict[str, dict] = {}
    if main_bytes:
        main_rows = load_canonical_rows(main_bytes, header_row=main_header_row)
        main_fields = {str(f) for r in main_rows for f in r if f != "row_id"}
        canonical = sorted({str(v) for r in main_rows for k, v in r.items() if k != "row_id" and v is not None})
        # Only values from columns shared with main — mirrors _tool_inputs so numeric quantity
        # columns don't pollute the candidate match and provoke invented abbreviations (AI-008).
        source_values = sorted({str(v) for c in columns if c.get("name") in main_fields for v in c.get("samples", []) if v is not None})
        try:
            t4 = run_tool4({"source_values": source_values, "canonical_candidates": canonical, "samples": columns})
            print(f"\n== Tool #4 (standardize {len(source_values)} values vs {len(canonical)} canonical) ==")
            for i, m in enumerate(t4.payload.mappings):
                md = m.model_dump(mode="json")
                print(f"  map {i}: {md['source_field']}={md['source_value']!r} -> {md['canonical_value']!r} ({md['action']}/{md['cardinality']})")
                if md["action"] == "safe" and md["cardinality"] != "unmapped":
                    pid = f"tool4-{i}"
                    md["proposal_id"] = pid
                    std_mappings.append(md)
                    std_decisions[pid] = {"decision": "accept"}
        except Exception as exc:  # reject-whole (e.g. invented canonical) is a valid outcome
            print(f"\n== Tool #4 REJECTED ==\n{type(exc).__name__}: {exc}")

    # --- accept every quality issue + type rule + mapping, then apply (gates auto-accepted) ---
    decisions = {issue["issue_id"]: {"decision": "accept"} for issue in report["issues"]}
    decisions.update(type_decisions)
    decisions.update(std_decisions)
    try:
        output, audit = apply_accepted_changes(
            source, quality_report=report, decisions=decisions,
            type_rules=type_rules, standardization_mappings=std_mappings, formula=formula,
        )
    except Exception as exc:
        print(f"\n== apply FAILED (formula verifier rejected it) ==\n{type(exc).__name__}: {exc}")
        print("Retrying without the formula so you still get an output workbook...")
        output, audit = apply_accepted_changes(source, quality_report=report, decisions=decisions)

    validation = validate_output(source, output, expected_sheet=sheet.get("name"))
    Path(args.out).write_bytes(output)
    print(f"\n== output ==\nwrote {args.out}  ({len(output)} bytes)")
    print(f"mutations applied: {len(audit)}")
    print(f"validation: status={validation['status']}  rows={validation['row_count']}  cols={validation['column_count']}  formulas={validation['formula_count']}")

    # --- Tool #5: BE candidate-gen first, then model matches, then update main ---
    if main_bytes:
        current_rows = load_canonical_rows(source, header_row=header_row)
        main_rows_full = load_canonical_rows(main_bytes, header_row=main_header_row)
        if not current_rows or args.key not in current_rows[0]:
            print(f"\n== Tool #5 skipped: key '{args.key}' not found in current headers ==")
        else:
            t5_inputs = build_tool5_inputs(current_rows, main_rows_full, args.key, 5)
            print(f"\n== Tool #5 ({len(t5_inputs['current_rows'])} unresolved, "
                  f"{len(t5_inputs['candidate_rows'])} candidates, "
                  f"{len(t5_inputs['deterministic_matches'])} exact pre-matched) ==")
            try:
                t5 = run_tool5(t5_inputs)
                matches = [m.model_dump(mode="json") for m in t5.payload.matches]
                for m in matches:
                    print(f"  {m['current_row_id']} -> {m['selected_main_row_id']} ({m['match_type']}/{m['recommended_action']})")
                m_decisions = {m["current_row_id"]: {"decision": "accept"} for m in matches}
                main_out, main_audit = apply_accepted_updates(
                    main_bytes, source, matches, m_decisions,
                    key_column=args.key, conflict_policy="reject_all",
                )
                Path(args.main_out).write_bytes(main_out)
                applied = sum(1 for a in main_audit if a.get("action") == "updated")
                print(f"  wrote {args.main_out}  (main rows updated: {applied} of {len(main_audit)} records)")
            except Exception as exc:  # off-candidate / unmatched-with-selection reject is valid
                print(f"  Tool #5 REJECTED/failed: {type(exc).__name__}: {exc}")

    print("\nOpen the output file(s) in Excel to see the result. Formula cells show '=...' (syntax-verified, not calculated).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
