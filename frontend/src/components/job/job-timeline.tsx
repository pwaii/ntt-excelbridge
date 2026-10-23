import { Link } from "react-router-dom";
import { Check, Circle, CircleDot, ArrowRight, AlertCircle, LoaderCircle } from "lucide-react";
import type { BackendJob } from "@/api/jobs-api";
import { Button } from "@/components/ui/button";
import { jobStages } from "@/lib/job-stages";

export const messages: Record<string, [string, string]> = {
  DRAFT: ["Add your workbook", "Upload the required files to continue."],
  UPLOADING: ["Uploading workbooks", "Wait for the files to finish uploading."],
  UPLOADED: ["Confirm your worksheets", "Choose the sheets and header rows below before starting."],
  INSPECTING: ["Checking your workbook", "Scanning columns, data types, and workbook structure."],
  DETECTED: ["Preparing quality findings", "Your data checks are being prepared for review."],
  SEMANTIC_REVIEW_PENDING: ["Checking column meanings", "Preparing the workbook's column interpretation."],
  QUALITY_REVIEW_PENDING: ["Your quality review is ready", "Decide which corrections to approve before continuing."],
  NORMALIZATION_PENDING: ["Preparing proposed changes", "Applying your quality decisions and preparing the next review."],
  FORMULA_REVIEW_PENDING: ["Preparing your formula", "Creating a proposal for the column you requested."],
  STANDARDIZATION_PENDING: ["Preparing value mappings", "Comparing values with your main workbook."],
  UPDATE_PENDING: ["Matching workbook rows", "Preparing row matches for your approval."],
  TRANSFORMATION_REVIEW_PENDING: ["Your changes are ready to review", "Check the formula and other proposals before they are applied."],
  APPLYING: ["Applying approved changes", "Creating a new workbook from your submitted decisions."],
  VALIDATING_OUTPUT: ["Checking the output", "Verifying the new workbook before publishing it."],
  COMPLETED: ["Your workbook is ready", "The output is available. Your original files are unchanged."],
  FAILED: ["Processing stopped", "Check the error details before retrying this job."],
  CANCELLED: ["Workflow cancelled", "Processing has stopped for this job."],
  COST_GUARD_REACHED: ["Processing limit reached", "Review the job details before continuing."],
};

export function JobTimeline({ job, observed, showSummary = true }: { job: BackendJob; observed: readonly string[]; showSummary?: boolean }) {
  const phases = jobStages(job, observed);
  const failed = ["FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(job.status);
  const completed = job.status === "COMPLETED";
  const review = ["QUALITY_REVIEW_PENDING", "TRANSFORMATION_REVIEW_PENDING"].includes(job.status);
  const message = messages[job.status] ?? ["Checking workflow status", "Refresh this page to check for updates."];
  const next = job.status === "QUALITY_REVIEW_PENDING" ? { path: "quality-review", action: "Review data quality" }
    : job.status === "TRANSFORMATION_REVIEW_PENDING" ? { path: "transformation-review", action: "Review transformations" }
    : completed ? { path: "result", action: "View result and downloads" } : undefined;
  return <section aria-labelledby="workflow-timeline" className="workflow-status">
    {showSummary && <div className="workflow-current">
      <span className={`workflow-state-icon ${failed ? "text-destructive" : completed ? "text-[var(--success)]" : "text-primary"}`} aria-hidden="true">
        {failed ? <AlertCircle /> : completed ? <Check /> : review || job.status === "UPLOADED" ? <CircleDot /> : <LoaderCircle className="processing-indicator" />}
      </span>
      <div className="workflow-phase-body">
        <h2 id="workflow-timeline">{message[0]}</h2>
        <p>{message[1]}</p>
      </div>
      {next && <Button asChild><Link to={`/jobs/${encodeURIComponent(job.job_id)}/${next.path}`}>{next.action}<ArrowRight aria-hidden="true" /></Link></Button>}
    </div>}
    {!showSummary && <h2 id="workflow-timeline" className="sr-only">Workflow progress</h2>}
    <ol className="workflow-phases" aria-label="Workflow progress">
      {phases.map((phase, index) => <li key={phase.id} data-state={phase.state} aria-current={phase.state === "active" || phase.state === "failed" ? "step" : undefined}>
        <span className="phase-icon" aria-hidden="true">
          {phase.state === "complete" ? <Check /> : phase.state === "failed" ? <AlertCircle /> : phase.state === "active" ? <CircleDot /> : phase.state === "skipped" ? <Circle /> : index + 1}
        </span>
        <span>{phase.label}</span>
        <span className="phase-state">
          {phase.state === "complete" ? "Complete" : phase.state === "active" ? (review ? "Your review needed" : "In progress") : phase.state === "failed" ? "Stopped" : phase.state === "skipped" ? phase.skipLabel : "Pending"}
        </span>
      </li>)}
    </ol>
  </section>;
}
