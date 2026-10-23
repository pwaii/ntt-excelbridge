import { expect, it } from "vitest";
import { jobStages } from "@/lib/job-stages";
import type { BackendJob } from "@/api/jobs-api";
import base from "./fixtures/backend/current-get.json";
const job = (patch: Partial<BackendJob>): BackendJob => ({ ...base.job, ...patch } as BackendJob);

it("shows earlier tasks complete at the quality gate and later tasks pending", () => {
  const stages = jobStages(job({ status: "QUALITY_REVIEW_PENDING" }));
  expect(stages.map((stage) => stage.state)).toEqual(["complete", "active", "pending", "pending"]);
});
it("marks quality review complete while preparing changes after its approval", () => {
  expect(jobStages(job({ status: "NORMALIZATION_PENDING" }))[1].state).toBe("complete");
  expect(jobStages(job({ status: "NORMALIZATION_PENDING" }))[2].state).toBe("active");
});
it("shows no active or pending steps for a completed reviewed workflow", () => {
  expect(jobStages(job({ status: "COMPLETED", result_summary: { execution_mode: "reviewed-workflow" } })).every((stage) => stage.state === "complete")).toBe(true);
});
it("does not claim reviews occurred in a copy-only job", () => {
  const stages = jobStages(job({ status: "COMPLETED", result_summary: { execution_mode: "validation-copy-demo" } }));
  expect(stages[1]).toMatchObject({ state: "skipped", skipLabel: "Not required" });
  expect(stages[2]).toMatchObject({ state: "skipped", skipLabel: "Not required" });
});
it("keeps missing review evidence distinct from completed reviews", () => {
  const stages = jobStages(job({ status: "COMPLETED" }));
  expect(stages[1]).toMatchObject({ state: "skipped", skipLabel: "Not recorded" });
});
it("locates an output failure from the server segment without marking it complete", () => {
  expect(jobStages(job({ status: "FAILED", workflow_segment: 3 })).map((stage) => stage.state)).toEqual(["complete", "complete", "complete", "failed"]);
});
it("does not invent the failed stage when neither segment nor history is known", () => {
  expect(jobStages(job({ status: "FAILED" })).every((stage) => stage.state === "pending")).toBe(true);
});
