import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JobFormActions({ canStart, onReset, missingRequirements }: { canStart: boolean; onReset: () => void; missingRequirements?: string }) {
  return <div className="rounded-b-[20px] border-t bg-card px-4 py-3.5 sm:px-5">
    <p id="workflow-action-hint" className="mb-3 text-xs text-muted-foreground">{missingRequirements || "Create a job, upload directly to S3, then confirm worksheet details before Start."}</p>
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="ghost" onClick={onReset}>Reset form</Button>
      <Button type="submit" className="workflow-primary text-[#081329]" disabled={!canStart} aria-describedby="workflow-action-hint">Create job and upload files<ArrowRight aria-hidden="true" /></Button>
    </div>
  </div>;
}
