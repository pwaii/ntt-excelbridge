import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JobFormActions({ canStart, onReset, missingRequirements }: { canStart: boolean; onReset: () => void; missingRequirements?: string }) {
  return <div className="rounded-b-lg border-t bg-muted/40 px-5 py-4 sm:px-6">
    <p id="workflow-action-hint" className="mb-3 text-xs text-muted-foreground">{missingRequirements || "Create a job, upload directly to S3, then confirm worksheet details before Start."}</p>
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="ghost" onClick={onReset}>Reset form</Button>
      <Button type="submit" disabled={!canStart} aria-describedby="workflow-action-hint">Create job and upload files<ArrowRight aria-hidden="true" /></Button>
    </div>
  </div>;
}
