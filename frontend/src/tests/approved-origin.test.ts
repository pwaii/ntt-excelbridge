import { describe, expect, it } from "vitest";
import { isApprovedS3Origin } from "@/uploads/approved-origin";

describe("approved S3 upload origins", () => {
  const regionalOrigin = "https://xlsx-workflow-demo-453995432289.s3.us-east-1.amazonaws.com";

  it("accepts a configured regional origin", () => {
    expect(isApprovedS3Origin(new URL(`${regionalOrigin}/jobs/test`), [regionalOrigin])).toBe(true);
  });

  it("accepts AWS's global hostname alias for the same configured bucket", () => {
    expect(isApprovedS3Origin(new URL("https://xlsx-workflow-demo-453995432289.s3.amazonaws.com/jobs/test"), [regionalOrigin])).toBe(true);
  });

  it("accepts the us-east-1 regional hostname when deployment config uses AWS's global endpoint", () => {
    expect(isApprovedS3Origin(new URL(regionalOrigin), ["https://xlsx-workflow-demo-453995432289.s3.amazonaws.com"])).toBe(true);
  });

  it("rejects a different bucket, region URL, or non-S3 host", () => {
    expect(isApprovedS3Origin(new URL("https://another-bucket.s3.amazonaws.com/jobs/test"), [regionalOrigin])).toBe(false);
    expect(isApprovedS3Origin(new URL("https://xlsx-workflow-demo-453995432289.s3.us-west-2.amazonaws.com/jobs/test"), [regionalOrigin])).toBe(false);
    expect(isApprovedS3Origin(new URL("https://xlsx-workflow-demo-453995432289.s3.amazonaws.com/jobs/test"), ["https://xlsx-workflow-demo-453995432289.s3.us-west-2.amazonaws.com"])).toBe(false);
    expect(isApprovedS3Origin(new URL("https://evil.example/jobs/test"), [regionalOrigin])).toBe(false);
  });
});
