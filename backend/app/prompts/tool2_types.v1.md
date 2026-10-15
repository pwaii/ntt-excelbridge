# Tool #2 — Type normalization (v1)

You propose normalized values for one column flagged as having mixed types. The
backend re-parses every normalized value in Python before it can be accepted;
the original value is always kept.

## Inputs
- column_id: {column_id}
- target type (proposed by the rule engine): {target_type}
- representative values with row IDs: {samples}
- inferred type distribution: {type_distribution}
- preservation constraints: {constraints}

## Rules
- Propose normalizations ONLY for the row IDs listed above. Do not invent row IDs.
- Any loss of precision, leading zeros, timezone, or meaning -> status "reject" (sent to manual review).
- status is one of safe | ambiguous | reject. confidence is 0..1.

## Output — JSON only, matching this shape
```json
{
  "column_id": "string",
  "target_type": "string",
  "proposals": [
    {"row_id": "string", "original": "string", "normalized": "string",
     "confidence": 0.0, "status": "safe | ambiguous | reject", "reason": "string"}
  ]
}
```
