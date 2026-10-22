import { cn } from "@/lib/utils";

const statusLabels: Record<string, string> = {
  DRAFT: "Not uploaded", UPLOADING: "Uploading", UPLOADED: "Ready for worksheet setup",
  INSPECTING: "Checking your workbook", DETECTED: "Preparing findings", QUALITY_REVIEW_PENDING: "Quality review needed",
  SEMANTIC_REVIEW_PENDING: "Column review needed", FORMULA_REVIEW_PENDING: "Preparing formulas",
  NORMALIZATION_PENDING: "Preparing corrections", STANDARDIZATION_PENDING: "Preparing value mappings",
  UPDATE_PENDING: "Matching rows", TRANSFORMATION_REVIEW_PENDING: "Changes ready for review",
  APPLYING: "Applying approved changes", VALIDATING_OUTPUT: "Checking the output", COMPLETED: "Completed",
  FAILED: "Processing failed", CANCELLED: "Cancelled", COST_GUARD_REACHED: "Processing limit reached",
};
export function JobStatusBadge({ status }: { status: string }) {
  const stopped = ["FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(status);
  const reviewing = ["QUALITY_REVIEW_PENDING", "TRANSFORMATION_REVIEW_PENDING", "SEMANTIC_REVIEW_PENDING"].includes(status);
  return <span className={cn("status-badge", status === "COMPLETED" ? "notice-success" : stopped ? "notice-error" : reviewing ? "notice-warning" : "border-primary/20 bg-accent text-primary")}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
    {statusLabels[status] ?? status.toLowerCase().replace(/_/g, " ")}
  </span>;
}
