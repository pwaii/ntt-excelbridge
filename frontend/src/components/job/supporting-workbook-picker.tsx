import { useRef } from "react";
import { FileSpreadsheet, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "./workbook-file-picker";
import { workbookFileSchema } from "@/schemas/job-creation";

export function SupportingWorkbookPicker({ id, files, onChange, error }: {
  id: string;
  files: readonly File[];
  onChange: (files: File[]) => void;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  function choose(selected: FileList | null) {
    if (!selected?.length) return;
    const next = [...files];
    for (const file of Array.from(selected)) {
      const result = workbookFileSchema.safeParse(file);
      if (!result.success) return;
      if (!next.some((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified)) next.push(file);
    }
    onChange(next.slice(0, 8));
  }

  return <div>
    <input ref={input} id={id} type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { choose(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}><FolderOpen aria-hidden="true" />Add workbooks</Button>
      <span className="text-xs text-muted-foreground">Optional · up to 8 additional .xlsx files</span>
    </div>
    {files.length > 0 && <ul aria-label="Supporting workbooks" className="mt-3 space-y-2">
      {files.map((file, index) => <li key={`${file.name}-${file.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-lg border bg-background/50 p-2">
        <FileSpreadsheet className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>{file.name}<span className="ml-2 text-xs text-muted-foreground">{formatFileSize(file.size)}</span></span>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, position) => position !== index))}><X aria-hidden="true" /></Button>
      </li>)}
    </ul>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}
