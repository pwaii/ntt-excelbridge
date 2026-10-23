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

Deployment uses the repository `.venv312` Python interpreter when it exists;
SAM installs `backend/requirements.txt` into the Lambda build artifact, so a
full development dependency install is not required. Docker is not required.
Set `AWS_PROFILE` and `AWS_REGION` in PowerShell, then pass deployment values
as script parameters. `.env` is used by the local Python API, not by
PowerShell.

The deployment template does not create IAM roles or policies. The Lambda and
Step Functions execution role ARNs are required. A CloudFormation service role
ARN is optional: when omitted, CloudFormation uses the caller's credentials,
which is appropriate for this demo account when the caller already has the
required resource permissions. If supplied, the CloudFormation service role
must be trusted by `cloudformation.amazonaws.com` and must be allowed to pass
the Lambda and Step Functions roles. The Lambda role must include the runtime
log, S3, DynamoDB, Step Functions, and Bedrock permissions used by the
application; the Step Functions role must be allowed to invoke every worker
Lambda. The deploying caller needs `iam:PassRole` for the two execution roles
and, when a CloudFormation service role is supplied, for that service role too.

For the Quick dashboard, use the registered Reader integration documented in
[`quick-dashboard-embedding.md`](quick-dashboard-embedding.md). The backend
role needs QuickSight `RegisterUser`, `DescribeUser`, `CreateGroupMembership`,
`DescribeDataSet`, and `GenerateEmbedUrlForRegisteredUser`, plus `sts:AssumeRole`
on the embedding role. The role must trust the backend principal for that
assumption. The refresh Lambda needs DynamoDB `GetItem` on the metadata table.
With the default scheduled refresh mode it does not call QuickSight ingestion
APIs; add `CreateIngestion` on all three dataset ARNs only when enabling API
refresh mode with Capacity pricing. Configure a shared
Reader group, an RLS rules dataset, and user-based RLS on both report datasets.
The app creates/reuses one IAM-federated Reader per Cognito subject; it does not
use anonymous session tags or require Capacity pricing for that registered-user
route. For account `453995432289`, the Reader group, permissions dataset,
user-based RLS attachments, hourly refresh schedules, and role permissions are
already configured. No customer Reader was created during setup. The current
CloudFormation stack still runs the previously deployed application code, so
deploy the updated SAM template and frontend before testing the hosted site.

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
  -FrontendOrigin http://localhost:5173 `
  -LambdaExecutionRoleArn $env:LAMBDA_EXECUTION_ROLE_ARN `
  -StateMachineExecutionRoleArn $env:STATE_MACHINE_EXECUTION_ROLE_ARN
```

If `CLOUDFORMATION_SERVICE_ROLE_ARN` is set, the command passes `--role-arn`
to SAM/CloudFormation. If it is empty, CloudFormation uses the caller's
credentials. The command does not pass `CAPABILITY_IAM`, because the template
contains no `AWS::IAM::*` resources and no SAM `Policies:` blocks.

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
Runtime correctness and deployment-transform fixes are documented in
[`docs/decisions/0006-backend-runtime-correctness.md`](decisions/0006-backend-runtime-correctness.md).
The full smoke-test sequence is in
[`docs/backend-smoke-test.md`](backend-smoke-test.md).

To remove a demo stack, including versioned S3 objects and running workflow
executions, review the target account and run:

```powershell
.\infra\scripts\destroy-demo.ps1 -StackName xlsx-workflow-demo -Region us-east-1 -Confirm
```

The script requires the explicit `-Confirm` switch and is intentionally not
run automatically.
