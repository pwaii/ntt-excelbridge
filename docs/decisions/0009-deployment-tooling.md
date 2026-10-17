# Decision 0009: Keep SAM deployment host-based and predictable

Date: 2026-10-18

## Decision

`infra/scripts/deploy.ps1` uses the repository's `.venv312\Scripts` directory
when present and discovers SAM from `PATH` or the standard Windows installer
location. SAM installs only `backend/requirements.txt` into the Lambda build
artifact; developers do not need the full development extra for deployment.

Deployment values are explicit script parameters or PowerShell environment
variables. The script does not implicitly parse `.env` because PowerShell does
not load dotenv files automatically.

## Consequence

The normal deployment path does not require Docker or a globally activated
Python environment. The machine still needs SAM CLI, Python 3.12, network
access for production dependency resolution, and valid AWS credentials.
