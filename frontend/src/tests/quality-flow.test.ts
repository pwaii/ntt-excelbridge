import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { createQualityReviewFlow, decisionError, submissionBlocker } from "@/quality/controller";
import { createBackendQualityAdapter } from "@/quality/backend-adapter";
import { createJobsApi } from "@/api/jobs-api";
import { createApiClient } from "@/api/http-client";
import { qualityItem, qualityJobId, qualityReceipt, qualitySnapshot } from "./quality-fixtures";
import type { QualitySnapshot } from "@/quality/types";

function setup(snapshot = qualitySnapshot()) {
  const load = vi.fn().mockResolvedValue(snapshot);
  const submit = vi.fn().mockResolvedValue(qualityReceipt());
  return { load, submit, flow: createQualityReviewFlow(qualityJobId, { load, submit }) };
}
describe("quality review state with synthetic normalized models", () => {
  it("requires explicit decisions and uses the original backend revision", async () => {
    const { flow, submit } = setup(); await flow.load();
    await flow.submit(); expect(submit).not.toHaveBeenCalled();
    flow.decide("issue-1", { decision: "accept" });
    expect(submissionBlocker(flow.getSnapshot())).toBeUndefined();
    await flow.submit();
    expect(submit).toHaveBeenCalledWith(qualityJobId, 7, { "issue-1": { decision: "accept" } }, expect.any(AbortSignal));
    expect(flow.getSnapshot()).toMatchObject({ phase: "submitted", reviewId: "synthetic-review-1", reportedStatus: "QUALITY_REVIEW_PENDING" });
    await flow.submit(); expect(submit).toHaveBeenCalledTimes(1);
  });
  it("blocks partial reports even when every loaded item is decided", async () => {
    const { flow, submit } = setup(qualitySnapshot({ complete: false })); await flow.load();
    flow.decide("issue-1", { decision: "accept" }); await flow.submit();
    expect(submit).not.toHaveBeenCalled(); expect(submissionBlocker(flow.getSnapshot())).toContain("complete backend review");
  });
  it("treats opaque IDs safely even when they match object prototype properties", async () => {
    const { flow, submit } = setup(qualitySnapshot({ items: [qualityItem({ id: "constructor" }), qualityItem({ id: "__proto__" })] }));
    await flow.load(); await flow.submit(); expect(submit).not.toHaveBeenCalled();
    flow.decide("constructor", { decision: "accept" }); flow.decide("__proto__", { decision: "reject" });
    expect(Object.keys(flow.getSnapshot().drafts)).toEqual(["constructor", "__proto__"]);
    await flow.submit(); expect(submit).toHaveBeenCalledTimes(1);
  });
  it.each(["INSPECTING", "COMPLETED", "TRANSFORMATION_REVIEW_PENDING"])("never submits quality decisions at %s", async (status) => {
    const { flow, submit } = setup(qualitySnapshot({ status })); await flow.load();
    flow.decide("issue-1", { decision: "accept" }); await flow.submit(); expect(submit).not.toHaveBeenCalled();
  });
  it("requires an ignore reason but permits an intentionally empty edit", async () => {
    const { flow, submit } = setup(); await flow.load();
    flow.decide("issue-1", { decision: "ignore", reason: "  " }); await flow.submit(); expect(submit).not.toHaveBeenCalled();
    expect(decisionError({ decision: "edit" })).toContain("edited value");
    flow.decide("issue-1", { decision: "edit", edited_value: "" }); await flow.submit(); expect(submit).toHaveBeenCalledTimes(1);
  });
  it("does not create decisions for unknown IDs, already reviewed items or unavailable actions", async () => {
    const { flow } = setup(qualitySnapshot({ items: [qualityItem({ allowedDecisions: ["reject"] }), qualityItem({ id: "accepted", status: "human_accepted" })] }));
    await flow.load(); flow.decide("missing", { decision: "accept" }); flow.decide("accepted", { decision: "reject" }); flow.decide("issue-1", { decision: "accept" });
    expect(flow.getSnapshot().drafts).toEqual({});
  });
  it("guards duplicate submission and locks drafts during an outstanding request", async () => {
    const { flow, submit } = setup(); await flow.load(); flow.decide("issue-1", { decision: "accept" });
    let resolve!: (value: ReturnType<typeof qualityReceipt>) => void;
    submit.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = flow.submit(); flow.decide("issue-1", { decision: "reject" }); await flow.submit();
    expect(submit).toHaveBeenCalledTimes(1); expect(flow.getSnapshot().drafts["issue-1"].decision).toBe("accept");
    resolve(qualityReceipt()); await pending;
  });
  it.each([409, 500, 429])("requires reconciliation after HTTP %s and clears drafts on explicit reload", async (status) => {
    const { flow, submit, load } = setup(); await flow.load(); flow.decide("issue-1", { decision: "accept" });
    submit.mockRejectedValue(new ApiError("http", "Safe HTTP message", status)); await flow.submit(); await flow.submit();
    expect(flow.getSnapshot().reloadRequired).toBe(true); expect(submit).toHaveBeenCalledTimes(1);
    load.mockResolvedValue(qualitySnapshot({ revision: 9 })); await flow.load();
    expect(flow.getSnapshot().drafts).toEqual({}); expect(flow.getSnapshot().snapshot?.revision).toBe(9);
  });
  it.each([401, 403, 422])("preserves editable drafts after definitive HTTP %s rejection", async (status) => {
    const { flow, submit } = setup(); await flow.load(); flow.decide("issue-1", { decision: "reject" });
    submit.mockRejectedValue(new ApiError("http", "Safe rejection", status)); await flow.submit();
    expect(flow.getSnapshot()).toMatchObject({ phase: "ready", reloadRequired: false, drafts: { "issue-1": { decision: "reject" } } });
  });
  it("rejects wrong job identity, duplicate items and invalid confidence without exposing data", async () => {
    for (const snapshot of [qualitySnapshot({ jobId: "wrong" }), qualitySnapshot({ items: [qualityItem(), qualityItem()] }), qualitySnapshot({ items: [qualityItem({ confidence: 1.1 })] })]) {
      const { flow } = setup(snapshot); await flow.load(); expect(flow.getSnapshot().phase).toBe("error"); expect(flow.getSnapshot().snapshot).toBeUndefined();
    }
  });
  it("treats timeout and mismatched acknowledgement as unknown outcomes, not success", async () => {
    for (const failure of [new ApiError("timeout", "Request timed out"), undefined]) {
      const { flow, submit } = setup(); await flow.load(); flow.decide("issue-1", { decision: "accept" });
      if (failure) submit.mockRejectedValue(failure); else submit.mockResolvedValue(qualityReceipt(7));
      await flow.submit(); expect(flow.getSnapshot().reloadRequired).toBe(true); expect(flow.getSnapshot().phase).toBe("error");
    }
  });
  it("aborts disposal and ignores late load responses", async () => {
    const { flow, load } = setup(); let resolve!: (value: QualitySnapshot) => void;
    load.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = flow.load(); flow.dispose(); expect(load.mock.calls[0][1].aborted).toBe(true);
    resolve(qualitySnapshot()); await pending; expect(flow.getSnapshot().snapshot).toBeUndefined();
  });
});

describe("existing OpenAPI review endpoint boundary", () => {
  function apiSetup() {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(qualityReceipt())));
    const api = createJobsApi(createApiClient({ baseUrl: "https://api.example.invalid", getValidToken: async () => "unit-test-token", fetcher }), []);
    return { api, fetcher };
  }
  it("sends only generated-contract review fields and validates revision acknowledgement", async () => {
    const { api, fetcher } = apiSetup();
    await api.submitReview(qualityJobId, { expected_revision: 7, decisions: { "issue-1": { decision: "ignore", reason: "Intentional" } } });
    expect(fetcher).toHaveBeenCalledTimes(1); const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`https://api.example.invalid/v1/jobs/${qualityJobId}/reviews`);
    expect(JSON.parse(options!.body as string)).toEqual({ expected_revision: 7, decisions: { "issue-1": { decision: "ignore", reason: "Intentional" } } });
    expect(options?.method).toBe("POST");
  });
  it("does not invent report endpoints or allow submit when no report source exists", async () => {
    const { api, fetcher } = apiSetup(); const adapter = createBackendQualityAdapter(api); const signal = new AbortController().signal;
    await expect(adapter.load(qualityJobId, signal)).rejects.toThrow("has not published");
    await expect(adapter.submit(qualityJobId, 7, { a: { decision: "accept" } }, signal)).rejects.toThrow("required");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
  it("binds a future normalized report to the exact job revision and status", async () => {
    const { api } = apiSetup();
    const adapter = createBackendQualityAdapter(api, { load: async () => qualitySnapshot({ revision: 7 }) });
    await expect(adapter.load(qualityJobId, new AbortController().signal)).rejects.toThrow("does not match");
  });
  it("can consume a complete normalized source without incrementing the server revision locally", async () => {
    const { api, fetcher } = apiSetup();
    const source = { load: vi.fn().mockResolvedValue(qualitySnapshot({ revision: 8 })) };
    const adapter = createBackendQualityAdapter(api, source);
    const snapshot = await adapter.load(qualityJobId, new AbortController().signal);
    expect(snapshot.revision).toBe(8); expect(source.load).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response(JSON.stringify(qualityReceipt(9))));
    await adapter.submit(qualityJobId, snapshot.revision, { "issue-1": { decision: "accept" } }, new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).expected_revision).toBe(8);
  });
});
