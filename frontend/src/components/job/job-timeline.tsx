import { Link } from "react-router-dom";
import { CircleDot, ListChecks } from "lucide-react";
import type { BackendJob } from "@/api/jobs-api";
import { Button } from "@/components/ui/button";

const stages = [
  { name: "Upload & configure", states: ["DRAFT", "UPLOADING", "UPLOADED"] },
  { name: "Inspect workbook", states: ["INSPECTING", "DETECTED"] },
  { name: "Quality review", states: ["SEMANTIC_REVIEW_PENDING", "QUALITY_REVIEW_PENDING", "NORMALIZATION_PENDING"] },
  { name: "Transformation review", states: ["FORMULA_REVIEW_PENDING", "STANDARDIZATION_PENDING", "UPDATE_PENDING", "TRANSFORMATION_REVIEW_PENDING"] },
  { name: "Apply approved changes", states: ["APPLYING"] },
  { name: "Validate output", states: ["VALIDATING_OUTPUT"] },
  { name: "Result", states: ["COMPLETED"] },
];
export function JobTimeline({ job, observed }: { job: BackendJob; observed: readonly string[] }) {
  const terminalError = ["FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(job.status);
  return <section aria-labelledby="workflow-timeline" className="panel space-y-4 p-5 sm:p-6">
    <div><h3 id="workflow-timeline" className="font-semibold">Workflow progress</h3>
      <p className="mt-1 text-xs text-muted-foreground">Only statuses received from the backend are marked observed. No intermediate steps are inferred.</p></div>
    <ol className="divide-y">
      {stages.map((stage, index) => {
        const current = stage.states.includes(job.status);
        const seen = stage.states.some((status) => observed.includes(status));
        return <li key={stage.name} aria-current={current ? "step" : undefined} className={`flex items-center gap-3 px-3 py-3 ${current ? "bg-accent" : ""}`}>
          <span aria-hidden="true" className={`stage-number ${current ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{current ? <CircleDot className="size-3.5" /> : index + 1}</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1"><p className={`text-sm ${current ? "font-semibold text-primary" : "font-medium"}`}>{stage.name}</p><p className="text-xs text-muted-foreground">{current ? "Current backend phase" : seen ? "Observed in this visit" : "Not observed in this visit"}</p></div>
        </li>;
      })}
    </ol>
    {terminalError && <p role="status" className="notice notice-error">Backend status: {job.status}. Processing is stopped. Check the job details before retrying.</p>}
    {job.status === "QUALITY_REVIEW_PENDING" && <div className="notice flex flex-wrap items-center justify-between gap-3 border-primary/20 bg-accent p-4">
      <p className="text-sm font-medium">Your quality review is required before processing can continue.</p>
      <Button asChild><Link to={`/jobs/${encodeURIComponent(job.job_id)}/quality-review`}><ListChecks aria-hidden="true" />Review data quality</Link></Button>
    </div>}
    {job.status === "TRANSFORMATION_REVIEW_PENDING" && <Button asChild><Link to={`/jobs/${encodeURIComponent(job.job_id)}/transformation-review`}>Review transformations</Link></Button>}
    {job.status === "COMPLETED" && <Button asChild><Link to={`/jobs/${encodeURIComponent(job.job_id)}/result`}>View result and downloads</Link></Button>}
  </section>;
}
