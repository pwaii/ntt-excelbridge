import { Fragment } from "react";
import { Check, CircleDot, AlertCircle } from "lucide-react";
import type { StageState } from "@/lib/job-stages";

type StepperStage = { label: string; state: StageState };

export function WorkflowStepper({ stages, selected, onSelect }: {
  stages: StepperStage[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="stepper-row" role="tablist" aria-label="Workflow stages">
      {stages.map((stage, i) => {
        const interactive = stage.state === "complete" || stage.state === "active" || stage.state === "failed";
        return (
          <Fragment key={stage.label}>
            {i > 0 && (
              <div className="step-connector" data-left={stages[i - 1].state} aria-hidden="true" />
            )}
            <div className="stepper-item">
              <button
                role="tab"
                type="button"
                aria-selected={i === selected}
                aria-label={`${stage.label}: ${stage.state}`}
                className={`stepper-node step-${stage.state}`}
                disabled={!interactive}
                onClick={() => onSelect(i)}
              >
                {stage.state === "complete" && <Check size={16} aria-hidden="true" />}
                {stage.state === "active" && <CircleDot size={16} aria-hidden="true" />}
                {stage.state === "failed" && <AlertCircle size={16} aria-hidden="true" />}
              </button>
              <span className="stepper-label" aria-hidden="true">{stage.label}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
