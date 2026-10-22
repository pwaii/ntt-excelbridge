import { useState } from "react";
import { Button } from "@/components/ui/button";
import { headerConfirmed, metadataKey, validHeaderRow } from "@/lib/workflow-readiness";
import { MAX_HEADER_ROW } from "@/lib/workbook-limits";
import type { HeaderConfirmation, WorkbookMetadata } from "@/types/workbook";

interface HeaderRowConfirmationProps {
  id: string;
  label: string;
  metadata?: WorkbookMetadata;
  confirmation: HeaderConfirmation | null;
  onChange: (confirmation: HeaderConfirmation | null) => void;
}

export function HeaderRowConfirmation(props: HeaderRowConfirmationProps) {
  if (!props.metadata) {
    return <div className="rounded-lg border bg-muted/50 p-3"><p className="text-xs font-medium">{props.label} header row</p><p className="mt-1 text-xs text-muted-foreground">Awaiting workbook metadata. No header row has been detected or confirmed.</p></div>;
  }
  return <HeaderEditor key={metadataKey(props.metadata)} {...props} metadata={props.metadata} />;
}

function HeaderEditor({ id, label, metadata, confirmation, onChange }: HeaderRowConfirmationProps & { metadata: WorkbookMetadata }) {
  const [draft, setDraft] = useState(String(headerConfirmed(metadata, confirmation) ? confirmation!.row : metadata.columnsHeaderRow ?? metadata.detectedHeaderRow ?? ""));
  const [edited, setEdited] = useState(false);
  const row = Number(draft);
  const bounds = metadata.headerRowBounds ?? { min: 1, max: MAX_HEADER_ROW, indexBase: 1 };
  const valid = draft.trim() !== "" && validHeaderRow(row, bounds);
  const confirmed = headerConfirmed(metadata, confirmation) && confirmation?.row === row;
  return (
    <div className="rounded-md bg-muted/50 p-4">
      <label htmlFor={`${id}-row`} className="block text-sm font-medium">{label} header row</label>
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{metadata.detectedHeaderRow == null ? "Enter the row containing your column names." : `Detected header row: ${metadata.detectedHeaderRow}. Check the column names, then confirm or correct this row.`} {bounds.indexBase === 0 && "The backend uses zero-based row indices."}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input id={`${id}-row`} type="number" min={bounds.min} max={bounds.max} step={1} value={draft} aria-invalid={edited && !valid} aria-describedby={`${id}-hint${edited && !valid ? ` ${id}-error` : ""}`} className="field-control max-w-24" onChange={(event) => { setDraft(event.target.value); setEdited(true); onChange(null); }} />
        <Button size="sm" variant="outline" disabled={!valid || confirmed} onClick={() => onChange({ metadataKey: metadataKey(metadata), row })}>{confirmed ? "Header confirmed" : "Confirm header row"}</Button>
      </div>
      {edited && !valid && <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-destructive">Enter a whole row number from {bounds.min} to {bounds.max}.</p>}
      {metadata.columnsHeaderRow === row && metadata.columns?.length ? <p className="mt-3 break-words text-xs leading-relaxed text-muted-foreground">Columns: {metadata.columns.map((column) => column.label).join(" · ")}</p> : null}
      {confirmed && <p role="status" className="sr-only">Row {row} confirmed for this workbook version and sheet.</p>}
    </div>
  );
}
