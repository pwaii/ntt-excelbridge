import { AlertTriangle } from "lucide-react";
import { workbookRowLimit } from "@/lib/workflow-readiness";
import type { WorkbookMetadata } from "@/types/workbook";

export function LargeFileWarning({ metadata, label = "Workbook" }: { metadata?: WorkbookMetadata; label?: string }) {
  const limit = workbookRowLimit(metadata);
  if (limit !== "large" && limit !== "rejected") return null;
  const rejected = limit === "rejected";
  return (
    <p role={rejected ? "alert" : "status"} className={`mt-3 flex items-start gap-2 text-xs leading-relaxed ${rejected ? "text-destructive" : "text-[#96521e]"}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {rejected
        ? `${label} exceeds 50,000 data rows and cannot be processed.`
        : `${label}: large file — top issues only. The demo is optimized for approximately 2,000 rows; this is a warning, not a rejection.`}
    </p>
  );
}
