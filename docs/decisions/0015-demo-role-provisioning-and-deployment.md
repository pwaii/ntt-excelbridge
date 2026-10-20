# Decision 0015: Demo role provisioning and deployment path

Date: 2026-10-20

## Decision

The deployed `xlsx-workflow-demo` stack uses two externally managed roles in
account `453995432289`:

- `xlsx-workflow-demo-lambda` for the API and worker Lambda functions;
- `xlsx-workflow-demo-stepfunctions` for the Standard Step Functions state
  machine.

The CloudFormation service-role parameter remains supported but is optional.
This deployment uses the authenticated `finpilot` caller credentials for
CloudFormation because that identity already has the required resource
permissions and narrowly scoped `iam:PassRole` permissions for the two
execution roles. An unused empty CloudFormation role created during setup was
removed.

The data bucket has an explicit account-scoped name,
`xlsx-workflow-demo-453995432289`, so the Lambda role can use an exact S3
resource ARN rather than a bucket wildcard.

## Why

Creating a persistent CloudFormation role with account-wide API Gateway and
Cognito resource control would add a broader security boundary than this demo
needs. Using the already authenticated deployment identity avoids that role
while preserving the application's required Lambda and Step Functions trust
relationships.

## Verification

The deployment completed with stack status `CREATE_COMPLETE`. The deployed
resources are active: the S3 bucket is reachable, the DynamoDB table is
`ACTIVE`, the state machine is `ACTIVE`, all eight Lambda functions exist, and
the unauthenticated API correctly returns `401`.
