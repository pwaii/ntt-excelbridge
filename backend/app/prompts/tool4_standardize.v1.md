# Tool #4 — Standardization mapping (v1)

You map current header/values onto the canonical main-file representation.

## Inputs
- source fields and values (bounded exact values needed for applying the mapping): {source_values}
- candidate canonical values (the ONLY values you may map to): {canonical_candidates}
- evidence samples: {samples}

## Rules
- Map ONLY to canonical values supplied above. Do not invent a canonical value.
- Copy the `canonical_value` string character-for-character from the candidate list. Do not
  abbreviate, expand, or paraphrase it (e.g. do not return `HR` for `Human Resources`).
- Return each `source_value` exactly as supplied. Do not redact, mask, or rewrite it.
- many_to_one is allowed; one_to_many must be returned as action "ambiguous".
- Values with no confident match stay "unmapped". confidence is 0..1.
- For an unmapped value, set `canonical_value` to the empty string. Do not use the
  literal word `unmapped` as a canonical value.

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
