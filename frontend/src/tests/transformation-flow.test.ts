import { expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { bulkCandidates, createQualityReviewFlow, decisionError, submissionBlocker } from "@/quality/controller";
import { matchTypes } from "@/quality/types";
import { qualityItem, qualityJobId, qualityReceipt, qualitySnapshot } from "./quality-fixtures";

const formula = () => qualityItem({ kind: "formula", formula: { text: "=B2*C2", syntax: "verified", referencedColumns: ["B", "C"] } });
async function setup(items = [formula()], status = "TRANSFORMATION_REVIEW_PENDING", complete = true) {
  const submit = vi.fn().mockResolvedValue(qualityReceipt());
  const flow = createQualityReviewFlow(qualityJobId, { load: async () => qualitySnapshot({ items, status, complete }), submit }, "transformation");
  await flow.load();
  return { flow, submit };
}
it.each(["invalid", "unverified", "missing"] as const)("blocks acceptance of %s formula syntax", async (syntax) => {
  const item = formula(); item.formula = syntax === "missing" ? undefined : { ...item.formula!, syntax };
  const { flow, submit } = await setup([item]);
  flow.decide(item.id, { decision: "accept" }); await flow.submit();
  expect(submit).not.toHaveBeenCalled(); expect(submissionBlocker(flow.getSnapshot())).toContain("invalid");
  flow.decide(item.id, { decision: "reject" }); await flow.submit(); expect(submit).toHaveBeenCalledOnce();
});
it("blocks formula edits until backend revalidation, even for a previously verified formula", () => {
  expect(decisionError({ decision: "edit", edited_value: "=wrong" }, formula())).toContain("backend revalidation");
});
it.each(["TRANSFORMATION_REVIEW_PENDING"])("submits verified decisions once at %s using the loaded revision", async (status) => {
  const { flow, submit } = await setup(undefined, status);
  flow.decide("issue-1", { decision: "accept" }); await flow.submit(); await flow.submit();
  expect(submit).toHaveBeenCalledOnce(); expect(submit.mock.calls[0].slice(0, 3)).toEqual([qualityJobId, 7, { "issue-1": { decision: "accept" } }]);
});
it.each(["FORMULA_REVIEW_PENDING", "QUALITY_REVIEW_PENDING", "STANDARDIZATION_PENDING", "COMPLETED"])("blocks transformation submissions at %s", async (status) => {
  const { flow, submit } = await setup(undefined, status);
  flow.decide("issue-1", { decision: "accept" }); await flow.submit(); expect(submit).not.toHaveBeenCalled();
});
it("bulk selection includes exact and normalized matches but excludes ambiguous evidence and existing drafts", async () => {
  const items = matchTypes.map((type) => qualityItem({ id: type, kind: "update-match", confidence: 0.999, match: { type, sourceKey: "key", targetKeys: type === "unmatched" ? [] : ["target"] } }));
  const { flow } = await setup(items);
  expect(bulkCandidates(flow.getSnapshot(), 0.95, matchTypes).map((item) => item.id)).toEqual(["exact", "normalized"]);
  flow.decide("exact", { decision: "reject" });
  expect(bulkCandidates(flow.getSnapshot(), 0.95, matchTypes).map((item) => item.id)).toEqual(["normalized"]);
  expect(bulkCandidates(flow.getSnapshot(), 0.95, ["conflict"])).toEqual([]);
});
it("blocks unmatched acceptance and accepts individual rejection of ambiguous groups", async () => {
  const { flow, submit } = await setup([qualityItem({ kind: "update-match", match: { type: "unmatched", sourceKey: "A", targetKeys: [] } })]);
  flow.decide("issue-1", { decision: "accept" }); await flow.submit(); expect(submit).not.toHaveBeenCalled();
  flow.decide("issue-1", { decision: "ignore", reason: "No target; skip row" }); await flow.submit(); expect(submit).toHaveBeenCalledOnce();
});
it("bulk does not approve unknown confidence, unverified formulas, hidden or partial reports", async () => {
  const items = [qualityItem({ id: "mapping", kind: "standardization", confidence: undefined }), formula()];
  const { flow } = await setup(items);
  expect(bulkCandidates(flow.getSnapshot(), 0.95, items.map((item) => item.id))).toEqual([]);
  const partial = await setup([qualityItem({ kind: "standardization", confidence: 1 })], undefined, false);
  expect(bulkCandidates(partial.flow.getSnapshot(), 0.95, ["issue-1"])).toEqual([]);
});
it("requires reconciliation after a transformation conflict and preserves drafts", async () => {
  const { flow, submit } = await setup(); submit.mockRejectedValue(new ApiError("http", "Conflict", 409));
  flow.decide("issue-1", { decision: "accept" }); await flow.submit();
  expect(flow.getSnapshot()).toMatchObject({ reloadRequired: true, drafts: { "issue-1": { decision: "accept" } } });
  await flow.submit(); expect(submit).toHaveBeenCalledOnce();
});
it("rejects a quality report accidentally delivered to a transformation gate", async () => {
  const { flow } = await setup([qualityItem()]); expect(flow.getSnapshot().phase).toBe("error");
});
