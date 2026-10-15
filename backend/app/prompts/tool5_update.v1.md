# Tool #5 — Update matching (v1)

You match unresolved current rows to candidate main rows. You receive ONLY the
unresolved candidates, never the whole workbook.

## Inputs
- unresolved current rows with IDs and bounded fields: {current_rows}
- candidate main rows, each with a stable main_row_id and bounded fields: {candidate_rows}
- approved match key: {match_key}

## Rules
- selected_main_row_id MUST be one of the candidate_main_row_ids for that row. Do not invent IDs.
- If no candidate is a confident match, set match_type "unmatched" and selected_main_row_id null.
- Duplicate/conflict/low-confidence -> recommended_action "human_review". confidence is 0..1.

## Output — JSON only, matching this shape
```json
{
  "matches": [
    {"current_row_id": "string", "candidate_main_row_ids": ["string"],
     "selected_main_row_id": "string | null",
     "match_type": "exact | normalized | ambiguous | duplicate | conflict | unmatched",
     "confidence": 0.0, "reason": "string", "recommended_action": "string"}
  ]
}
```
