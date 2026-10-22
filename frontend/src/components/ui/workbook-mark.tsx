export function WorkbookMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
    <path d="M6 4h13l5 5v19H6V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M19 4v6h5M10 14h10M10 19h10M10 24h5M15 14v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="m23 18 5 4-5 4M19 22h9" stroke="var(--workflow-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
