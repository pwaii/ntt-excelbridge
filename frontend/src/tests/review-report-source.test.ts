import { expect, it, vi } from "vitest";
import { createApiClient } from "@/api/http-client";
import { createJobsApi } from "@/api/jobs-api";
import { createBackendQualityAdapter, createQualityReportSource } from "@/quality/backend-adapter";
import base from "./fixtures/backend/current-get.json";
import { qualityItem, qualitySnapshot } from "./quality-fixtures";

function page(items = [qualityItem()], extra: Record<string, unknown> = {}) {
  return { ...qualitySnapshot(), requestId: "synthetic-request", stage: "quality", items, total: items.length, ...extra };
}
function setup(...pages: unknown[]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const payload of pages) fetcher.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
  const api = createJobsApi(createApiClient({ baseUrl: "https://api.example.invalid", getValidToken: async () => "synthetic-token", fetcher }), []);
  const job = { ...base.job, revision: 7, status: "QUALITY_REVIEW_PENDING" as const, config: { ...base.job.config, conflict_policy: "reject_all" as const } };
  return { fetcher, api, job, source: createQualityReportSource(api, "quality") };
}
it("loads all backend pages at one job revision before declaring review coverage complete", async () => {
  const { source, job, fetcher } = setup(page([qualityItem()], { total: 2, nextCursor: 1, complete: false }), page([qualityItem({ id: "second", status: "human_ignored", requiresDecision: false })], { total: 2 }));
  const result = await source.load(job, new AbortController().signal);
  expect(result.complete).toBe(true); expect(result.items).toHaveLength(2); expect(result.items[1].status).toBe("human_ignored");
  expect(fetcher.mock.calls[1][0]).toContain("expected_revision=7"); expect(fetcher.mock.calls[1][0]).toContain("cursor=1");
});
it.each([
  { jobId: "different-job" }, { revision: 8 }, { stage: "transformation" },
  { status: "APPLYING" }, { total: 2 }, { complete: false },
  { total: 2, complete: false, nextCursor: 0 },
])("rejects mismatched or incomplete report metadata %o", async (extra) => {
  const { source, job } = setup(page(undefined, extra));
  await expect(source.load(job, new AbortController().signal)).rejects.toMatchObject({ kind: "protocol" });
});
it("rejects duplicate IDs across report pages", async () => {
  const { source, job } = setup(page(undefined, { total: 2, nextCursor: 1, complete: false }), page(undefined, { total: 2 }));
  await expect(source.load(job, new AbortController().signal)).rejects.toThrow();
});
it("never substitutes findings when the real report endpoint fails", async () => {
  const { source, job, fetcher } = setup();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "not ready" }), { status: 409 }));
  await expect(source.load(job, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("uses the real report source through the production adapter", async () => {
  const { api, job, fetcher } = setup();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...base, job }))).mockResolvedValueOnce(new Response(JSON.stringify(page())));
  const adapter = createBackendQualityAdapter(api, createQualityReportSource(api, "quality"));
  expect((await adapter.load(job.job_id, new AbortController().signal)).items[0].id).toBe("issue-1");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
