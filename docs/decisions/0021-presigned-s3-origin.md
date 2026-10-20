# Decision 0021: Match the frontend allowlist to boto3 S3 presigned origins

## Context

The frontend validates every presigned upload and download URL against an
exact origin allowlist. The deployment script configured the regional S3
origin for every region, but boto3 generates a legacy global virtual-hosted
origin for S3 in `us-east-1`:

`https://<bucket>.s3.amazonaws.com`

The deployed frontend therefore rejected valid backend URLs before attempting
the upload.

## Decision

Generate `VITE_S3_UPLOAD_ORIGINS` and `VITE_S3_DOWNLOAD_ORIGINS` from the
actual boto3 endpoint convention: use `https://<bucket>.s3.amazonaws.com` in
`us-east-1`, and `https://<bucket>.s3.<region>.amazonaws.com` elsewhere.

The frontend keeps exact-origin validation. We do not broaden it to arbitrary
S3 hosts or disable the check.

## Consequences

Future frontend deployments produce an allowlist that matches the URLs signed
by the backend. Existing deployments must be rebuilt and invalidated once
after this script change. S3 bucket CORS remains separate and continues to
allow the configured CloudFront frontend origin.
