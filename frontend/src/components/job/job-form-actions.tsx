import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JobFormActions({ canStart, onReset, missingRequirements }: { canStart: boolean; onReset: () => void; missingRequirements?: string }) {
  return <div className="builder-actions">
    <p id="workflow-action-hint" className="builder-action-hint">{missingRequirements || "Ready to upload. Next, choose your worksheet and confirm its headers."}</p>
    <div className="builder-action-buttons">
      <Button type="button" variant="ghost" onClick={onReset}>Reset</Button>
      <Button type="submit" disabled={!canStart} aria-describedby="workflow-action-hint">Upload files<ArrowRight aria-hidden="true" /></Button>
    </div>
  </div>;
}
