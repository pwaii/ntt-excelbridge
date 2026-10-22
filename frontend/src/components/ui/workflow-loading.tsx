export function WorkflowLoading({ label }: { label: string }) {
  return <div role="status" aria-live="polite" className="loading-block">
    <p className="loading-state">{label}</p>
    <div className="loading-skeleton" aria-hidden="true"><span /><span /><span /></div>
  </div>;
}
