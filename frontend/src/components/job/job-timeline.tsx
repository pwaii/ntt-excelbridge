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
  return <section aria-labelledby="workflow-timeline" className="space-y-4 rounded-2xl border bg-background p-5">
    <div><h3 id="workflow-timeline" className="font-semibold">Workflow progress</h3>
      <p className="mt-1 text-xs text-muted-foreground">Only statuses received from the backend are marked observed. No intermediate steps are inferred.</p></div>
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {stages.map((stage) => {
        const current = stage.states.includes(job.status);
        const seen = stage.states.some((status) => observed.includes(status));
        return <li key={stage.name} aria-current={current ? "step" : undefined} className={`rounded-xl border p-3 ${current ? "border-primary bg-accent" : "border-border"}`}>
          <div className="flex items-start gap-2"><CircleDot aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${current ? "text-primary" : "text-muted-foreground"}`} />
            <div><p className="text-sm font-medium">{stage.name}</p><p className="mt-1 text-xs text-muted-foreground">{current ? "Current backend phase" : seen ? "Observed in this visit" : "Not observed in this visit"}</p></div></div>
        </li>;
      })}
    </ol>
    {terminalError && <p role="status" className="rounded-xl border border-destructive/30 p-3 text-sm">Backend status: {job.status}. Processing is stopped. Detailed failure information is not supplied by the current job contract.</p>}
    {job.status === "QUALITY_REVIEW_PENDING" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent p-4">
      <p className="text-sm font-medium">Your quality review is required before processing can continue.</p>
      <Button asChild><Link to={`/jobs/${encodeURIComponent(job.job_id)}/quality-review`}><ListChecks aria-hidden="true" />Review data quality</Link></Button>
    </div>}
    {job.status === "TRANSFORMATION_REVIEW_PENDING" && <Button asChild><Link to={`/jobs/${encodeURIComponent(job.job_id)}/transformation-review`}>Review transformations</Link></Button>}
    {job.status === "COMPLETED" && <Button asChild><Link to={`/jobs/${encodeURIComponent(job.job_id)}/result`}>View result and downloads</Link></Button>}
    <p className="text-xs text-muted-foreground">Issue counts and processing history are unavailable until the backend publishes its quality report and history contracts.</p>
  </section>;
}
