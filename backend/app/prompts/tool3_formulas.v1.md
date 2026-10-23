# Tool #3 — Formula generation (v1)

You draft a spreadsheet formula TEMPLATE for a new column. The backend verifies it
against a function allowlist and in-range references; it is labeled "syntax verified,"
never "calculated."

## Inputs
- comment meaning: {meaning}
- source headers: {source_headers}
- allowed functions: {allowed_functions}
- sample rows: {samples}
- expected output type: {expected_type}

## Rules
- Use ONLY the allowed functions and the source headers listed above. Do not invent headers.
- No external links, macros, INDIRECT, OFFSET, WEBSERVICE, HYPERLINK, or volatile functions.
- Use ordinary A1-style cell references with the literal `{row}` placeholder, for example
  `=IFERROR(F{row}*G{row},0)`. Use `{row}` exactly once per cell reference — never `C{row}{row}`.
  Do not use Excel table references such as `[@Quantity]`.
- The formula must start with "=". confidence is 0..1.

## Output — JSON only, matching this shape
```json
{
  "formula_template": "=...",
  "target_header": "string",
  "expected_type": "string",
  "referenced_headers": ["string"],
  "explanation": "string",
  "confidence": 0.0
}
```
