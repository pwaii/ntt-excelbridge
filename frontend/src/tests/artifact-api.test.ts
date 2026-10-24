import { expect, it, vi } from "vitest";
import { createApiClient } from "@/api/http-client";
import { createJobsApi } from "@/api/jobs-api";

const origin = "https://synthetic-bucket.s3.us-east-1.amazonaws.com";
const signed = { artifact_type: "output", key: "jobs/synthetic/output.xlsx", url: `${origin}/output.xlsx?signature=synthetic`, expires_in: 60, request_id: "synthetic-request" };
function setup(payload: unknown = signed, status = 200) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status }));
  const api = createJobsApi(createApiClient({ baseUrl: "https://api.example.invalid", getValidToken: async () => "synthetic-token", fetcher }), [], [origin]);
  return { api, fetcher };
}
it("gets a fresh artifact link through authenticated JSON, with conservative expiry", async () => {
  const { api, fetcher } = setup(); const start = Date.now();
  const result = await api.getArtifact("synthetic", "output");
  expect(result.expiresAt).toBeGreaterThanOrEqual(start + 60_000);
  expect(fetcher.mock.calls[0][0]).toBe("https://api.example.invalid/v1/jobs/synthetic/artifacts/output");
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer synthetic-token" });
});
it.each(["audit", "review_summary", "validation", "quality", "inspection"] as const)("accepts the us-east-1 global S3 hostname for the %s report", async (type) => {
  const global = { ...signed, artifact_type: type, url: `https://synthetic-bucket.s3.amazonaws.com/${type}.json?signature=synthetic` };
  const { api } = setup(global);
  await expect(api.getArtifact("synthetic", type)).resolves.toMatchObject({ artifact_type: type, url: global.url });
});
it.each(["http://synthetic-bucket.s3.us-east-1.amazonaws.com/f", "https://untrusted.example.invalid/f", "https://user:pass@synthetic-bucket.s3.us-east-1.amazonaws.com/f", `${origin}/f#fragment`, "javascript:alert(1)"])("rejects untrusted download URL %s", async (url) => {
  await expect(setup({ ...signed, url }).api.getArtifact("synthetic", "output")).rejects.toMatchObject({ kind: "protocol" });
});
it.each([{ artifact_type: "quality" }, { expires_in: 0 }, { expires_in: -10 }, { key: "" }])("rejects malformed signed response %o", async (change) => {
  await expect(setup({ ...signed, ...change }).api.getArtifact("synthetic", "output")).rejects.toMatchObject({ kind: "protocol" });
});
it.each([401, 403, 404, 503])("surfaces download HTTP %s without retry", async (status) => {
  const { api, fetcher } = setup({ detail: "synthetic error", request_id: "synthetic-request" }, status);
  await expect(api.getArtifact("synthetic", "output")).rejects.toMatchObject({ status }); expect(fetcher).toHaveBeenCalledOnce();
});
