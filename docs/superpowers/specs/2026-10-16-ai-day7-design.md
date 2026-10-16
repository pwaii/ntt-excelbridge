# AI Day 7 — Design Spec

- **Date:** 2026-10-16
- **Status:** Approved (brainstorming)
- **Spec for:** AI Day 7 (`docs/ai-plan.md` §Day-7), bounded by **ADR 0001** and CLAUDE.md invariants.
- **Working dir:** `backend/` (pytest: `pythonpath=["."]`, `testpaths=["app/tests"]`).

## Goal

Day 7 is the AI track's wrap-up. Three deliverables from the plan:

1. Validate prompt versions + response schemas are **pinned** (a guard test, not prose).
2. **Adversarial tests** — fill the gaps the per-tool Day-4/5 tests don't already cover: invented row IDs, empty responses, no-JSON output, contradictory mappings.
3. A short **model-quality report** with known limitations, from a **fresh real-Bedrock run**.

**Scope decision (brainstorming, driver = "plan checklist wrap-up"):** minimal gap-fill (Approach A). No new tool, no prompt `v2`, no threshold retuning, no property-based fuzzing, no BE-integration work. The validation layer is already right; Day 7 proves it and documents it.

## Verified preconditions

- **Prompt versions are already pinned in code.** Every `tool{1..5}_*.py` declares `PROMPT_VERSION = "v1"` and a `_FIELDS` tuple; `prompts.get_prompt(tool, version)` loads `prompts/<tool>.<version>.md`. Day 7 adds the test that fails if these drift — it does **not** introduce the versioning.
- **Shared parse seam:** `bedrock_client._extract_json(text)` takes the outermost `{...}` and raises `ValueError` when none is present. A response of `"{}"` parses to `{}` and flows to each tool's Pydantic `model_validate`, which rejects it on missing required fields. So "no JSON" is one central test; "empty object" is a per-tool schema-rejection test.
- **Already covered by Day-4/5 fake-client unit tests (do NOT duplicate):** hallucinated header (Tool #3/#4), forbidden formula function (Tool #3), one-to-many demotion (Tool #4), non-candidate `main_row_id` selection (Tool #5), below-floor demotion (Tools #4/#5), malformed payload (Tools #3/#4/#5).
- **No Day-6 numbers persist in the tree.** `docs/ai-eval-day6.{md,json}` were committed in `d245a39` then removed; not in HEAD, not on disk. The report must come from a fresh run — matching the brainstorming choice.
- **Live-run config (memory `bedrock-access-us-east-1-bare-ids`):** `AWS_PROFILE=ChallengerAccess-453995432289`, `AWS_REGION=us-east-1`, no `BEDROCK_MODEL_ID` override. Bare `amazon.nova-lite-v1:0` / `amazon.nova-pro-v1:0`. Cross-region inference-profile ids (`us.*`, `apac.*`) hit an org SCP deny — do not use.
- **Harness exists:** `backend/scripts/eval_tools.py` runs preflight → all five tools via `CachingBedrockClient` → builds a markdown cost/latency/token table via `format_report`, currently printed to stdout only.

---

## 1. Pin guard — `backend/app/tests/test_ai_day7.py` (new)

One parametrized test over the five tool modules. Each case is `(module, expected_tool_name)`; the test reads `module.TOOL`, `module.PROMPT_VERSION`, `module._FIELDS`:

- assert `module.PROMPT_VERSION == "v1"`;
- assert the prompt file `prompts/<TOOL>.v1.md` exists (via `prompts.get_prompt(TOOL, "v1")` not raising);
- assert every placeholder name in `module._FIELDS` appears in that prompt text.

Rationale: a renamed/deleted prompt file or a field drifting out of sync currently fails only at a live Bedrock call. This moves it to test time. This is the plan's "validate prompt versions + response schemas are pinned" item — the Pydantic schemas themselves are already exercised by every Day-1..6 test, so the gap is the prompt↔field↔version linkage.

## 2. Adversarial gaps — same `test_ai_day7.py`

Crafted fake responses, offline, deterministic. Only the uncovered cases:

- **No JSON at all:** `_extract_json("sorry, I can't")` → `ValueError`. One test on the shared seam.
- **Empty object per tool:** inject a fake client returning `{}`; each `run_toolN(...)` raises Pydantic `ValidationError`. Parametrized over the five tools, reusing each day's existing fake-client fixture shape.
- **Invented row_id (Tool #2):** a `proposals[]` entry whose `row_id` is not among the input's representative rows → rejected (reuses the Day-3 reject path / allowlist). If the current adapter does not already reject this, the test is red first and the fix is a bounded check in `tool2_types.py`, not a new abstraction.
- **Contradictory mapping (Tool #4):** one response mapping the same source value to two different canonical targets → rejected or forced `ambiguous`. Same red-first rule: if uncovered, add a minimal duplicate-source check in `tool4_standardize.py`.

**Shortcut note to carry into code where applicable:** `shortcut: <the limit>, <when to upgrade>` on any check that is demo-bounded.

## 3. Eval persistence — `backend/scripts/eval_tools.py` (edit)

Smallest change: after `format_report(rows, failures)` is built in `main()`, also write it to disk alongside printing it.

- Write the markdown to `docs/ai-eval-day7.md`.
- Write `rows` (+ `failures`) as JSON to `docs/ai-eval-day7.json`.
- Names are day-stamped (`day7`) to match the existing cadence; the removed `day6` files are not resurrected.

No change to how tokens/latency/cost are gathered, to pricing, preflight, or the cache. Persistence only.

## 4. Model-quality report — `docs/ai-model-quality.md` (new, hand-written)

1. Run `python -m scripts.eval_tools` live with the config above (preflight runs first; cached reruns are free).
2. Harness writes `docs/ai-eval-day7.{md,json}`.
3. Hand-write `docs/ai-model-quality.md`:
   - per-tool tokens / latency / cost table (lifted from the fresh run);
   - confidence-band behavior — ambiguous and below-floor proposals route to humans, never auto-apply;
   - **known limitations:** summary-row / column totals deferred (row-wise formulas only); update mode skips unmatched rows (insert deferred); formulas are **syntax-verified, not calculated** (OpenPyXL does not evaluate); cross-region inference profiles blocked by org SCP (bare us-east-1 ids only).

## Verification

- `pytest backend/app/tests/test_ai_day7.py` green.
- Full suite stays green (baseline 59 passing).
- `python -m scripts.eval_tools` exits 0; `docs/ai-eval-day7.{md,json}` written with real numbers; total run cost printed and well under cap (a few cents).

## Out of scope / risks

- **Out:** new tools, prompt `v2`, threshold retuning, Hypothesis fuzzing, BE-integration changes.
- **Risk:** the live run depends on a valid AWS SSO session and Nova availability. Expired login → the harness aborts at preflight with a clean failure and no spend. If the session can't be established, items 1–2 (offline tests) still complete; only the report (items 3–4) blocks on login.
