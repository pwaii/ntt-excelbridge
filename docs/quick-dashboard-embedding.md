# Quick dashboard embedding

The web app exposes QuickSight at `/analytics/quick`. The browser never
receives AWS credentials. The authenticated backend verifies the Cognito token,
uses its subject as the `app_user_id` session tag, checks tag-based row security
on both configured datasets, and requests a short-lived embed URL for the
requesting site's exact origin.

## Deployed state (2026-10-23)

- Published dashboard: `excelbridge-quality-dashboard` in `ap-southeast-1`.
- It uses the S3-backed quality dataset `qa-issues-s3-76bde119`; its two visuals
  were copied from the existing analysis and remapped from the stale file-upload
  dataset. Inspection data is refreshed and secured, but is not yet visualized
  on this dashboard.
- Both quality and inspection datasets expose the string column `owner_id` and
  have tag-based row-level security enabled with tag key `app_user_id`, column
  `owner_id`, and no match-all value.
- The deployed refresh Lambda writes owner subjects from DynamoDB job metadata
  into both CSVs and has refreshed both SPICE datasets.
- The API Lambda role has a separate least-privilege policy allowing
  `quicksight:DescribeDataSet` on the two datasets and
  `quicksight:GenerateEmbedUrlForAnonymousUser` on this dashboard. Its existing
  DynamoDB `GetItem` permission supports the refresh Lambda's owner lookup.
- The backend stack is configured with this dashboard ID and the exact
  CloudFront origin. The `/analytics/quick` page is deployed to CloudFront.
- **Remaining account prerequisite:** QuickSight rejected URL generation with
  `UnsupportedPricingPlanException`. Anonymous embedding cannot open until the
  account has an active Capacity Pricing plan. The page reports this directly;
  the plan has not been enabled.

## Smoke test after enabling capacity pricing

1. Sign in to the deployed web app and open `/analytics/quick`.
2. Confirm the current user's quality rows render.
3. Sign in as a different Cognito user and confirm the first user's rows are
   hidden.
4. If an embed URL cannot be minted, inspect the API response code. The route
   fails closed if the dashboard, either dataset's RLS, or capacity pricing is
   unavailable; it never intentionally falls back to unfiltered data.

## Local smoke test

For local use, run the API with Cognito disabled and the documented loopback
development auth, then create jobs through that same local user. Configure the
Quick dashboard ID and include `http://localhost:5173` (or the exact local
origin in use) in backend `CORS_ORIGINS`. Local jobs are owned by `local-user`,
so they appear only after the refresh pipeline rebuilds the CSVs. Do not use
the local fallback as a production identity.

AWS references: [tag-based RLS for anonymous embedding](https://docs.aws.amazon.com/quick/latest/userguide/quicksight-dev-rls-tags.html), [anonymous dashboard embed URL API](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GenerateEmbedUrlForAnonymousUser.html), [IAM embedding permissions](https://docs.aws.amazon.com/quicksight/latest/userguide/embedded-analytics-dashboards-with-anonymous-users-get-step-1.html), and [QuickSight pricing](https://aws.amazon.com/quick/quicksight/pricing/).
