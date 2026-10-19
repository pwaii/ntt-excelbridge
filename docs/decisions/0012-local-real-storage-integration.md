# Decision 0012: Isolated real AWS storage for local integration

Date: 2026-10-18

## Decision

Use dedicated, uniquely named AWS resources for local real-storage integration tests in `us-east-1`:

- S3 bucket: `ntt-excelbridge-local-453995432289`
- DynamoDB table: `xlsx-workflow-local-453995432289`

The repository's local `.env` points `APP_DATA_BUCKET` and `DYNAMO_TABLE` at these resources. The local AWS profile remains `finpilot`.

## Why

The intended CloudFormation stack resources use names derived from the deployment environment, such as `xlsx-workflow-demo`. That stack previously entered `ROLLBACK_COMPLETE` because the current SSO role cannot perform the IAM operations required by the SAM/CloudFormation role-generation path. Creating local resources with the same names would blur the boundary between a manually provisioned test environment and a future CloudFormation-managed environment.

The application storage adapters already use real boto3 S3 and DynamoDB clients. Therefore no adapter replacement or fake storage layer is needed for this integration step.

## Resource safeguards

The local S3 bucket has:

- all S3 public-access-block settings enabled;
- default AES-256 server-side encryption;
- versioning enabled;
- CORS for the local Vite origins;
- a 14-day lifecycle rule for `jobs/` objects.

The local DynamoDB table has:

- on-demand billing;
- the `GSI1` and `GSI2` indexes required by `DynamoStore`;
- server-side encryption;
- point-in-time recovery enabled;
- TTL enabled for `expires_at`.

## Verification

A real boto3 smoke test uploaded and downloaded an S3 object, created and read a DynamoDB job record, and deleted only its temporary probe data. The test passed on 2026-10-18.

## Scope boundary

This connects and verifies S3/DynamoDB locally. It does not mean the Step Functions state machine, Lambda deployment, Cognito, or Bedrock workflow is deployed. Those remain dependent on a successful CloudFormation/SAM deployment and the required AWS account permissions.

## Cleanup

These resources are not deleted automatically. When no longer needed, delete all bucket object versions before deleting the bucket, then delete the DynamoDB table. Confirm the exact names first; do not delete the future CloudFormation-managed resources by name.
