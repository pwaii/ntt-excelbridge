import type { BackendJob } from "@/api/jobs-api";

export type StageState = "complete" | "active" | "pending" | "failed" | "skipped";
const stages = [
  { id: "setup", label: "Setup", statuses: ["DRAFT", "UPLOADING", "UPLOADED", "INSPECTING", "DETECTED", "SEMANTIC_REVIEW_PENDING"] },
  { id: "quality", label: "Quality review", statuses: ["QUALITY_REVIEW_PENDING"] },
  { id: "changes", label: "Review changes", statuses: ["NORMALIZATION_PENDING", "FORMULA_REVIEW_PENDING", "STANDARDIZATION_PENDING", "UPDATE_PENDING", "TRANSFORMATION_REVIEW_PENDING"] },
  { id: "output", label: "Prepare output", statuses: ["APPLYING", "VALIDATING_OUTPUT", "COMPLETED"] },
];
const stopped = new Set(["FAILED", "CANCELLED", "COST_GUARD_REACHED"]);

// Presentation only. Review and execution permissions remain server-owned.
export function jobStages(job: BackendJob, observed: readonly string[] = []) {
  const complete = job.status === "COMPLETED";
  const failed = stopped.has(job.status);
  const copyOnly = job.result_summary?.execution_mode === "validation-copy-demo";
  let current = stages.findIndex((stage) => stage.statuses.includes(job.status));
  if (failed) {
    const last = [...observed].reverse().find((status) => !stopped.has(status));
    current = job.workflow_segment === 3 ? 3 : job.workflow_segment === 2 ? 2
      : last ? stages.findIndex((stage) => stage.statuses.includes(last))
      : job.workflow_segment === 1 ? 0 : -1;
  }
  return stages.map((stage, index) => {
    let state: StageState = "pending";
    if (copyOnly && ["quality", "changes"].includes(stage.id)) state = "skipped";
    else if (complete && ["quality", "changes"].includes(stage.id) && job.result_summary?.execution_mode !== "reviewed-workflow" && !(job.workflow_segment && job.workflow_segment >= (stage.id === "quality" ? 2 : 3)) && !observed.some((status) => stage.statuses.includes(status))) state = "skipped";
    else if (complete) state = "complete";
    else if (index === current) state = failed ? "failed" : "active";
    else if (current >= 0 && index < current) state = "complete";
    else if (index === 0 && job.configuration_confirmed) state = "complete";
    return { ...stage, state, skipLabel: copyOnly ? "Not required" : "Not recorded" };
  });
}
