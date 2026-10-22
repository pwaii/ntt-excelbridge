"""End-to-end 2-input pipeline smoke test (local backend, no JWT needed)."""

import json
import time
import sys
from pathlib import Path
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8000/v1/jobs"
HEADERS = {"Content-Type": "application/json", "X-User-Id": "e2e-test"}
REGION1 = Path(__file__).parent.parent / "sample-data/fourfile/region1.xlsx"
REGION2 = Path(__file__).parent.parent / "sample-data/fourfile/region2.xlsx"


def _req(method, url, body=None, content_type="application/json", extra_headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-User-Id", "e2e-test")
    if data:
        req.add_header("Content-Type", content_type)
    if extra_headers:
        for k, v in extra_headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  HTTP {e.code}: {body[:300]}")
        raise


def _multipart_upload(url, slot, filepath):
    """POST a file via multipart/form-data to /uploads/file/{slot}."""
    import email.mime.multipart, email.mime.base, email.encoders, io
    boundary = "----E2EBoundary"
    filename = filepath.name
    file_bytes = filepath.read_bytes()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n"
        "\r\n"
    ).encode() + file_bytes + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("X-User-Id", "e2e-test")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def poll(job_id, target_statuses, timeout=300, interval=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = _req("GET", f"{BASE}/{job_id}")["job"]
        status = job["status"]
        print(f"  status: {status}")
        if status in target_statuses:
            return job
        if "FAILED" in status or "CANCELLED" in status:
            raise RuntimeError(f"Job entered terminal failure: {status}\n{json.dumps(job, indent=2)}")
        time.sleep(interval)
    raise TimeoutError(f"Timed out waiting for {target_statuses}")


def accept_all(report):
    """Build a decisions dict: accept everything required, ignore unverified/invalid formulas.
    API response is camelCase (alias_generator=to_camel on ReportModel)."""
    decisions = {}
    for item in report["items"]:
        rd = item.get("requiresDecision", True)   # camelCase; default True matches ReportItem
        if rd is False or item.get("status") != "proposed":
            continue
        iid = item["id"]
        allowed = item.get("allowedDecisions", ["accept", "reject", "ignore"])
        formula = item.get("formula")
        if formula and formula.get("syntax") in ("unverified", "invalid"):
            decisions[iid] = {"decision": "ignore", "reason": "syntax not verified in this run"}
        elif "accept" in allowed:
            decisions[iid] = {"decision": "accept"}
        elif "reject" in allowed:
            decisions[iid] = {"decision": "reject"}
        else:
            decisions[iid] = {"decision": "ignore", "reason": "no accept available"}
    return decisions


def _submit_gate(job_id, revision, stage):
    report = _req("GET", f"{BASE}/{job_id}/review-report?stage={stage}&expected_revision={revision}")
    items = report["items"]
    required = [i for i in items if i.get("requiresDecision", True) is not False and i.get("status") == "proposed"]
    print(f"  total items: {len(items)}  require decision: {len(required)}")
    for item in items:
        flag = " *" if item.get("requiresDecision", True) is not False else ""
        formula = item.get("formula", {})
        fmeta = f"  syntax={formula.get('syntax')}" if formula else ""
        print(f"    [{item['slot']}] {item['kind']}  {item.get('title','')}{fmeta}{flag}")
    decisions = accept_all(report)
    print(f"  submitting {len(decisions)} decisions")
    return _req("POST", f"{BASE}/{job_id}/reviews", {"expected_revision": revision, "decisions": decisions})


def main():
    print("=== 1. Create job ===")
    resp = _req("POST", BASE, {
        "config": {"comment_name": "Calculate TotalRevenue as Quantity times UnitPrice", "output_header": "TotalRevenue"},
        "input_filenames": ["region1.xlsx", "region2.xlsx"],
    })
    job_id = resp["job"]["job_id"]
    revision = resp["job"]["revision"]
    print(f"  job_id: {job_id}  revision: {revision}")

    print("\n=== 2. Upload files ===")
    r1 = _multipart_upload(f"{BASE}/{job_id}/uploads/file/input", "input", REGION1)
    print(f"  input: {r1['job']['status']}")
    r2 = _multipart_upload(f"{BASE}/{job_id}/uploads/file/input_2", "input_2", REGION2)
    print(f"  input_2: {r2['job']['status']}  (now: {r2['job']['status']})")
    revision = r2["job"]["revision"]

    print("\n=== 3. Inspect & confirm configuration ===")
    meta1 = _req("GET", f"{BASE}/{job_id}/workbooks/input/metadata")
    sheet1 = meta1["sheets"][0]
    ver1 = meta1["workbook_version"]
    print(f"  input: sheet={sheet1['name']!r}  header_row={sheet1['header_row']}  cols={len(sheet1['columns'])}")

    meta2 = _req("GET", f"{BASE}/{job_id}/workbooks/input_2/metadata")
    sheet2 = meta2["sheets"][0]
    ver2 = meta2["workbook_version"]
    print(f"  input_2: sheet={sheet2['name']!r}  header_row={sheet2['header_row']}  cols={len(sheet2['columns'])}")

    cfg_resp = _req("PUT", f"{BASE}/{job_id}/configuration", {
        "expected_revision": revision,
        "selections": {
            "input": {
                "sheet_name": sheet1["name"],
                "header_row": sheet1["header_row"],
                "header_confirmed": True,
                "workbook_version": ver1,
                "key_column": None,
            },
            "input_2": {
                "sheet_name": sheet2["name"],
                "header_row": sheet2["header_row"],
                "header_confirmed": True,
                "workbook_version": ver2,
                "key_column": None,
            },
        },
    })
    revision = cfg_resp["job"]["revision"]
    print(f"  configuration confirmed  revision={revision}")

    print("\n=== 4. Start job (segment 1: inspect + quality) ===")
    started = _req("POST", f"{BASE}/{job_id}/start")
    print(f"  status after start: {started['job']['status']}")

    print("\n=== 5. Wait for QUALITY_REVIEW_PENDING ===")
    job = poll(job_id, {"QUALITY_REVIEW_PENDING"})
    revision = job["revision"]
    print(f"  revision: {revision}")

    print("\n=== 6. Quality review ===")
    rev_resp = _submit_gate(job_id, revision, "quality")
    revision = rev_resp["job"]["revision"]
    print(f"  status: {rev_resp['job']['status']}  revision: {revision}")

    print("\n=== 7. Wait for TRANSFORMATION_REVIEW_PENDING ===")
    job = poll(job_id, {"TRANSFORMATION_REVIEW_PENDING"}, timeout=300)
    revision = job["revision"]

    print("\n=== 8. Transformation review ===")
    rev_resp = _submit_gate(job_id, revision, "transformation")
    revision = rev_resp["job"]["revision"]
    print(f"  status: {rev_resp['job']['status']}  revision: {revision}")

    print("\n=== 9. Wait for COMPLETED ===")
    job = poll(job_id, {"COMPLETED"}, timeout=120)

    print("\n=== 10. Check outputs ===")
    artifacts = job.get("artifacts", {})
    outputs = {k: v for k, v in artifacts.items() if k.startswith("output")}
    print(f"  output artifacts: {list(outputs.keys())}")
    for name, info in sorted(outputs.items()):
        size = info.get("size_bytes", "?")
        print(f"    {name}: size={size}  key={info.get('key','?')}")

    print(f"\n=== DONE  job_id={job_id} ===")
    if len(outputs) >= 2:
        print("  PASS: 2 output files produced")
    else:
        print(f"  WARN: expected 2 outputs, got {len(outputs)}")
    return job_id


if __name__ == "__main__":
    main()
