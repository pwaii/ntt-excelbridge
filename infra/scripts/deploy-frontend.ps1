[CmdletBinding()]
param(
    [string]$BackendStackName = "xlsx-workflow-demo",
    [string]$FrontendStackName = "xlsx-workflow-demo-frontend",
    [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }),
    [string]$Environment = $(if ($env:ENVIRONMENT) { $env:ENVIRONMENT } else { "demo" }),
    [string]$ModelId = $(if ($env:BEDROCK_MODEL_ID) { $env:BEDROCK_MODEL_ID } else { "amazon.nova-lite-v1:0" }),
    [string]$HeavyModelId = $(if ($env:BEDROCK_MODEL_ID_HEAVY) { $env:BEDROCK_MODEL_ID_HEAVY } else { "amazon.nova-pro-v1:0" }),
    [string]$FrontendOrigin = $(if ($env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN } else { "http://localhost:5173" }),
    [string]$LambdaExecutionRoleArn = $(if ($env:LAMBDA_EXECUTION_ROLE_ARN) { $env:LAMBDA_EXECUTION_ROLE_ARN } else { "" }),
    [string]$StateMachineExecutionRoleArn = $(if ($env:STATE_MACHINE_EXECUTION_ROLE_ARN) { $env:STATE_MACHINE_EXECUTION_ROLE_ARN } else { "" }),
    [string]$CloudFormationServiceRoleArn = $(if ($env:CLOUDFORMATION_SERVICE_ROLE_ARN) { $env:CLOUDFORMATION_SERVICE_ROLE_ARN } else { "" })
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$frontendDir = Join-Path $repoRoot "frontend"

function Invoke-Aws {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & aws @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI command failed with exit code $LASTEXITCODE"
    }
}

function Get-StackOutput {
    param([string]$StackName, [string]$Key)
    $json = aws cloudformation describe-stacks --stack-name $StackName --region $Region | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "Could not read CloudFormation stack $StackName" }
    $output = $json.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq $Key }
    if (-not $output) { throw "CloudFormation output $Key was not found on $StackName" }
    return $output.OutputValue
}

function Get-S3PresignedOrigin {
    param([string]$Bucket, [string]$AwsRegion)

    # boto3 uses the legacy global virtual-hosted endpoint for S3 in
    # us-east-1. The browser allowlist must match the origin in the signed
    # URL exactly; other regions use the regional virtual-hosted endpoint.
    if ($AwsRegion -eq "us-east-1") {
        return "https://$Bucket.s3.amazonaws.com"
    }
    return "https://$Bucket.s3.$AwsRegion.amazonaws.com"
}

if ([string]::IsNullOrWhiteSpace($LambdaExecutionRoleArn) -or [string]::IsNullOrWhiteSpace($StateMachineExecutionRoleArn)) {
    throw "Set LAMBDA_EXECUTION_ROLE_ARN and STATE_MACHINE_EXECUTION_ROLE_ARN before deploying."
}

Push-Location $repoRoot
try {
    $frontendArgs = @(
        "cloudformation", "deploy",
        "--template-file", "infra/frontend-template.yaml",
        "--stack-name", $FrontendStackName,
        "--region", $Region,
        "--parameter-overrides", "Environment=$Environment",
        "--no-fail-on-empty-changeset"
    )
    if (-not [string]::IsNullOrWhiteSpace($CloudFormationServiceRoleArn)) {
        $frontendArgs += @("--role-arn", $CloudFormationServiceRoleArn)
    }
    Invoke-Aws @frontendArgs

    $frontendBucket = Get-StackOutput $FrontendStackName "FrontendBucketName"
    $distributionId = Get-StackOutput $FrontendStackName "FrontendDistributionId"
    $frontendOrigin = Get-StackOutput $FrontendStackName "FrontendUrl"

    Write-Host "Frontend hosting stack ready at $frontendOrigin"

    & (Join-Path $PSScriptRoot "deploy.ps1") `
        -StackName $BackendStackName `
        -Region $Region `
        -Environment $Environment `
        -ModelId $ModelId `
        -HeavyModelId $HeavyModelId `
        -FrontendOrigin $frontendOrigin `
        -LambdaExecutionRoleArn $LambdaExecutionRoleArn `
        -StateMachineExecutionRoleArn $StateMachineExecutionRoleArn `
        -CloudFormationServiceRoleArn $CloudFormationServiceRoleArn

    $apiBaseUrl = Get-StackOutput $BackendStackName "ApiUrl"
    $userPoolId = Get-StackOutput $BackendStackName "UserPoolId"
    $clientId = Get-StackOutput $BackendStackName "UserPoolClientId"
    $authority = Get-StackOutput $BackendStackName "CognitoAuthority"
    $cognitoDomain = Get-StackOutput $BackendStackName "CognitoHostedUi"
    $dataBucket = Get-StackOutput $BackendStackName "DataBucketName"
    $s3PresignedOrigin = Get-S3PresignedOrigin $dataBucket $Region

    $productionEnv = @(
        "VITE_API_BASE_URL=$apiBaseUrl",
        "VITE_AUTH_MODE=cognito",
        "VITE_S3_UPLOAD_ORIGINS=$s3PresignedOrigin",
        "VITE_S3_DOWNLOAD_ORIGINS=$s3PresignedOrigin",
        "VITE_COGNITO_AUTHORITY=$authority",
        "VITE_COGNITO_DOMAIN=$cognitoDomain",
        "VITE_COGNITO_CLIENT_ID=$clientId",
        "VITE_COGNITO_APP_CLIENT_ID=$clientId",
        "VITE_COGNITO_REDIRECT_URI=$frontendOrigin/auth/callback",
        "VITE_COGNITO_LOGOUT_URI=$frontendOrigin/login",
        "VITE_COGNITO_SCOPES=openid profile email",
        "VITE_COGNITO_API_TOKEN_TYPE=access"
    )
    $envPath = Join-Path $frontendDir ".env.production.local"
    Set-Content -LiteralPath $envPath -Value $productionEnv -Encoding utf8

    Push-Location $frontendDir
    try {
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    Invoke-Aws s3 sync (Join-Path $frontendDir "dist") "s3://$frontendBucket" --delete --region $Region
    Invoke-Aws cloudfront create-invalidation --distribution-id $distributionId --paths "/*"

    Write-Host "Frontend deployed successfully: $frontendOrigin" -ForegroundColor Green
    Write-Host "Frontend bucket: $frontendBucket"
    Write-Host "CloudFront distribution: $distributionId"
} finally {
    Pop-Location
}
