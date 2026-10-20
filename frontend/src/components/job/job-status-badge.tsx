import { cn } from "@/lib/utils";

export function JobStatusBadge({ status }: { status: string }) {
  const stopped = ["FAILED", "CANCELLED", "COST_GUARD_REACHED"].includes(status);
  const reviewing = ["QUALITY_REVIEW_PENDING", "TRANSFORMATION_REVIEW_PENDING", "SEMANTIC_REVIEW_PENDING"].includes(status);
  return <span className={cn("status-badge", status === "COMPLETED" ? "notice-success" : stopped ? "notice-error" : reviewing ? "notice-warning" : "border-primary/20 bg-accent text-primary")}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
    {status.toLowerCase().replace(/_/g, " ")}
  </span>;
}
