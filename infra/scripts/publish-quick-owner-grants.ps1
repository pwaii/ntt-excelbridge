param(
    [string]$Profile = "finpilot",
    [string]$AccountId = "453995432289",
    [string]$Region = "ap-southeast-1",
    [string]$TableName = "xlsx-workflow-demo",
    [string]$RoleName = "xlsx-workflow-demo-lambda",
    [string]$Bucket = "xlsx-workflow-demo-453995432289"
)

$ErrorActionPreference = "Stop"

# The application subject is stored as owner_id in the metadata table. Match
# the API's stable role/session naming exactly, but never print subject values.
$ownerText = aws dynamodb scan `
    --table-name $TableName `
    --projection-expression owner_id `
    --query 'Items[].owner_id.S' `
    --output text `
    --region us-east-1 `
    --profile $Profile
if ($LASTEXITCODE -ne 0) { throw "DynamoDB owner lookup failed" }

$ownerIds = @($ownerText -split '\s+' | Where-Object { $_ -and $_ -ne "None" } | Sort-Object -Unique)
$rows = [System.Collections.Generic.List[string]]::new()
$rows.Add("UserARN,owner_id")
$sha = [System.Security.Cryptography.SHA256]::Create()
foreach ($ownerId in $ownerIds) {
    $digest = [Convert]::ToHexString(
        $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ownerId))
    ).ToLowerInvariant().Substring(0, 48)
    $sessionName = "web-$digest"
    $userArn = "arn:aws:quicksight:$Region`:$AccountId`:user/default/$RoleName/$sessionName"
    $safeOwnerId = $ownerId.Replace('"', '""')
    $rows.Add('"' + $userArn + '","' + $safeOwnerId + '"')
}

$outputPath = Join-Path $PSScriptRoot "..\policies\owner-permissions.csv"
try {
    [IO.File]::WriteAllText($outputPath, ($rows -join "`n"), [Text.UTF8Encoding]::new($false))
    aws s3 cp $outputPath "s3://$Bucket/quicksight/owner-permissions.csv" `
        --content-type "text/csv" --region us-east-1 --profile $Profile
    if ($LASTEXITCODE -ne 0) { throw "Owner permissions CSV upload failed" }
    Write-Output "Published owner grants for $($ownerIds.Count) distinct app users."
} finally {
    if (Test-Path -LiteralPath $outputPath) {
        Remove-Item -LiteralPath $outputPath
    }
}
