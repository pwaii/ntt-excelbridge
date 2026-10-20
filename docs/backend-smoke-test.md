# Backend smoke-test runbook

This runbook verifies the backend in increasing levels of confidence. The
local path validates Python, workbook, API, storage, ownership, inspection,
quality, output, and artifact behavior. The deployed path validates Cognito,
API Gateway, S3, DynamoDB, Step Functions, Lambda, Bedrock, review gates,
output validation, and cleanup.

Use fake fixture workbooks only. The deployed path creates AWS resources and
may invoke Bedrock, so use a disposable account or stack.

## 1. Prerequisites

From the repository root:

```powershell
python --version
aws --version
sam --version
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
.\.venv\Scripts\python.exe backend\scripts\make_fixtures.py
```

Use Python 3.12 or newer. The fixture command creates:

```text
sample-data/current.xlsx
sample-data/main.xlsx
```

For local AWS-backed testing, copy `.env.example` to `.env` and set only
non-secret configuration such as:

```text
AWS_PROFILE=<local profile>
AWS_REGION=us-east-1
APP_DATA_BUCKET=<private bucket>
DYNAMO_TABLE=<table name>
STATE_MACHINE_ARN=
```

Never put access keys, session tokens, or real workbook data in the repository.

## 2. Static and automated checks

Run before touching AWS:

```powershell
.\.venv\Scripts\python.exe -m compileall -q backend\app
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check backend
sam validate --template-file infra\template.yaml
```

Expected results are successful Python compilation, all tests passing, no Ruff
violations, and a valid SAM transformation. If pytest, Ruff, or SAM is absent,
record that as an environment blocker rather than calling the backend fully
verified.

## 3. Local API and storage smoke test

This uses local authentication and the synchronous demo pipeline. It verifies
the API, S3, DynamoDB, upload checks, inspection, quality artifacts, output
creation, and artifact URLs. It intentionally does not exercise deployed
Step Functions or Bedrock.

Start the API in terminal 1:

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In terminal 2:

```powershell
$base = "http://127.0.0.1:8000"
$headers = @{ "X-User-Id" = "smoke-user" }
Invoke-RestMethod "$base/health" -Headers $headers
```

Expect `{"status":"ok"}`.

Create an update-enabled job. `key_column` is required by the backend:

```powershell
$body = @{
  config = @{
    comment_name = "Customer status"
    standardize = $false
    update = $true
    key_column = "CustomerID"
    input_sheet = "Customers"
    main_sheet = "CanonicalCustomers"
    conflict_policy = "reject_all"
  }
  input_filename = "current.xlsx"
  main_filename = "main.xlsx"
} | ConvertTo-Json -Depth 10
$job = Invoke-RestMethod "$base/v1/jobs" -Method Post -Headers $headers `
  -ContentType "application/json" -Body $body
$jobId = $job.job.job_id
$job.job.status
```

Expect `UPLOADING` and two upload instructions. Upload both files through the
local multipart route:

```powershell
curl.exe -X POST "$base/v1/jobs/$jobId/uploads/file/input" `
  -H "X-User-Id: smoke-user" -F "file=@sample-data/current.xlsx"
curl.exe -X POST "$base/v1/jobs/$jobId/uploads/file/main" `
  -H "X-User-Id: smoke-user" -F "file=@sample-data/main.xlsx"
```

Confirm the job:

```powershell
$job = Invoke-RestMethod "$base/v1/jobs/$jobId" -Headers $headers
$job.job.status
$job.job.files.input.uploaded
$job.job.files.main.uploaded
```

Expect `UPLOADED`, both flags `True`, and SHA-256 values on both files.

Start the local pipeline:

```powershell
$started = Invoke-RestMethod "$base/v1/jobs/$jobId/start" -Method Post -Headers $headers
$started.job.status
Invoke-RestMethod "$base/v1/jobs/$jobId/issues" -Headers $headers | ConvertTo-Json -Depth 10
```

Expect `COMPLETED` and fixture findings for duplicate rows, a blank row, a
blank column, and type mismatches. The local output is a pass-through copy; it
proves the storage path but is not the full AI workflow.

Download and reopen the output:

```powershell
$download = Invoke-RestMethod "$base/v1/jobs/$jobId/artifacts/output" -Headers $headers
Invoke-WebRequest $download.url -OutFile "$env:TEMP\ntt-output.xlsx"
.\.venv\Scripts\python.exe -c "from openpyxl import load_workbook; w=load_workbook(r'$env:TEMP\ntt-output.xlsx', data_only=False); print(w.sheetnames); w.close()"
```

Verify ownership isolation:

```powershell
$wrongHeaders = @{ "X-User-Id" = "different-user" }
try {
  Invoke-RestMethod "$base/v1/jobs/$jobId" -Headers $wrongHeaders
  throw "ownership check failed"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
```

Repeat the same check against the artifact endpoint.

## 4. Deploy the real AWS workflow

Authenticate and choose a disposable stack:

```powershell
aws sso login --profile <profile>
$env:AWS_PROFILE = "<profile>"
$env:AWS_REGION = "us-east-1"
```

Run preflight:

```powershell
.\infra\scripts\preflight.ps1 -Region $env:AWS_REGION `
  -ModelId amazon.nova-lite-v1:0 -ForDeploy
```

Validate and deploy:

```powershell
sam validate --template-file infra\template.yaml
.\infra\scripts\deploy.ps1 `
  -StackName ntt-excelbridge-smoke `
  -Region $env:AWS_REGION `
  -Environment smoke `
  -ModelId amazon.nova-lite-v1:0 `
  -HeavyModelId amazon.nova-pro-v1:0 `
  -FrontendOrigin http://localhost:5173
```

Capture outputs:

```powershell
$outputs = aws cloudformation describe-stacks `
  --stack-name ntt-excelbridge-smoke --region $env:AWS_REGION `
  --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
function OutputValue($name) {
  ($outputs | Where-Object { $_.OutputKey -eq $name }).OutputValue
}
$api = OutputValue "ApiUrl"
$bucket = OutputValue "DataBucketName"
$pool = OutputValue "UserPoolId"
$client = OutputValue "UserPoolClientId"
$stateMachine = OutputValue "StateMachineArn"
```

Confirm all five values are non-empty.

## 5. Cognito-authenticated API smoke test

Create a disposable user and obtain an ID token:

```powershell
$email = "ntt-smoke-$([guid]::NewGuid())@example.invalid"
$password = "SmokeTest-2026!Aa"
aws cognito-idp sign-up --client-id $client --username $email `
  --password $password --user-attributes Name=email,Value=$email `
  --region $env:AWS_REGION
aws cognito-idp admin-confirm-sign-up --user-pool-id $pool `
  --username $email --region $env:AWS_REGION
$auth = aws cognito-idp initiate-auth --client-id $client `
  --auth-flow USER_PASSWORD_AUTH `
  --auth-parameters "USERNAME=$email,PASSWORD=$password" `
  --region $env:AWS_REGION | ConvertFrom-Json
$token = $auth.AuthenticationResult.IdToken
$authHeaders = @{ Authorization = "Bearer $token" }
Invoke-RestMethod "$api/health" -Headers $authHeaders
```

Call the same endpoint without the Authorization header. The deployed API
should reject it with 401 or 403; it must not use the local `local-user`
fallback when Cognito is configured.

## 6. Presigned upload and segment 1

Create an authenticated job:

```powershell
$body = @{
  config = @{
    comment_name = "Customer status"
    standardize = $true
    update = $true
    key_column = "CustomerID"
    input_sheet = "Customers"
    main_sheet = "CanonicalCustomers"
    conflict_policy = "reject_all"
  }
  input_filename = "current.xlsx"
  main_filename = "main.xlsx"
} | ConvertTo-Json -Depth 10
$job = Invoke-RestMethod "$api/v1/jobs" -Method Post -Headers $authHeaders `
  -ContentType "application/json" -Body $body
$jobId = $job.job.job_id
```

Upload through the returned presigned URLs. The content type must match the
signed PUT parameters:

```powershell
$xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
$inputUpload = $job.uploads | Where-Object { $_.slot -eq "input" }
$mainUpload = $job.uploads | Where-Object { $_.slot -eq "main" }
Invoke-WebRequest $inputUpload.url -Method Put -InFile sample-data/current.xlsx -ContentType $xlsxType
Invoke-WebRequest $mainUpload.url -Method Put -InFile sample-data/main.xlsx -ContentType $xlsxType
```

Complete both uploads with server-verifiable hashes:

```powershell
$inputHash = (Get-FileHash sample-data/current.xlsx -Algorithm SHA256).Hash.ToLower()
$mainHash = (Get-FileHash sample-data/main.xlsx -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod "$api/v1/jobs/$jobId/uploads/complete" -Method Post `
  -Headers $authHeaders -ContentType "application/json" `
  -Body (@{ slot = "input"; sha256 = $inputHash } | ConvertTo-Json)
Invoke-RestMethod "$api/v1/jobs/$jobId/uploads/complete" -Method Post `
  -Headers $authHeaders -ContentType "application/json" `
  -Body (@{ slot = "main"; sha256 = $mainHash } | ConvertTo-Json)
```

Start and poll segment 1:

```powershell
Invoke-RestMethod "$api/v1/jobs/$jobId/start" -Method Post -Headers $authHeaders
do {
  Start-Sleep -Seconds 5
  $job = Invoke-RestMethod "$api/v1/jobs/$jobId" -Headers $authHeaders
  $job.job.status
} while ($job.job.status -notin @("QUALITY_REVIEW_PENDING", "FAILED", "CANCELLED"))
```

Expected result is `QUALITY_REVIEW_PENDING`. Inspect issues and proposals:

```powershell
$issues = Invoke-RestMethod "$api/v1/jobs/$jobId/issues" -Headers $authHeaders
$proposals = Invoke-RestMethod "$api/v1/jobs/$jobId/proposals" -Headers $authHeaders
$issues | ConvertTo-Json -Depth 10
$proposals | ConvertTo-Json -Depth 10
```

Fetch one full proposal artifact when proposals exist:

```powershell
$proposalId = $proposals.items[0].proposal_id
$proposalUrl = Invoke-RestMethod `
  "$api/v1/jobs/$jobId/proposals/$proposalId/artifact" -Headers $authHeaders
$proposalBody = Invoke-RestMethod $proposalUrl.url
$proposalBody.meta
```

This confirms the proposal payload is accessible through a short-lived,
ownership-checked URL rather than being copied into DynamoDB.

## 7. Review gates and segment 2/3

For a safe no-op run, reject every issue and proposal. This tests review S3
persistence, optimistic concurrency, and segment restart without changing cell
values.

Build a decisions object from every returned issue and proposal:

```powershell
$decisions = @{}
foreach ($record in $issues.items) {
  $decisions[$record.issue_id] = @{ decision = "reject"; reason = "smoke test no-op" }
}
foreach ($record in $proposals.items) {
  $decisions[$record.proposal_id] = @{ decision = "reject"; reason = "smoke test no-op" }
}
$reviewBody = @{
  expected_revision = [int]$job.job.revision
  decisions = $decisions
} | ConvertTo-Json -Depth 10
Invoke-RestMethod "$api/v1/jobs/$jobId/reviews" -Method Post `
  -Headers $authHeaders -ContentType "application/json" -Body $reviewBody
```

Expect `NORMALIZATION_PENDING`, then poll until
`TRANSFORMATION_REVIEW_PENDING`, `FAILED`, or `CANCELLED`. Fetch proposals
again after segment 2 because it adds Tool #3, Tool #4, and Tool #5 items.

Reject the segment-2 proposals with the current revision:

```powershell
$proposals = Invoke-RestMethod "$api/v1/jobs/$jobId/proposals" -Headers $authHeaders
$decisions = @{}
foreach ($record in $proposals.items) {
  $decisions[$record.proposal_id] = @{ decision = "reject"; reason = "smoke test no-op" }
}
$reviewBody = @{
  expected_revision = [int]$job.job.revision
  decisions = $decisions
} | ConvertTo-Json -Depth 10
Invoke-RestMethod "$api/v1/jobs/$jobId/reviews" -Method Post `
  -Headers $authHeaders -ContentType "application/json" -Body $reviewBody
```

Expect `APPLYING`, then poll until `COMPLETED` or `FAILED`.

## 8. Output, audit, validation, and immutability

After completion, inspect the artifact map:

```powershell
$job = Invoke-RestMethod "$api/v1/jobs/$jobId" -Headers $authHeaders
$job.job.status
$job.job.artifacts | ConvertTo-Json -Depth 10
```

Download the final artifacts:

```powershell
$artifactTypes = @("output", "audit", "review_summary", "validation", "inspection", "quality")
foreach ($type in $artifactTypes) {
  try {
    $signed = Invoke-RestMethod "$api/v1/jobs/$jobId/artifacts/$type" -Headers $authHeaders
    $path = "$env:TEMP\ntt-$jobId-$type"
    Invoke-WebRequest $signed.url -OutFile $path
    Write-Host "$type -> $path"
  } catch {
    Write-Host "$type unavailable: $($_.Exception.Message)"
  }
}
```

Reopen the workbook:

```powershell
.\.venv\Scripts\python.exe -c "from openpyxl import load_workbook; w=load_workbook(r'$env:TEMP\ntt-$jobId-output', data_only=False); print(w.sheetnames); w.close()"
```

Verify the validation report has `status: valid`, the audit contains decision
records and reasons, and the output hash matches the validation report. Compare
the original fixture hashes with the upload hashes to confirm source objects
were never modified.

## 9. Positive mutation and conflict tests

Use separate disposable jobs for these cases:

1. `standardize = true`, `update = false`: accept one Tool #4 mapping and one
   safe Tool #3 formula. Confirm the output is based on the current workbook.
2. `standardize = false`, `update = true`: accept one exact Tool #5 match.
   Confirm the output is based on the main workbook and the selected row changes.
3. `standardize = true`, `update = true`: accept a mapping and an update.
   Confirm standardized in-memory values are used before the main update.
4. With the fixture conflict rows, use `reject_all` and confirm both conflicting
   changes are skipped. Use `latest_wins` and confirm the higher current row
   number wins. Use `merge` and confirm later non-empty values are applied.
5. Include an unmatched current row. Confirm it is reported as skipped, never
   inserted into the main workbook, and recorded in the audit.

## 10. Failure, retry, cancel, and stale-review tests

Run against disposable jobs:

- Call `/start` twice. The second call must conflict and must not create a
  second execution.
- Submit the same review body twice. The second call must return
  `409 REVIEW_REVISION_CONFLICT`.
- Call `/cancel` while a deployed execution is running. The job must become
  `CANCELLED` and the Step Functions execution must stop.
- After a failed execution, call `/retry`. The job must re-enter its recorded
  segment and receive a new execution ARN.
- Request another user's job, issue, proposal, review, and artifact URL. Each
  must be rejected without revealing whether the resource exists.
- Upload a non-XLSX ZIP, wrong SHA-256, oversized file, and wrong content type.
  Confirm the expected 4xx response and no workflow start.

## 11. AWS operational checks

After the smoke run, inspect the deployed controls:

```powershell
aws cloudformation describe-stack-events --stack-name ntt-excelbridge-smoke --region $env:AWS_REGION --max-items 20
aws stepfunctions list-executions --state-machine-arn $stateMachine --region $env:AWS_REGION --max-results 10
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/ --region $env:AWS_REGION
aws s3api get-public-access-block --bucket $bucket --region $env:AWS_REGION
aws s3api get-bucket-versioning --bucket $bucket --region $env:AWS_REGION
aws dynamodb describe-time-to-live --table-name (OutputValue "MetadataTableName") --region $env:AWS_REGION
```

Confirm S3 public access is blocked, versioning is enabled, DynamoDB TTL is
enabled on `expires_at`, log groups have the expected retention, and no
execution remains running.

## 12. Cleanup

Review the stack name and region, then remove the test resources and versioned
S3 objects:

```powershell
.\infra\scripts\destroy-demo.ps1 `
  -StackName ntt-excelbridge-smoke -Region $env:AWS_REGION -Confirm
```

Verify the stack is gone:

```powershell
aws cloudformation describe-stacks --stack-name ntt-excelbridge-smoke --region $env:AWS_REGION
```

The final command should report that the stack does not exist. Also verify no
Step Functions executions remain and no unexpected S3 bucket or DynamoDB table
was left behind.
