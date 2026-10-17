# Generated backend API types

`backend.ts` is generated from the actual FastAPI OpenAPI schema pinned at
`frontend/openapi/backend.json`. Do not edit generated types by hand.

From `frontend/`:

```powershell
npm.cmd run api:generate
npm.cmd run api:generate:offline
```

The first uses a running Backend; the second uses the pinned snapshot. See
[SESSION_FRONTEND.md](../../../../SESSION_FRONTEND.md#openapi-generation-and-api-transport)
for generation, contract ownership and runtime-validation requirements.
