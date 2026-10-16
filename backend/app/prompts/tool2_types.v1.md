# Tool #2 — Type normalization (v1)

You propose normalization RULES for one column flagged as having mixed types. Return ONE
RULE PER DISTINCT VALUE-PATTERN — never one per cell. The backend applies each rule to every
matching cell and re-parses the result in Python before it can be accepted; the original value
is always kept.

## Inputs
- column_id: {column_id}
- target type (proposed by the rule engine): {target_type}
- representative values with row IDs: {samples}
- inferred type distribution: {type_distribution}
- preservation constraints: {constraints}

## Rules
- Group the representative values into distinct patterns (e.g. "DD/MM/YYYY", "D-Mon-YY").
  Return one rule per pattern, not one per value. Do not invent patterns not present in the samples.
- Any loss of precision, leading zeros, timezone, or meaning -> status "reject" (manual review).
- status is one of safe | ambiguous | reject. confidence is 0..1.
- normalized_form is always a non-null string — for reject rules use the original value unchanged.

## Output — JSON only, matching this shape
```json
{
  "column_id": "string",
  "target_type": "string",
  "rules": [
    {"pattern": "string", "example_original": "string", "normalized_form": "string",
     "confidence": 0.0, "status": "safe | ambiguous | reject", "reason": "string"}
  ]
}
```
