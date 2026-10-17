[CmdletBinding()]
param(
    [string]$StackName = "xlsx-workflow-demo",
    [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }),
    [switch]$Confirm
)

$ErrorActionPreference = "Stop"
if (-not $Confirm) {
    throw "This removes the demo stack and data. Re-run with -Confirm after reviewing the stack and region."
}

Write-Host "Reading outputs for $StackName in $Region"
$outputs = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    --query "Stacks[0].Outputs" `
    --output json | ConvertFrom-Json

function Get-OutputValue([string]$key) {
    $entry = $outputs | Where-Object { $_.OutputKey -eq $key }
    if ($entry) { return $entry.OutputValue }
    return $null
}

$bucket = Get-OutputValue "DataBucketName"
$stateMachineArn = Get-OutputValue "StateMachineArn"

if ($stateMachineArn) {
    $executionArns = aws stepfunctions list-executions `
        --state-machine-arn $stateMachineArn `
        --region $Region `
        --status-filter RUNNING `
        --query "executions[].executionArn" `
        --output json | ConvertFrom-Json
    foreach ($executionArn in @($executionArns)) {
        Write-Host "Stopping $executionArn"
        aws stepfunctions stop-execution --execution-arn $executionArn --region $Region | Out-Null
    }
}

if ($bucket) {
    Write-Host "Deleting versioned S3 objects from $bucket"
    $versions = aws s3api list-object-versions --bucket $bucket --region $Region --output json | ConvertFrom-Json
    foreach ($object in @($versions.Versions)) {
        aws s3api delete-object --bucket $bucket --key $object.Key --version-id $object.VersionId --region $Region | Out-Null
    }
    foreach ($marker in @($versions.DeleteMarkers)) {
        aws s3api delete-object --bucket $bucket --key $marker.Key --version-id $marker.VersionId --region $Region | Out-Null
    }
}

Write-Host "Deleting CloudFormation stack $StackName"
aws cloudformation delete-stack --stack-name $StackName --region $Region
aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region
Write-Host "Demo stack and its managed resources were deleted."
