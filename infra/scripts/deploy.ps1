[CmdletBinding()]
param(
    [string]$StackName = "xlsx-workflow-demo",
    [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }),
    [string]$Environment = $(if ($env:ENVIRONMENT) { $env:ENVIRONMENT } else { "demo" }),
    [string]$ModelId = $(if ($env:BEDROCK_MODEL_ID) { $env:BEDROCK_MODEL_ID } else { "amazon.nova-lite-v1:0" }),
    [string]$HeavyModelId = $(if ($env:BEDROCK_MODEL_ID_HEAVY) { $env:BEDROCK_MODEL_ID_HEAVY } else { "amazon.nova-pro-v1:0" }),
    [string]$FrontendOrigin = $(if ($env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN } else { "http://localhost:5173" })
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
& (Join-Path $PSScriptRoot "preflight.ps1") -Region $Region -ModelId $ModelId -ForDeploy
if ($LASTEXITCODE -ne 0) { throw "Preflight failed" }

Push-Location $repoRoot
try {
    sam validate --template-file infra/template.yaml
    sam build --template-file infra/template.yaml --region $Region
    sam deploy --template-file .aws-sam/build/template.yaml `
        --stack-name $StackName `
        --region $Region `
        --capabilities CAPABILITY_IAM `
        --resolve-s3 `
        --parameter-overrides Environment=$Environment BedrockModelId=$ModelId BedrockHeavyModelId=$HeavyModelId FrontendOrigin=$FrontendOrigin `
        --no-fail-on-empty-changeset
} finally {
    Pop-Location
}
