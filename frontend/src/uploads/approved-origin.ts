/** Check a backend URL against configured S3 origins, including AWS's global
 * and regional virtual-hosted aliases for the same us-east-1 bucket. */
export function isApprovedS3Origin(destination: URL, configuredOrigins: readonly string[]): boolean {
  if (configuredOrigins.includes(destination.origin)) return true;

  return configuredOrigins.some((origin) => {
    let configured: URL;
    try { configured = new URL(origin); }
    catch { return false; }
    if (configured.protocol !== "https:" || configured.origin !== origin) return false;

    const regional = configured.hostname.match(/^(.+)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    const global = configured.hostname.match(/^(.+)\.s3\.amazonaws\.com$/);
    if (regional && regional[2] === "us-east-1") {
      return destination.protocol === "https:"
        && destination.hostname === `${regional[1]}.s3.amazonaws.com`
        && destination.port === "";
    }
    if (global) {
      return destination.protocol === "https:"
        && destination.hostname === `${global[1]}.s3.us-east-1.amazonaws.com`
        && destination.port === "";
    }
    return false;
  });
}
