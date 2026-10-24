import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { workbookFileSchema } from "@/schemas/job-creation";
import { formatFileSize } from "./workbook-file-picker";

interface CurrentWorkbookPickerProps {
  id: string;
  files: File[];
  onChange: (files: File[]) => void;
  validationError?: string;
  onSelectionError?: (message: string | null) => void;
}

const MAX_CURRENT_FILES = 8;

export function CurrentWorkbookPicker({ id, files, onChange, validationError, onSelectionError }: CurrentWorkbookPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const displayedError = error || validationError;

  useEffect(() => {
    if (files.length === 0) browseButton.current?.focus();
  }, [files.length]);

  function selectionError(message: string) {
    setError(message);
    onSelectionError?.(message || null);
  }

  function selectFiles(selected: FileList | null) {
    if (!selected?.length) return;
    const next = [...files, ...selected];
    if (next.length > MAX_CURRENT_FILES) {
      selectionError(`Select no more than ${MAX_CURRENT_FILES} current workbooks.`);
      return;
    }
    const invalid = next.find((file) => !workbookFileSchema.safeParse(file).success);
    if (invalid) {
      const result = workbookFileSchema.safeParse(invalid);
      selectionError(result.success ? "Choose valid .xlsx workbooks." : result.error.issues[0].message);
      return;
    }
    const names = new Set<string>();
    const unique = next.filter((file) => !names.has(file.name) && names.add(file.name));
    selectionError("");
    onChange(unique);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFiles(event.dataTransfer.files);
  }

  function remove(index: number) {
    const next = files.filter((_, fileIndex) => fileIndex !== index);
    selectionError("");
    onChange(next);
  }

  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="Your files"
        aria-required="true"
        aria-invalid={Boolean(displayedError)}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => { selectFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
      />
      <div
        className={cn("workbook-dropzone", displayedError && "border-destructive")}
        data-dragging={dragging}
        data-selected={files.length > 0}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
        onDrop={drop}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{dragging ? "Drop your Excel files here" : "Drop your Excel files here"}</p>
            <p className="mt-1 text-xs text-muted-foreground">.xlsx · Max 25 MB each · Up to {MAX_CURRENT_FILES} files</p>
          </div>
          <Button ref={browseButton} type="button" variant="outline" size="sm" onClick={() => input.current?.click()} aria-label="Browse files"><FolderOpen aria-hidden="true" />Browse</Button>
        </div>
        {files.length > 0 && <div className="mt-3 space-y-2" role="list" aria-label="Selected files">
          {files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}`} role="listitem" className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded border bg-card px-2 py-2">
            <span className="flex size-7 items-center justify-center rounded bg-muted text-[var(--workflow-accent)]"><FileSpreadsheet className="size-4" aria-hidden="true" /></span>
            <span className="min-w-0"><span className="block truncate text-sm font-medium" title={file.name}>{file.name}</span><span className="block text-[11px] text-muted-foreground">{formatFileSize(file.size)} · Current workbook</span></span>
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} aria-label={`Remove ${file.name}`} title="Remove workbook"><X aria-hidden="true" /></Button>
          </div>)}
        </div>}
      </div>
      <p id={`${id}-hint`} className="mt-2 text-[11px] text-muted-foreground">Select one or more XLSX files. The first file is the primary workbook; all selected files are uploaded with the job.</p>
      {displayedError && <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-destructive">{displayedError}</p>}
    </div>
  );
}
