# AI Model-Quality Report — Day 7

- **Date:** 2026-10-16
- **Region / models:** us-east-1 · Nova lite (`amazon.nova-lite-v1:0`) + Nova pro (`amazon.nova-pro-v1:0`), bare on-demand ids.
- **Source:** fresh real-Bedrock run, `python -m scripts.eval_tools` → `docs/ai-eval-day7.md`.

## Per-tool measurements

| tool | model | in tok | out tok | latency ms | est $ | checks |
|---|---|---:|---:|---:|---:|---|
| tool1_semantics | amazon.nova-lite-v1:0 | 347 | 173 | 1533 | 0.000062 | 3 OK |
| tool2_types | amazon.nova-lite-v1:0 | — | — | — | — | SCHEMA FAIL (see findings) |
| tool3_formulas | amazon.nova-pro-v1:0 | 243 | 245 | 2073 | 0.000978 | 3 OK |
| tool4_standardize | amazon.nova-pro-v1:0 | 255 | 379 | 2026 | 0.001417 | 3 OK |
| tool5_update | amazon.nova-lite-v1:0 | — | — | — | — | PARSE FAIL (see findings) |

Total est cost this run: $0.002458 (cached reruns are free).

## Model output findings

- **tool2_types** (schema): `normalized_form` field returned a non-string value (`null`). Pydantic rejects the whole response — correct behavior (invariant #1). Prompt should tighten the instruction that `normalized_form` must always be a non-null string.
- **tool5_update** (parse): Model returned malformed JSON (no valid opening brace). `_extract_json` raises `ValueError` — correct behavior. Likely a fence/preamble wrapping issue; prompt may need a stricter "return only raw JSON" instruction.

Both failures demonstrate the guard layer working as designed: bad model output is rejected before reaching the pipeline. No data was mutated.

## Confidence-band behavior

- Every tool's output is an untrusted proposal; nothing auto-applies.
- `ambiguous` proposals and `safe` proposals below the confidence floor are demoted to human review (Tools #2/#4/#5). A human selects at both review gates.
- Models may only *select* from candidate IDs/values supplied in the prompt; invented IDs/headers/canonicals are rejected whole.

## Known limitations

- **Summary-row / column totals are deferred** — the demo supports row-wise formulas only.
- **Update mode skips unmatched rows** — inserting unmatched rows is deferred.
- **Formulas are syntax-verified, not calculated** — OpenPyXL does not evaluate; output is labeled accordingly.
- **Region-locked model access** — cross-region inference profiles (`us.*`, `apac.*`) hit an org SCP deny; only bare us-east-1 Nova ids work in this account.
