import type { CellContent } from "@/types/cell-content";

// Display is always React text, for either origin. No evaluation, HTML injection,
// leading-character inference, or mutation of approved formulas takes place here.
export function CellText({ cell }: { cell: CellContent }) {
  return <span>{cell.value}</span>;
}
