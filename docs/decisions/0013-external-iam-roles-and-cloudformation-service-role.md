# Decision 0013: External IAM roles and a CloudFormation service role

Date: 2026-10-18

## Decision

The SAM template no longer creates or synthesizes IAM roles and policies. It
accepts these externally managed role ARNs:

- `LambdaExecutionRoleArn` for the API and worker Lambda functions;
- `StateMachineExecutionRoleArn` for Step Functions;
- a deployment-only `CloudFormationServiceRoleArn`, passed to SAM as
  `--role-arn` rather than stored as a stack resource.

The deployment script no longer passes `CAPABILITY_IAM`.

## Why

The existing deployment failed when SAM/CloudFormation attempted to inspect and
generate function execution policies while the current SSO role lacked
`iam:GetRolePolicy`. Moving role ownership outside this stack removes that
template-time IAM generation path and lets an administrator manage the roles in
the account's approved IAM process.

## Important boundary

IAM cannot be removed from the running architecture entirely. Lambda and Step
Functions still require trusted execution roles, and CloudFormation still
requires a service role to act on the account's resources. This change removes
IAM resource creation from this repository; it does not remove the AWS IAM
authorization model.

The caller must be allowed to pass the CloudFormation service role. That service
role must be allowed to pass the Lambda and Step Functions execution roles.
Without those pre-existing roles and pass-role permissions, deployment cannot
start, regardless of the template.

## Tradeoff

One shared Lambda execution role is used to keep the deployment interface
small and avoid generating multiple roles. It must contain the union of the
API, S3/DynamoDB worker, Step Functions control, logging, and Bedrock
permissions. If stricter least privilege is required, split the parameter into
separate API, storage-worker, metadata-worker, and Bedrock role ARNs in a later
change.

## Verification

The source template must contain no `Policies:` blocks and no
`AWS::IAM::*` resources. SAM validation/build should succeed when valid role
ARN parameters are supplied. AWS deployment still depends on the administrator
provisioning the roles and granting `iam:PassRole` to the deployment caller.
