[CmdletBinding()]
param(
    [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }),
    [string]$ModelId = $(if ($env:BEDROCK_MODEL_ID) { $env:BEDROCK_MODEL_ID } else { "amazon.nova-lite-v1:0" }),
    [switch]$ForDeploy
)

$ErrorActionPreference = "Stop"
$allowedRegions = @("us-east-1", "ap-southeast-1", "ap-southeast-7")
if ($allowedRegions -notcontains $Region) { throw "Region '$Region' is not allowed. Choose: $($allowedRegions -join ', ')" }

Write-Host "Checking AWS identity and region: $Region"
aws sts get-caller-identity --region $Region | Out-Null

$checks = @(
    @{ Name = "S3"; Command = { aws s3api list-buckets --region $Region | Out-Null } },
    @{ Name = "DynamoDB"; Command = { aws dynamodb list-tables --region $Region | Out-Null } },
    @{ Name = "Lambda"; Command = { aws lambda list-functions --region $Region --max-items 1 | Out-Null } },
    @{ Name = "API Gateway"; Command = { aws apigatewayv2 get-apis --region $Region --max-results 1 | Out-Null } },
    @{ Name = "Step Functions"; Command = { aws stepfunctions list-state-machines --region $Region --max-results 1 | Out-Null } },
    @{ Name = "Cognito"; Command = { aws cognito-idp list-user-pools --region $Region --max-results 1 | Out-Null } },
    @{ Name = "CloudWatch"; Command = { aws logs describe-log-groups --region $Region --limit 1 | Out-Null } },
    @{ Name = "Bedrock model"; Command = { aws bedrock get-foundation-model --region $Region --model-identifier $ModelId | Out-Null } }
)

$failed = @()
foreach ($check in $checks) {
    try {
        & $check.Command
        Write-Host "PASS $($check.Name)" -ForegroundColor Green
    } catch {
        $failed += $check.Name
        Write-Host "FAIL $($check.Name): $($_.Exception.Message)" -ForegroundColor Red
    }
}

if ($ForDeploy -and $failed.Count -gt 0) {
    throw "Preflight failed for: $($failed -join ', ')"
}
if ($failed.Count -gt 0) {
    Write-Warning "Preflight completed with failures. Use -ForDeploy to make failures fatal."
} else {
    Write-Host "Preflight passed for $Region and $ModelId" -ForegroundColor Green
}
