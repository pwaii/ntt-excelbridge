# QuickSight registered Reader embedding

The app page is `/analytics/quick`. The browser never receives AWS credentials.
The authenticated backend maps a verified Cognito subject to a deterministic
QuickSight IAM-federated Reader, ensures that Reader exists, and requests a
short-lived registered-user embed URL. Repeat sign-ins reuse that Reader.

## Billing model

This uses Reader per-user pricing. The AWS account owner pays; website customers
do not need QuickSight subscriptions. Billing is per provisioned QuickSight
user, not per website login or embed URL. Opening the dashboard for the first
time provisions that account's Reader and can start its recurring charge.
Removing a user does not retroactively remove charges already incurred in a
billing period. Reader pricing is for registered, manually used dashboards;
anonymous public embedding requires Capacity pricing. AWS currently lists
Reader at $3/user/month. Review [current pricing](https://aws.amazon.com/quick/quicksight/pricing/)
before provisioning real customers.

The pipeline uses SPICE with scheduled refreshes. Capacity pricing is required
for programmatic near-real-time refreshes; the app defaults to
`QUICKSIGHT_REFRESH_MODE=scheduled`. `api` mode should be used only when the
account has Capacity pricing.

## Current AWS configuration

The account was checked in `453995432289`, region `ap-southeast-1`. QuickSight
reports Enterprise edition, `AuthenticationType=IDENTITY_POOL`, and
`AccountSubscriptionStatus=ACCOUNT_CREATED`. This is not IAM Identity Center
authentication; the integration uses role-backed IAM Readers. No account-wide
identity mode change was made. The registered-user embed API still needs an
app-level smoke test.

The AWS resources are configured as follows:

1. Group `website-readers` has dashboard access to the published dashboard
   `excelbridge-quality-dashboard`.
2. S3 source `excelbridge-owner-permissions-source` and SPICE dataset
   `excelbridge-owner-permissions` exist. The dataset is marked `RLS_RULES` and
   contains grants for the nine distinct app owners currently in the metadata
   table. Use `infra/scripts/publish-quick-owner-grants.ps1` to republish those
   grants without printing app subjects.
3. Quality dataset `qa-issues-s3-76bde119` and inspection dataset
   `qa-inspections-s3-76bde119` both use this permissions dataset with
   `GRANT_ACCESS`, `VERSION_2` user-based RLS. Their old tag-based rules were
   removed; both retain the `owner_id` column.
4. All three datasets have full-refresh schedules every hour. New pipeline data
   should appear within about an hour. QuickSight currently has 156 quality
   rows, 443 inspection rows, and 9 owner permission rows ingested.
5. Lambda role `xlsx-workflow-demo-lambda` has registered-Reader permissions
   scoped to these datasets, the dashboard, and the Reader group. Its trust
   policy allows Lambda and self-assumption with `web-*` session names. IAM
   Access Analyzer returned no findings for the applied identity policy.
6. The S3 manifest uses the bucket's actual `us-east-1` endpoint; the
   QuickSight data source and datasets are in `ap-southeast-1`.

The refresh pipeline writes `quicksight/owner-permissions.csv` with one row per
distinct app owner found in report artifacts. QuickSight's hourly schedules
refresh the SPICE datasets. An owner without report artifacts has no RLS grant
and sees no rows. RLS grants use the Cognito subject resolved by the backend,
never a browser-supplied owner ID. The embed endpoint fails closed unless both
report datasets point to the configured permissions dataset.

## Configuration values

These values are set as defaults in the SAM deployment script and
`.env.example` for this account:

```text
QUICKSIGHT_ACCOUNT_ID=453995432289
QUICKSIGHT_REGION=ap-southeast-1
QUICKSIGHT_QUALITY_DATASET_ID=qa-issues-s3-76bde119
QUICKSIGHT_INSPECTION_DATASET_ID=qa-inspections-s3-76bde119
QUICKSIGHT_PERMISSIONS_DATASET_ID=excelbridge-owner-permissions
QUICKSIGHT_RLS_PERMISSIONS_DATASET_ARN=arn:aws:quicksight:ap-southeast-1:453995432289:dataset/excelbridge-owner-permissions
QUICKSIGHT_READER_GROUP_NAME=website-readers
QUICKSIGHT_REFRESH_MODE=scheduled
QUICKSIGHT_DASHBOARD_ID=excelbridge-quality-dashboard
```

`QUICKSIGHT_EMBEDDING_ROLE_ARN` defaults to the Lambda execution role. The
permissions CSV schema is exactly `UserARN,owner_id`. Its S3 source uses
`scripts/qs-permissions-manifest.json` and points to
`quicksight/owner-permissions.csv`.

## Smoke test

1. Deploy the updated backend and open `/analytics/quick` while signed in to
   the website. The first open creates one Reader and can start monthly billing;
   later opens reuse that same username.
2. Confirm the signed-in owner's dashboard rows load.
3. Test a second website account and confirm it sees only rows for its own
   Cognito subject. This provisions another Reader and may incur another user
   charge.
4. If a user sees an empty dashboard, inspect the permissions CSV and the
   permission dataset's latest ingestion status.

The AWS Reader group, datasets, RLS attachments, hourly schedules, and IAM
permissions are configured. Setup did not provision customer Readers. The
updated application code and its QuickSight environment parameters are still
local; the CloudFormation stack must be updated before the hosted site's
backend can use this setup.

AWS references: [registered-user embedding](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GenerateEmbedUrlForRegisteredUser.html), [RegisterUser](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_RegisterUser.html), [user-based RLS](https://docs.aws.amazon.com/quick/latest/userguide/restrict-access-to-a-data-set-using-row-level-security.html), and [SPICE refresh scheduling](https://docs.aws.amazon.com/quick/latest/userguide/refreshing-imported-data.html).
