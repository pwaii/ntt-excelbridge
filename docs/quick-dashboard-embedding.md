# QuickSight registered Reader embedding

The `/analytics/quick` page includes both the registered-user QuickSight
dashboard and an owner-scoped Excel data explorer. The embedded dashboard is
opened on demand, and the page reads original workbook rows through the
authenticated backend. The browser never receives AWS credentials.

The endpoint `/v1/analytics/quick/embed-url` maps a verified Cognito subject to
a deterministic QuickSight IAM-federated Reader and reuses that Reader across
sign-ins. The user opens the dashboard explicitly, which fetches a one-time
embed URL from the backend and loads it with the Amazon QuickSight Embedding
SDK. Any Readers already provisioned remain QuickSight users until explicitly
removed and may continue to incur account charges under the active billing
terms.

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
3. Quality dataset `qa-issues-s3-76bde119`, inspection dataset
   `qa-inspections-s3-76bde119`, and workbook dataset
   `excelbridge-workbook-rows` all use this permissions dataset with
   `GRANT_ACCESS`, `VERSION_2` user-based RLS. Each retains the `owner_id`
   column. The API verifies RLS on all three dashboard datasets before it
   issues an embed URL.
4. All four datasets, including owner permissions, have hourly full-refresh
   schedules. New pipeline data should appear after the next successful
   refresh. Current refresh schedules and recent ingestion statuses were
   checked in QuickSight.
5. Lambda role `xlsx-workflow-demo-lambda` has registered-Reader permissions
   scoped to all three dashboard datasets, the dashboard, and the Reader group.
   Its trust policy allows Lambda and self-assumption with `web-*` session
   names.
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
QUICKSIGHT_WORKBOOK_ROWS_DATASET_ID=excelbridge-workbook-rows
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

## Excel data explorer behavior

The `/analytics/quick` page lists only completed input workbooks owned by the
authenticated account. It reads the original cell values, profiles columns by
their observed cell types, and suggests an axis pair using header meaning and
value shapes. The user can choose any two fields from the current worksheet.
Every plotted mark represents one source row; repeated values are kept as
separate points. Hovering a point shows that row's other values. Job IDs,
ownership IDs, and inspection data types are not chart dimensions.

The page reads the uploaded workbook from private S3 through the backend. API
requests verify the source belongs to the signed-in owner before returning any
row values. Rows are paged in batches so large worksheets do not require one
unbounded response.

The embedded dashboard uses the same Cognito owner and QuickSight user-based
RLS permissions. It includes quality, inspection, and original workbook row
datasets. The viewer's first dashboard open provisions that website account's
QuickSight Reader; later website logins reuse it.

## Registered Reader smoke test

1. Sign in on the deployed website and open **Excel analytics**.
2. Choose **Open dashboard**. The backend validates owner RLS on every
   dashboard dataset, then provisions or reuses the signed-in account's Reader
   and returns a short-lived embed URL.
3. Confirm the published QuickSight dashboard loads inside the page and shows
   only that website owner's rows.
4. Test a second website account and confirm it sees only rows for its own
   Cognito subject. This provisions another Reader and may incur another user
   charge.
5. If a user sees an empty embedded dashboard, inspect the permissions CSV and
   the permission dataset's latest ingestion status.

The AWS Reader group, datasets, RLS attachments, hourly schedules, and IAM
permissions are configured. Setup did not provision customer Readers. The API
Lambda and CloudFront frontend must be updated with the application changes
before the hosted site can use this setup. Deploy only the existing function
and static frontend assets; do not redeploy the whole SAM stack because the
QuickSight refresh Lambda is managed separately from that stack.

AWS references: [registered-user embedding](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GenerateEmbedUrlForRegisteredUser.html), [RegisterUser](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_RegisterUser.html), [user-based RLS](https://docs.aws.amazon.com/quick/latest/userguide/restrict-access-to-a-data-set-using-row-level-security.html), and [SPICE refresh scheduling](https://docs.aws.amazon.com/quick/latest/userguide/refreshing-imported-data.html).
