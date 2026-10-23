import { Check, FileUp, ListChecks, Settings2 } from "lucide-react";

const steps = [
  { label: "Set up", detail: "Choose tasks & files", icon: Settings2 },
  { label: "Upload", detail: "Transfer & verify", icon: FileUp },
  { label: "Review", detail: "Approve & download", icon: ListChecks },
];
export function WorkflowSteps({ current }: { current: number }) {
  return <ol aria-label="Job setup steps" className="stage-rail">
    {steps.map(({ label, detail, icon: Icon }, index) => <li key={label} data-complete={current > index} aria-current={current === index ? "step" : undefined}>
      <span className="stage-icon" aria-hidden="true">{current > index ? <Check /> : <Icon />}</span><span className="stage-copy"><span className="stage-label">{label}</span><span className="stage-detail">{detail}</span></span>
    </li>)}
  </ol>;
}
