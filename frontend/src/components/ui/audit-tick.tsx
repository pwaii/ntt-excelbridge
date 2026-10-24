import { cn } from "@/lib/utils";

// The tick-and-tie mark: a reviewer's check that draws itself in when a
// finding is decided. Decorative stroke only; callers supply the meaning.
export function AuditTick({ draw = false, className }: { draw?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" data-draw={draw} className={cn("audit-tick", className)}>
      <path d="M3.5 8.5 7 12 13 4" />
    </svg>
  );
}
