"""Day-6 eval harness (§Day-6): run Tools #1-#5 against real Bedrock with small capped
fixtures, record tokens+latency, run LIGHT invariant checks on the real output (schema
parsed, enums valid, demote applied, no off-candidate id), compute per-tool cost, and
print a measurement report. Caches by input hash so reruns are free. Runs preflight first.

Run:
    AWS_PROFILE=ChallengerAccess-453995432289 AWS_REGION=us-east-1 python -m scripts.eval_tools

Scope (brainstorming): run + measure + light checks. Adversarial reject-whole paths stay in
the pytest unit tests; accuracy scoring + threshold tuning are Day 7.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # make `app` importable

# Generated run artifacts (regenerable at ~$0.002); kept out of docs/ and under the already
# gitignored backend/.cache/. The curated summary lives in docs/ai-model-quality.md.
EVAL_OUT_DIR = Path(__file__).resolve().parent.parent / ".cache" / "eval"

from botocore.exceptions import BotoCoreError, ClientError
from pydantic import ValidationError

from app.ai.cache import CachingBedrockClient
from app.ai.policy import CONFIDENCE_FLOOR
from app.ai.tool1_semantics import run_tool1
from app.ai.tool2_types import run_tool2
from app.ai.tool3_formulas import run_tool3
from app.ai.tool4_standardize import run_tool4
from app.ai.tool5_update import run_tool5
from app.domain.schemas import (
    Tool1Output,
    Tool2Output,
    Tool3Output,
    Tool4Output,
    Tool5Output,
)
from app.settings import settings
from scripts.preflight import main as preflight_main

# AWS Nova on-demand, USD per 1k tokens (input, output). Verify against current pricing.
NOVA_PRICING = {
    "amazon.nova-lite-v1:0": (0.00006, 0.00024),
    "amazon.nova-pro-v1:0": (0.0008, 0.0032),
}

# --- Fixtures (shapes reused from the test_ai_dayN.py files + smoke_tool1) ---
T1 = {
    "comment_name": "customer loyalty tier", "output_header": "Tier",
    "current_headers": ["CustomerID", "LoyaltyLevel", "SpendYTD"],
    "normalized_headers": ["customer_id", "loyalty_level", "spend_ytd"],
    "main_headers": [], "type_summaries": {"loyalty_level": "string (Gold/Silver/Bronze)"},
    "samples": [{"cell": "B2", "value": "Gold"}, {"cell": "B3", "value": "Silver"}],
}
T2 = {
    "column_id": "OrderDate", "target_type": "date",
    "samples": [{"row_id": "r2", "value": "01/02/2024"}, {"row_id": "r3", "value": "bogus"}],
    "type_distribution": {"date": 1, "string": 1},
    "constraints": "preserve source day/month order",
}
T3 = {
    "meaning": "total price = qty * unit price", "source_headers": ["Qty", "UnitPrice"],
    "allowed_functions": ["SUM", "PRODUCT"], "samples": [{"Qty": "2", "UnitPrice": "10"}],
    "expected_type": "number",
}
T4 = {
    "source_values": [{"field": "Country", "value": "USA"},
                      {"field": "Country", "value": "U.S."}],
    "canonical_candidates": ["United States", "Canada"], "samples": [],
}
# Tool5 covers the plan's case types in one call: clear exact, ambiguous, no-match.
T5 = {
    "current_rows": [
        {"current_row_id": "c1", "fields": {"Email": "a@x.com"}},
        {"current_row_id": "c2", "fields": {"Name": "John Smith"}},
        {"current_row_id": "c3", "fields": {"Email": "nobody@x.com"}},
    ],
    "candidate_rows": [
        {"main_row_id": "m1", "fields": {"Email": "a@x.com"}},
        {"main_row_id": "m2", "fields": {"Name": "John Smith", "Email": "js1@x.com"}},
        {"main_row_id": "m3", "fields": {"Name": "John Smith", "Email": "js2@x.com"}},
    ],
    "match_key": "Email",
}


# --- Light checks (run on the REAL ToolResult; raise AssertionError on violation) ---
def hashes_64(r):
    assert len(r.meta.input_hash) == 64 and len(r.meta.output_hash) == 64, "bad hash len"


def payload_is(t):
    def chk(r):
        assert isinstance(r.payload, t), f"payload not {t.__name__}"
    return chk


def t1_status_enum(r):
    assert r.payload.status in {"confirmed", "ambiguous", "not_found"}, r.payload.status


def t2_target_type_set(r):
    assert r.payload.target_type == "date"  # must not drift from the requested target


def t3_formula_shape(r):
    assert r.payload.formula_template.startswith("="), "formula must start with ="
    assert set(r.payload.referenced_headers) <= set(T3["source_headers"]), "header off-list"


def t4_invariants(r):
    for m in r.payload.mappings:
        assert m.action in {"safe", "ambiguous", "rejected"}, m.action
        if m.cardinality == "unmapped":
            assert m.canonical_value == "", "unmapped must be blank"
        else:
            assert m.canonical_value in T4["canonical_candidates"], "off-candidate canonical"


def t5_invariants(r):
    for m in r.payload.matches:
        if m.selected_main_row_id is not None:
            assert m.selected_main_row_id in m.candidate_main_row_ids, "off-candidate id"
        if m.match_type in {"ambiguous", "duplicate", "conflict"} or m.confidence < CONFIDENCE_FLOOR:
            assert m.recommended_action == "human_review", f"not demoted: {m}"


CASES = [
    ("tool1_semantics", run_tool1, T1, [payload_is(Tool1Output), hashes_64, t1_status_enum]),
    ("tool2_types",     run_tool2, T2, [payload_is(Tool2Output), hashes_64, t2_target_type_set]),
    ("tool3_formulas",  run_tool3, T3, [payload_is(Tool3Output), hashes_64, t3_formula_shape]),
    ("tool4_standardize", run_tool4, T4, [payload_is(Tool4Output), hashes_64, t4_invariants]),
    ("tool5_update",    run_tool5, T5, [payload_is(Tool5Output), hashes_64, t5_invariants]),
]


def run_case(tool, run_fn, inputs, checks, client) -> dict:
    result = run_fn(inputs, client=client)
    passed, failed = 0, []
    for chk in checks:
        try:
            chk(result)
            passed += 1
        except AssertionError as e:
            failed.append(f"{chk.__name__}: {e}")
    price_in, price_out = NOVA_PRICING.get(result.meta.model_id, (0.0, 0.0))
    est = (result.meta.input_tokens / 1000) * price_in + (result.meta.output_tokens / 1000) * price_out
    return {
        "tool": tool, "model_id": result.meta.model_id,
        "in_tokens": result.meta.input_tokens, "out_tokens": result.meta.output_tokens,
        "latency_ms": result.meta.latency_ms, "est_usd": est,
        "checks_passed": passed, "checks_failed": failed,
    }


def format_report(rows, failures=None) -> str:
    """Render the measurement table as markdown for stdout. The committed record of a run
    lives in SESSION_AI.md, not a separate docs file."""
    models = sorted({r["model_id"] for r in rows})
    md = [
        "# AI Day 7 — eval measurements", "",
        f"Region `{settings.aws_region}` · models {models} · 1 case/tool (tool5 = 3 rows).", "",
        "| tool | model | in tok | out tok | latency ms | est $ | checks |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for r in rows:
        status = "OK" if not r["checks_failed"] else "FAIL " + "; ".join(r["checks_failed"])
        md.append(f"| {r['tool']} | {r['model_id']} | {r['in_tokens']} | {r['out_tokens']} "
                  f"| {r['latency_ms']} | {r['est_usd']:.6f} | {r['checks_passed']} {status} |")
    total = sum(r["est_usd"] for r in rows)
    md += ["", f"**Total est cost this run:** ${total:.6f} (cached reruns are free)."]
    if failures:
        md += ["", "## Model output findings", ""]
        for f in failures:
            md.append(f"- **{f['tool']}** ({f['kind']}): `{f['detail']}`")
    return "\n".join(md) + "\n"


def write_report(rows, failures, out_dir: Path) -> tuple[Path, Path]:
    """Persist the run as markdown + json. Returns (md_path, json_path)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    md_path = out_dir / "ai-eval-day7.md"
    json_path = out_dir / "ai-eval-day7.json"
    md_path.write_text(format_report(rows, failures), encoding="utf-8")
    json_path.write_text(
        json.dumps({"rows": rows, "failures": failures or []}, indent=2),
        encoding="utf-8",
    )
    return md_path, json_path


def main() -> int:
    print("== preflight ==")
    if preflight_main() != 0:
        print("preflight failed — aborting eval.")
        return 1

    print("== eval ==")
    client = CachingBedrockClient()
    rows, failures, ok = [], [], True
    for tool, run_fn, inputs, checks in CASES:
        try:
            row = run_case(tool, run_fn, inputs, checks, client)
        except ValidationError as e:
            detail = f"{e.error_count()} error(s): {e.errors()[0]['loc']} {e.errors()[0]['msg']}"
            print(f"  {tool}: SCHEMA FAIL {detail}")
            failures.append({"tool": tool, "kind": "schema", "detail": detail})
            ok = False
            continue
        except ValueError as e:
            print(f"  {tool}: PARSE FAIL {e}")
            failures.append({"tool": tool, "kind": "parse", "detail": str(e)})
            ok = False
            continue
        except (ClientError, BotoCoreError) as e:
            print(f"  {tool}: TRANSPORT FAIL {e}")
            failures.append({"tool": tool, "kind": "transport", "detail": str(e)})
            ok = False
            continue
        rows.append(row)
        mark = "OK" if not row["checks_failed"] else "CHECK FAIL"
        if row["checks_failed"]:
            ok = False
        print(f"  {tool}: {mark} in={row['in_tokens']} out={row['out_tokens']} "
              f"{row['latency_ms']}ms ${row['est_usd']:.6f}")

    if rows:
        print()
        print(format_report(rows, failures))
        md_path, json_path = write_report(rows, failures, EVAL_OUT_DIR)
        print(f"wrote {md_path} and {json_path}")
    return 0 if ok and rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
