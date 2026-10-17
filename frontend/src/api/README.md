# Backend contract boundary

API architecture, error/retry semantics and generation instructions are maintained
in [SESSION_FRONTEND.md](../../../SESSION_FRONTEND.md#openapi-generation-and-api-transport).
The [workbook API contract](../../../SESSION_FRONTEND.md#day-2-workbook-api-contract)
documents metadata, saved selections and Start compatibility.

Backend OpenAPI is authoritative. `jobs-api.ts` uses generated wire types plus
runtime validation. Prompt is the UI label; `comment_name` remains the API field.
Legacy handwritten models are compatibility code, not authoritative contracts.
