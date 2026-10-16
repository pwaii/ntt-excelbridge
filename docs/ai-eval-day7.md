# AI Day 7 — eval measurements

Region `us-east-1` · models ['amazon.nova-lite-v1:0', 'amazon.nova-pro-v1:0'] · 1 case/tool (tool5 = 3 rows).

| tool | model | in tok | out tok | latency ms | est $ | checks |
|---|---|---:|---:|---:|---:|---|
| tool1_semantics | amazon.nova-lite-v1:0 | 347 | 173 | 1556 | 0.000062 | 3 OK |
| tool2_types | amazon.nova-lite-v1:0 | 379 | 435 | 2322 | 0.000127 | 3 OK |
| tool3_formulas | amazon.nova-pro-v1:0 | 243 | 239 | 3063 | 0.000959 | 3 OK |
| tool4_standardize | amazon.nova-pro-v1:0 | 255 | 292 | 2823 | 0.001138 | 3 OK |
| tool5_update | amazon.nova-lite-v1:0 | 467 | 265 | 1301 | 0.000092 | 3 OK |

**Total est cost this run:** $0.002379 (cached reruns are free).
