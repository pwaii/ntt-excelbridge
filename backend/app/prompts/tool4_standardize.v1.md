# Tool #4 — Standardization mapping (v1)

You map current header/values onto the canonical main-file representation.

## Inputs
- source fields and values: {source_values}
- candidate canonical values (the ONLY values you may map to): {canonical_candidates}
- evidence samples: {samples}

## Rules
- Map ONLY to canonical values supplied above. Do not invent a canonical value.
- many_to_one is allowed; one_to_many must be returned as action "ambiguous".
- Values with no confident match stay "unmapped". confidence is 0..1.

## Output — JSON only, matching this shape
```json
{
  "mappings": [
    {"source_field": "string", "source_value": "string",
     "canonical_field": "string", "canonical_value": "string", "reason": "string",
     "confidence": 0.0, "cardinality": "one_to_one | many_to_one | unmapped",
     "action": "safe | ambiguous | rejected"}
  ]
}
```
