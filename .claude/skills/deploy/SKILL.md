---
name: deploy
description: Use when deploying the ntt-excelbridge project frontend or backend to AWS. Covers the correct command sequence, required env vars, and known failure modes to avoid.
---

# Deploy

## Required env vars

```powershell
$env:AWS_PROFILE                    = "ChallengerAccess-453995432289"
$env:AWS_REGION                     = "us-east-1"
$env:LAMBDA_EXECUTION_ROLE_ARN      = "arn:aws:iam::453995432289:role/xlsx-lambda-exec"
$env:STATE_MACHINE_EXECUTION_ROLE_ARN = "arn:aws:iam::453995432289:role/xlsx-sfn-exec"
$env:CLOUDFORMATION_SERVICE_ROLE_ARN = ""   # must be EMPTY — see pitfall #1
```

## Before every deploy — check SSO

Always run this first. The SSO portal lives in `ap-southeast-1` while resources are in `us-east-1`; a stale token makes `sam deploy` fail mid-run (pitfall #4) even though the build succeeds.

```powershell
$env:AWS_PROFILE = "ChallengerAccess-453995432289"; $env:AWS_REGION = "us-east-1"
aws sts get-caller-identity --output text   # must print account 453995432289
```

If it errors (expired/`SSOTokenLoadError`/connect failure), have the user refresh — it opens a browser, so it can't run headless:

```
! aws sso login --profile ChallengerAccess-453995432289
```

## Full redeploy (back + front)

```powershell
powershell -File infra/scripts/deploy-frontend.ps1
```

If `npm ci` fails (see pitfall #2), finish manually:

```powershell
cd frontend; npm install; npm run build
aws s3 sync frontend/dist s3://xlsx-workflow-frontend-demo-453995432289 --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id E63X0CVGHH8VU --paths "/*"
```

## Backend only

```powershell
powershell -File infra/scripts/deploy.ps1
```

`deploy.ps1` defaults `FrontendOrigin` to the CloudFront origin (`https://d35kjusenp6a9t.cloudfront.net`). Only override `$env:FRONTEND_ORIGIN` if that distribution ever changes — never set it to `http://localhost:5173` (pitfall #6).

## Known pitfalls

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | `xlsx-cfn-deploy is not authorized to perform: cloudformation:CreateChangeSet on …Serverless-2016-10-31` | `xlsx-cfn-deploy` role lacks SAM transform permission | Set `CLOUDFORMATION_SERVICE_ROLE_ARN = ""` — the script skips `--role-arn` when empty |
| 2 | `EPERM: operation not permitted, unlink lightningcss-win32-x64-msvc.node` | `npm ci` wipes node_modules atomically; antivirus/Windows holds the native binary | Use `npm install` instead of `npm ci` |
| 3 | `'pwsh' is not recognized` | PowerShell 7 not installed | Use `powershell` (Windows PowerShell 5.1 ships with Windows) |
| 4 | `Could not connect to the endpoint URL: "https://oidc.ap-southeast-1.amazonaws.com/token"` after `Build Succeeded` | SSO token expired; `sam deploy` tries to refresh it against the SSO region | Refresh SSO (see "Before every deploy"), then rerun — the build is cached so it jumps straight to deploy. Often transient; a plain retry can also work |
| 5 | `The argument 'infra/scripts/deploy.ps1' ... does not exist` | Relative path run from a stale cwd (e.g. after `cd backend`) | Use the absolute path `D:\cu\hackathon\ntt-excelbridge\infra\scripts\deploy.ps1` |
| 6 | Stack rolls back: `HttpApi ... "Duplicated values are not allowed in allow-origins"` | Backend-only `deploy.ps1` with no `FRONTEND_ORIGIN` set used to default to `http://localhost:5173`, which the template already hard-codes in `AllowOrigins` → duplicate. Fixed: `deploy.ps1` now defaults to the CloudFront origin. If it recurs, set `$env:FRONTEND_ORIGIN = "https://d35kjusenp6a9t.cloudfront.net"` before deploying | 

## Stack outputs (for reference)

- Frontend URL: `https://d35kjusenp6a9t.cloudfront.net`
- CloudFront distribution: `E63X0CVGHH8VU`
- Frontend S3 bucket: `xlsx-workflow-frontend-demo-453995432289`
- API URL: `https://3lqjzo0ndc.execute-api.us-east-1.amazonaws.com/demo`
