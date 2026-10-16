# AI Day 6 — Design Spec

- **Date:** 2026-10-16
- **Status:** Approved (brainstorming)
- **Spec for:** AI Day 6 (`docs/ai-plan.md` §Day-6), bounded by **ADR 0001** and CLAUDE.md invariants.
- **Working dir:** `backend/` (pytest: `pythonpath=["."]`, `testpaths=["app/tests"]`).

## Goal

Day 6 is the first time the Tool #1–#5 adapters run against **real** Bedrock instead of a fake client. Four deliverables from the plan:

1. Full fixture evaluation against real Bedrock with capped samples (exact / fuzzy / ambiguous / duplicate / no-match).
2. Measure average tokens + latency per tool.
3. Cache responses by input hash for repeat demo runs.
4. Confirm no Marketplace model / subscription is required.

**Scope decision (brainstorming):** "run + measure + light checks" — run every tool against a small per-tool fixture set, record output + tokens + latency, assert only the invariants that hold on *whatever the real model returns* (schema parses, enums valid, demote applied for the returned confidence/type, no off-candidate id slipped through). Hard accuracy scoring + threshold tuning stay in Day 7. The adversarial reject-whole paths (hallucinated id, forbidden formula) remain covered by the existing fake-client unit tests — the live model can't be forced to emit them.

## Verified preconditions (dry-run, 2026-10-16)

Proven green this session with `python -m scripts.smoke_tool1` (see `memory/bedrock-access-us-east-1-bare-ids.md`):

- **The Day-1 model config is correct and unchanged.** Bare `amazon.nova-lite-v1:0` and `amazon.nova-pro-v1:0` both invoke successfully, non-Marketplace, in **us-east-1** (the `settings.aws_region` / `bedrock_model_id` / `_heavy` defaults). Tool #1's real output parsed into `Tool1Output` (355 in / 161 out tokens, status=confirmed).
- **No `settings` / `MODEL_ALLOWLIST` change.** This spec adds no code to the adapter library or `settings`.
- **Environment gotcha (the one real constraint):** this hackathon account's org SCP denies `bedrock:InvokeModel` outside a region whitelist. **Cross-region inference-profile ids (`us.*`, `apac.*`) fail** — they fan the request out to a denied region (`us-west-2` / `ap-southeast-2`). Use **bare ids pinned to us-east-1**. ap-southeast-1 is a dead end (bare Nova → "on-demand not supported"). Run config: `AWS_PROFILE=ChallengerAccess-453995432289`, `AWS_REGION=us-east-1`, no `BEDROCK_MODEL_ID` override.
- Every adapter funnels through `BedrockClient.converse_json(model_id, prompt, max_tokens, temperature)` and accepts an injected `client`. That single interface is the only seam this spec touches — caching and measurement wrap it; adapters are unchanged.
- Existing pattern to follow: `backend/scripts/smoke_tool1.py` (real Bedrock, `python -m scripts.<name>`, prints + exit code, friendly `ClientError`/`BotoCoreError` hints).

---

## 1. Response cache — `backend/app/ai/cache.py` (new)

`CachingBedrockClient(inner=None)` exposing the **identical** `converse_json(model_id, prompt, max_tokens, temperature)` signature as `BedrockClient`, so it is a drop-in wherever a client is injected. `inner` defaults to a real `BedrockClient()`.

- **Key:** `sha256_hex(model_id + "\x00" + prompt)` — reuses `adapter.sha256_hex`, the same hash adapters already log as `input_hash`. (`max_tokens`/`temperature` are fixed per deploy, not part of the key — keep it the input hash the plan names.)
- **Store:** one JSON file per key under a fixed `CACHE_DIR = backend/.cache/bedrock/` (module-level constant, monkeypatchable in tests) as `<key>.json`, holding the full return tuple `{parsed, raw, usage, latency_ms}`. All JSON-serializable.
- **Hit:** load file, return `(parsed, raw, usage, latency_ms)` — no call to `inner`.
- **Miss:** call `inner.converse_json(...)`, write the file, return the result. `mkdir(parents=True, exist_ok=True)` on first write.
- **Safe to cache (ADR 0001 residual note):** a human reviews every result, so a stale cached proposal can never auto-apply.

`.gitignore`: add `backend/.cache/`.

**Test — `backend/app/tests/test_ai_day6.py` (new, offline, no boto):**
- miss → calls a fake inner once, writes a file, returns the tuple;
- hit → second call with the same (model_id, prompt) returns the stored tuple and does **not** call inner again (assert inner call-count stays 1);
- different prompt → different key → inner called again.
Use a `tmp_path` cache dir (monkeypatch the module `CACHE_DIR`) so the test leaves nothing behind.

---

## 2. Model preflight — `backend/scripts/preflight.py` (new, real Bedrock)

The deferred Day-1 check, grounded by the dry-run finding that `list-foundation-models` is **not** sufficient (it listed Nova in a region where an SCP blocked invocation). Availability + non-Marketplace + SCP-clear are only proven by a real invocation.

- For each id in `MODEL_ALLOWLIST` (the bare settings ids): one minimal `BedrockClient().converse_json(model_id, "ping", max_tokens=8)` wrapped in try/except.
- **PASS** if the call returns (any JSON or even a `ValueError: no JSON object` from `_extract_json` still proves the model is invocable + entitled + non-Marketplace). Distinguish: a transport success is the signal, not JSON validity — so catch `ValueError` from `_extract_json` as a **PASS** (model answered), and only `ClientError`/`BotoCoreError` as **FAIL**.
- **FAIL** prints the error code + the `smoke_tool1` hint (Marketplace / SCP / not-entitled / expired creds), exit 1.
- Prints region + each model's PASS/FAIL. Exit 0 only if all allowlisted models pass. BE reuses this at deploy (§7.1/§19).

`shortcut: a "ping" invoke costs a few tokens per model per run; acceptable vs the alternative of a non-authoritative list check. Upgrade to a cached/once-per-deploy gate when wired into CI.`

---

## 3. Eval harness — `backend/scripts/eval_tools.py` (new, real Bedrock)

Generalizes `smoke_tool1` across all five tools. Runs preflight first; aborts non-zero if it fails.

**Fixture set (in-module):** per tool, a short list of cases `{name, inputs, checks}` where `inputs` is the dict passed to `run_toolN`. Reuse the input shapes already encoded in `test_ai_day1..5.py` and `smoke_tool1.FIXTURE`; design inputs to elicit the case types the plan names — for Tool #5: exact, fuzzy, ambiguous, duplicate, no-match (candidate rows crafted so one is a clear match, two are equally plausible, none match, etc.). `checks` is a small list of callables run on the real `ToolResult`:

- **all tools:** `payload` is the right type (schema parsed) and `meta.input_hash`/`output_hash` are 64-char.
- **tool2/tool4/tool5:** every `recommended_action`/`status`/`match_type` is a valid enum; demote-only invariant holds — any `ambiguous`/`duplicate`/`conflict` or below-`CONFIDENCE_FLOOR` item carries `human_review` (tool5) / `ambiguous` (tool4).
- **tool4/tool5:** no selected/canonical value sits outside the supplied candidate allowlist (reject-whole would have raised; assert it didn't silently pass one).
- **tool3:** returned `formula_template` starts `=` and `referenced_headers ⊆ source_headers`.

A case may also be marked `expect_error=(ValueError|ValidationError)` for any negative fixture that is deterministic without the model — but per the scope decision these stay in the pytest unit tests; the live harness is positive-path. Keep the field available, author none for Day 6.

**Run loop:** for each tool/case, `run_toolN(inputs, client=CachingBedrockClient())`; on the first (uncached) pass this hits real Bedrock, on reruns it is free. Record `meta.input_tokens`, `meta.output_tokens`, `meta.latency_ms`, and each check's pass/fail. Catch `ClientError`/`BotoCoreError` → print the hint, mark the tool failed, continue.

**Cost (#4 of the plan's "measure"):** a small in-module `NOVA_PRICING` dict — per-1k input/output USD for `amazon.nova-lite-v1:0` and `amazon.nova-pro-v1:0` (looked up at implementation from current AWS Nova on-demand pricing). Compute real USD per tool from the measured tokens here. `policy.estimate_cost_usd` and its `PRICE_PER_1K_*_USD = 0.0` placeholders are left untouched.
`shortcut: cost truth lives in the eval report only; fold a per-model price into estimate_cost_usd(..., model_id) when BE wires adapters into a worker.`

**Output:** write `docs/ai-eval-day6.json` (machine: per-tool avg in/out tokens, avg latency_ms, est USD, case pass/fail) and `docs/ai-eval-day6.md` (human table: tool | cases | avg in | avg out | avg ms | est $ | checks passed). Print the markdown table to stdout. Exit 0 iff all checks pass and no transport error.

---

## 4. What does NOT change

- `settings.py`, `MODEL_ALLOWLIST`, `bedrock_client.py`, and every `tool*.py` adapter — untouched. Day-6 is a wrapper + two scripts + fixtures + a generated report.
- `policy.estimate_cost_usd` and its placeholders — untouched (cost computed in the harness).
- `CONFIDENCE_FLOOR = 0.80` — the Day-7 tuning knob, untouched here.

## Files

| File | Change |
|---|---|
| `backend/app/ai/cache.py` | **new** — `CachingBedrockClient` |
| `backend/app/tests/test_ai_day6.py` | **new** — offline cache hit/miss test |
| `backend/scripts/preflight.py` | **new** — real-invoke non-Marketplace + availability check |
| `backend/scripts/eval_tools.py` | **new** — 5-tool eval harness + fixtures + cost + report writer |
| `.gitignore` | add `backend/.cache/` |
| `docs/ai-eval-day6.json` / `.md` | **new** — generated Day-6 measurement artifact (committed) |
| `SESSION_AI.md` | Day-6 section + the us-east-1/bare-id/SCP note |

## Verification

- `python -m pytest` → whole backend suite green, including the new offline cache test; **no real boto in any pytest**.
- Live, once, in one token-lifetime: `AWS_PROFILE=ChallengerAccess-453995432289 AWS_REGION=us-east-1 python -m scripts.preflight` → all PASS; then `... python -m scripts.eval_tools` → all checks pass, report written. Commit the generated `docs/ai-eval-day6.*`.

## Handoff / notes

- **Run config is the deliverable, not just the code:** future AI-script runs use the SSO `ChallengerAccess` profile + us-east-1 + bare Nova ids. Inference-profile ids are poison in this account (SCP). Captured in `memory/bedrock-access-us-east-1-bare-ids.md`.
- **Preflight for BE/deploy:** `scripts/preflight.py` is the §7.1/§19 model preflight BE needs for IAM scoping — a real invoke is the authoritative check, not `list-foundation-models`.
- **Not in this spec:** Day-7 adversarial/accuracy scoring + threshold tuning; folding per-model cost into `estimate_cost_usd`; BE wiring adapters into a worker; ADR D1 size caps.
