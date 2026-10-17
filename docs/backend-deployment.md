# Backend deployment and verification

The deployment uses one AWS region per environment. Supported regions are
`us-east-1`, `ap-southeast-1`, and `ap-southeast-7`; the default is
`us-east-1`. Do not deploy the same demo across regions.

## Local checks

From the repository root:

```powershell
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
.\.venv\Scripts\python.exe -m pytest backend/app/tests -q
.\.venv\Scripts\python.exe -m ruff check backend/app
```

The local API uses the `local-user` fallback only when Cognito is not
configured. That fallback must not be used as a production authentication
boundary.

## AWS preflight

Authenticate first, then run:

```powershell
aws sso login --profile <profile>
$env:AWS_PROFILE = "<profile>"
$env:AWS_REGION = "us-east-1"
$env:BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0"
.\infra\scripts\preflight.ps1 -ForDeploy
```

Preflight checks caller identity, the required AWS control-plane APIs, and the
selected Bedrock model. It fails for unsupported regions or unavailable
services/models.

## Deploy

```powershell
.\infra\scripts\deploy.ps1 `
  -StackName xlsx-workflow-demo `
  -Region us-east-1 `
  -Environment demo `
  -ModelId amazon.nova-lite-v1:0 `
  -HeavyModelId amazon.nova-pro-v1:0 `
  -FrontendOrigin http://localhost:5173
```

The stack creates a private versioned S3 bucket, on-demand DynamoDB table with
owner/status GSIs and TTL, Cognito user-pool/client, JWT-protected HTTP API,
Lambda workers, and a Standard Step Functions state machine.

After deployment, inspect outputs:

```powershell
aws cloudformation describe-stacks --stack-name xlsx-workflow-demo --region us-east-1 `
  --query "Stacks[0].Outputs"
```

The API route starts segment 1. It ends at `QUALITY_REVIEW_PENDING`. A winning
review submission starts segment 2; the transformation review starts segment 3.
There are no task tokens or paused executions.

## Backend completion notes

Tool #2 runs only when deterministic quality inspection reports type mismatches.
Its rules are stored as item-addressable proposals. Tool #5 receives only
backend-generated candidate main rows, and its selected IDs are validated before
any update is applied. The apply worker supports `standardize_only`,
`update_only`, `both`, and `neither` output policies while always writing a new
S3 object.
Update jobs require `key_column` at job creation. When accepted matches collide
on one main row, the default `reject_all` conflict policy is safe; explicit
`latest_wins` and `merge` policies are also supported. “Keep both as new rows”
remains part of the deferred insertion feature.

The artifact route is:

```text
GET /v1/jobs/{job_id}/artifacts/{artifact_type}
```

Supported completed-job artifacts include `output`, `audit`,
`review_summary`, `validation`, `inspection`, `quality`, `review`, `input`, and
`main` when present. The API checks ownership and ensures that the referenced
key is inside the job prefix before creating the URL.

Individual full proposal payloads are available through:

```text
GET /v1/jobs/{job_id}/proposals/{proposal_id}/artifact
```

The proposal ID comes from the `proposal_id` field returned by the paginated
proposals endpoint.

The completion decisions are documented in
[`docs/decisions/0002-backend-days5-7-completion.md`](decisions/0002-backend-days5-7-completion.md).
The follow-up privacy and correctness hardening is documented in
[`docs/decisions/0003-backend-correctness-hardening.md`](decisions/0003-backend-correctness-hardening.md).
Proposal artifact access and audit reasons are documented in
[`docs/decisions/0004-proposal-artifact-access.md`](decisions/0004-proposal-artifact-access.md).
The full smoke-test sequence is in
[`docs/backend-smoke-test.md`](backend-smoke-test.md).

To remove a demo stack, including versioned S3 objects and running workflow
executions, review the target account and run:

```powershell
.\infra\scripts\destroy-demo.ps1 -StackName xlsx-workflow-demo -Region us-east-1 -Confirm
```

The script requires the explicit `-Confirm` switch and is intentionally not
run automatically.
