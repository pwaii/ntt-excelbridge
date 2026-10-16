# AI Day 7 — eval measurements

Region `us-east-1` · models ['amazon.nova-lite-v1:0', 'amazon.nova-pro-v1:0'] · 1 case/tool (tool5 = 3 rows).

| tool | model | in tok | out tok | latency ms | est $ | checks |
|---|---|---:|---:|---:|---:|---|
| tool1_semantics | amazon.nova-lite-v1:0 | 347 | 173 | 1533 | 0.000062 | 3 OK |
| tool3_formulas | amazon.nova-pro-v1:0 | 243 | 245 | 2073 | 0.000978 | 3 OK |
| tool4_standardize | amazon.nova-pro-v1:0 | 255 | 379 | 2026 | 0.001417 | 3 OK |

**Total est cost this run:** $0.002458 (cached reruns are free).

## Model output findings (Day-6)

- **tool2_types** (schema): `1 error(s): ('rules', 1, 'normalized_form') Input should be a valid string`
- **tool5_update** (parse): `Expecting property name enclosed in double quotes: line 1 column 2 (char 1)`
