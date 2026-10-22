# Decision 27: Parse the first complete model JSON object

## Context

The live standardization retry received two JSON objects in one Bedrock text
response. Extracting from the first opening brace to the last closing brace
joined both objects and raised `Extra data`, even though the first object was
complete.

## Decision

Use `json.JSONDecoder.raw_decode` to parse the first complete JSON object in the
response. Tool-specific Pydantic validation and allowlists remain unchanged and
must still accept or reject the parsed object.

## Consequence

Repeated answers, prose suffixes, and JSON fences no longer cause avoidable parse
failures. The backend does not repair truncated JSON or bypass schema validation.
