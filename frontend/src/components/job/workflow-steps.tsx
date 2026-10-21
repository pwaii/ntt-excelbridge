const steps = ["Configure job", "Upload workbooks", "Confirm worksheets", "Start workflow"];

export function WorkflowSteps({ current }: { current: number }) {
  return <ol aria-label="Job setup steps" className="stage-rail">
    {steps.map((label, index) => <li key={label} aria-current={current === index ? "step" : undefined} className={current === index ? "font-medium" : "text-muted-foreground"}>
      <span className="stage-number" aria-hidden="true">{index + 1}</span><span className="min-w-0">{label}</span>
    </li>)}
  </ol>;
}
