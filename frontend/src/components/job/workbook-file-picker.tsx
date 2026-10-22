import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, FolderOpen, RefreshCw, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { workbookFileSchema } from "@/schemas/job-creation";

interface WorkbookFilePickerProps {
  id: string;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  validationError?: string;
  onSelectionError?: (message: string | null) => void;
}

export function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 bytes";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkbookFilePicker({ id, label, file, onChange, validationError, onSelectionError }: WorkbookFilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const restoreBrowseFocus = useRef(false);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const displayedError = error || validationError;
  const descriptionId = `${id}-hint${displayedError ? ` ${id}-error` : ""}`;

  useEffect(() => {
    if (!file && restoreBrowseFocus.current) {
      browseButton.current?.focus();
      restoreBrowseFocus.current = false;
    }
  }, [file]);

  function selectionError(message: string) {
    setError(message);
    onSelectionError?.(message || null);
  }

  function selectFiles(files: FileList | null) {
    if (!files?.length) return;
    if (files.length !== 1) { selectionError("Choose one workbook at a time."); return; }
    const selected = files[0];
    const result = workbookFileSchema.safeParse(selected);
    if (!result.success) {
      selectionError(result.error.issues[0].message);
      return;
    }
    selectionError("");
    onChange(selected);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    selectFiles(event.dataTransfer.files);
  }

  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label={label}
        aria-required="true"
        aria-invalid={Boolean(displayedError)}
        aria-describedby={descriptionId}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          selectFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div
        className={cn(
          "workbook-dropzone flex items-center border motion-reduce:transition-none",
          !file && "border-dashed",
          displayedError && "border-destructive",
        )}
        data-dragging={dragging}
        data-selected={Boolean(file)}
        onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(event) => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }}
        onDrop={drop}
      >
        {file ? (
          <div className="grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3">
            <span className="file-document-icon flex size-9 items-center justify-center text-primary"><FileSpreadsheet className="size-6" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1" role="status">
              <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{formatFileSize(file.size)} · Selected locally</p>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => input.current?.click()} aria-label={`Replace ${label.toLowerCase()}`} aria-describedby={descriptionId} title="Replace file"><RefreshCw aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon" onClick={() => { restoreBrowseFocus.current = true; selectionError(""); onChange(null); }} aria-label={`Remove ${label.toLowerCase()}`} aria-describedby={descriptionId} title="Remove file"><X aria-hidden="true" /></Button>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center gap-3 text-left">
            <span className="file-upload-icon flex size-8 shrink-0 items-center justify-center text-muted-foreground"><UploadCloud className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{dragging ? "Drop to select your workbook" : "Drop your workbook here"}</p>
              <p className="mt-1 text-xs text-muted-foreground">.xlsx · Max 25 MB</p>
              <span className="sr-only">No file selected.</span>
            </div>
            <Button ref={browseButton} variant="outline" size="sm" onClick={() => input.current?.click()} aria-label={`Browse ${label.toLowerCase()}`} aria-describedby={descriptionId}><FolderOpen aria-hidden="true" />Choose file</Button>
          </div>
        )}
      </div>
      <p id={`${id}-hint`} className="sr-only">Required. XLSX only, up to 25 MB. Files upload when you choose Upload workbooks.</p>
      {displayedError && <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-destructive">{displayedError}{error && file ? " The previous workbook is retained; choose a valid replacement or remove it." : ""}</p>}
    </div>
  );
}
