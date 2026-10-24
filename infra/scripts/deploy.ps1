[CmdletBinding()]
param(
    [string]$StackName = "xlsx-workflow-demo",
    [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }),
    [string]$Environment = $(if ($env:ENVIRONMENT) { $env:ENVIRONMENT } else { "demo" }),
    [string]$ModelId = $(if ($env:BEDROCK_MODEL_ID) { $env:BEDROCK_MODEL_ID } else { "amazon.nova-lite-v1:0" }),
    [string]$HeavyModelId = $(if ($env:BEDROCK_MODEL_ID_HEAVY) { $env:BEDROCK_MODEL_ID_HEAVY } else { "amazon.nova-pro-v1:0" }),
    # Default to the deployed CloudFront origin, not localhost: the template already
    # hard-codes localhost in AllowOrigins, so a localhost default duplicates it and
    # API Gateway rejects the stack ("Duplicated values are not allowed in allow-origins").
    [string]$FrontendOrigin = $(if ($env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN } else { "https://d35kjusenp6a9t.cloudfront.net" }),
    [string]$CloudFormationServiceRoleArn = $(if ($env:CLOUDFORMATION_SERVICE_ROLE_ARN) { $env:CLOUDFORMATION_SERVICE_ROLE_ARN } else { "" }),
    [string]$LambdaExecutionRoleArn = $(if ($env:LAMBDA_EXECUTION_ROLE_ARN) { $env:LAMBDA_EXECUTION_ROLE_ARN } else { "" }),
    [string]$StateMachineExecutionRoleArn = $(if ($env:STATE_MACHINE_EXECUTION_ROLE_ARN) { $env:STATE_MACHINE_EXECUTION_ROLE_ARN } else { "" }),
    [string]$QuickSightAccountId = $(if ($env:QUICKSIGHT_ACCOUNT_ID) { $env:QUICKSIGHT_ACCOUNT_ID } else { "453995432289" }),
    [string]$QuickSightRegion = $(if ($env:QUICKSIGHT_REGION) { $env:QUICKSIGHT_REGION } else { "ap-southeast-1" }),
    [string]$QuickSightQualityDatasetId = $(if ($env:QUICKSIGHT_QUALITY_DATASET_ID) { $env:QUICKSIGHT_QUALITY_DATASET_ID } else { "qa-issues-s3-76bde119" }),
    [string]$QuickSightInspectionDatasetId = $(if ($env:QUICKSIGHT_INSPECTION_DATASET_ID) { $env:QUICKSIGHT_INSPECTION_DATASET_ID } else { "qa-inspections-s3-76bde119" }),
    [string]$QuickSightWorkbookRowsDatasetId = $(if ($env:QUICKSIGHT_WORKBOOK_ROWS_DATASET_ID) { $env:QUICKSIGHT_WORKBOOK_ROWS_DATASET_ID } else { "excelbridge-workbook-rows" }),
    [string]$QuickSightPermissionsDatasetId = $(if ($env:QUICKSIGHT_PERMISSIONS_DATASET_ID) { $env:QUICKSIGHT_PERMISSIONS_DATASET_ID } else { "excelbridge-owner-permissions" }),
    [string]$QuickSightRlsPermissionsDatasetArn = $(if ($env:QUICKSIGHT_RLS_PERMISSIONS_DATASET_ARN) { $env:QUICKSIGHT_RLS_PERMISSIONS_DATASET_ARN } else { "arn:aws:quicksight:ap-southeast-1:453995432289:dataset/excelbridge-owner-permissions" }),
    [string]$QuickSightEmbeddingRoleArn = $(if ($env:QUICKSIGHT_EMBEDDING_ROLE_ARN) { $env:QUICKSIGHT_EMBEDDING_ROLE_ARN } else { "" }),
    [string]$QuickSightReaderGroupName = $(if ($env:QUICKSIGHT_READER_GROUP_NAME) { $env:QUICKSIGHT_READER_GROUP_NAME } else { "website-readers" }),
    [ValidateSet("scheduled", "api")][string]$QuickSightRefreshMode = $(if ($env:QUICKSIGHT_REFRESH_MODE) { $env:QUICKSIGHT_REFRESH_MODE } else { "scheduled" }),
    [string]$QuickSightDashboardId = $(if ($env:QUICKSIGHT_DASHBOARD_ID) { $env:QUICKSIGHT_DASHBOARD_ID } else { "excelbridge-quality-dashboard" })
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path

$roleInputs = @{
    LambdaExecutionRoleArn = $LambdaExecutionRoleArn
    StateMachineExecutionRoleArn = $StateMachineExecutionRoleArn
}
foreach ($roleInput in $roleInputs.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace($roleInput.Value)) {
        throw "Missing $($roleInput.Key). Set the corresponding parameter or environment variable before deploying."
    }
    if ($roleInput.Value -notmatch '^arn:[A-Za-z0-9-]+:iam::[0-9]{12}:role/.+$') {
        throw "$($roleInput.Key) must be an IAM role ARN, for example arn:aws:iam::123456789012:role/example"
    }
}

# SAM's host builder must use the same Python minor version as the Lambda
# runtime. SAM installs backend/requirements.txt into the build artifact, so a
# full local development dependency install is not required for deployment.
$repoPythonScripts = Join-Path $repoRoot ".venv312\Scripts"
$repoPythonRoot = Join-Path $repoRoot ".venv312"
if (Test-Path -LiteralPath (Join-Path $repoPythonScripts "python.exe")) {
    $env:Path = "$repoPythonScripts;$env:Path"
    Write-Host "Using Python from .venv312\Scripts for SAM build"
} elseif (Test-Path -LiteralPath (Join-Path $repoPythonRoot "python.exe")) {
    $env:Path = "$repoPythonRoot;$env:Path"
    Write-Host "Using Python from .venv312 for SAM build"
}

# Use SAM from PATH, with one fallback for the standard Windows installer path.
$sam = Get-Command sam -ErrorAction SilentlyContinue
if ($sam) {
    $samPath = $sam.Source
} else {
    $samPath = Join-Path ${env:ProgramFiles} "Amazon\AWSSAMCLI\bin\sam.cmd"
    if (-not (Test-Path -LiteralPath $samPath)) {
        throw "SAM CLI was not found. Install it and add it to PATH: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    }
}

function Invoke-Sam {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & $samPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "SAM command failed with exit code $LASTEXITCODE"
    }
}

& (Join-Path $PSScriptRoot "preflight.ps1") -Region $Region -ModelId $ModelId -ForDeploy
if ($LASTEXITCODE -ne 0) { throw "Preflight failed" }

Push-Location $repoRoot
try {
    Invoke-Sam validate --template-file infra/template.yaml
    Invoke-Sam build --template-file infra/template.yaml --region $Region
    $parameterOverrides = @(
        "Environment=$Environment", "BedrockModelId=$ModelId", "BedrockHeavyModelId=$HeavyModelId", "FrontendOrigin=$FrontendOrigin", "LambdaExecutionRoleArn=$LambdaExecutionRoleArn", "StateMachineExecutionRoleArn=$StateMachineExecutionRoleArn", "QuickSightAccountId=$QuickSightAccountId", "QuickSightRegion=$QuickSightRegion", "QuickSightQualityDatasetId=$QuickSightQualityDatasetId", "QuickSightInspectionDatasetId=$QuickSightInspectionDatasetId", "QuickSightWorkbookRowsDatasetId=$QuickSightWorkbookRowsDatasetId", "QuickSightPermissionsDatasetId=$QuickSightPermissionsDatasetId", "QuickSightRlsPermissionsDatasetArn=$QuickSightRlsPermissionsDatasetArn", "QuickSightReaderGroupName=$QuickSightReaderGroupName", "QuickSightRefreshMode=$QuickSightRefreshMode"
    )
    if (-not [string]::IsNullOrWhiteSpace($QuickSightEmbeddingRoleArn)) {
        if ($QuickSightEmbeddingRoleArn -notmatch '^arn:[A-Za-z0-9-]+:iam::[0-9]{12}:role/.+$') {
            throw "QuickSightEmbeddingRoleArn must be an IAM role ARN"
        }
        $parameterOverrides += "QuickSightEmbeddingRoleArn=$QuickSightEmbeddingRoleArn"
    }
    if (-not [string]::IsNullOrWhiteSpace($QuickSightDashboardId)) {
        $parameterOverrides += "QuickSightDashboardId=$QuickSightDashboardId"
    }
    $deploymentArguments = @(
        "--template-file", ".aws-sam/build/template.yaml",
        "--stack-name", $StackName,
        "--region", $Region,
        "--resolve-s3",
        "--parameter-overrides"
    ) + $parameterOverrides + @(
        "--no-fail-on-empty-changeset"
    )
    if (-not [string]::IsNullOrWhiteSpace($CloudFormationServiceRoleArn)) {
        if ($CloudFormationServiceRoleArn -notmatch '^arn:[A-Za-z0-9-]+:iam::[0-9]{12}:role/.+$') {
            throw "CloudFormationServiceRoleArn must be an IAM role ARN, for example arn:aws:iam::123456789012:role/example"
        }
        $deploymentArguments += @("--role-arn", $CloudFormationServiceRoleArn)
    }
    Invoke-Sam deploy @deploymentArguments
} finally {
    Pop-Location
}
