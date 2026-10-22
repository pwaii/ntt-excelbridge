import { Button } from "@/components/ui/button";
import { formatFileSize } from "./workbook-file-picker";
import type { UploadWorkflowState, WorkbookRole } from "@/uploads/types";

// Ready for the real Create Job receipt. No mock data or network behavior is
// supplied by this component; the current local-only form does not mount it.
export function UploadProgressPanel<T>({ state, onCancel, onRetry, canRetry }: {
  state: UploadWorkflowState<T>;
  onCancel: (role: WorkbookRole) => void;
  onRetry: (role: WorkbookRole) => void;
  canRetry: (role: WorkbookRole) => boolean;
}) {
  return <section aria-labelledby="upload-status-title" className="panel space-y-4 p-5">
    <h2 id="upload-status-title" className="text-sm font-semibold">Workbook uploads</h2>
    {state.files.map((file) => {
      const percent = file.progress?.total ? Math.min(100, Math.floor(file.progress.loaded / file.progress.total * 100)) : undefined;
      const label = file.phase === "uploaded" ? "Uploaded and verified" : file.phase === "awaiting-confirmation" ? "Transfer complete. Verifying upload." : file.phase.charAt(0).toUpperCase() + file.phase.slice(1);
      return <div key={file.role} className="min-w-0 border-t pt-4">
        <p className="break-all text-sm font-medium">{file.filename}</p>
        <p className="mt-1 text-xs text-muted-foreground">{file.role === "main" ? "Master workbook" : "Current workbook"} · {formatFileSize(file.size)}</p>
        <p role="status" className="mt-2 text-xs">{label}</p>
        {file.phase === "uploading" && <>
          <progress aria-label={`${file.role} workbook transfer`} max={100} value={percent} className="upload-transfer-progress" />
          <p className="mt-1 text-xs text-muted-foreground">{percent === undefined ? "Progress percentage unavailable" : `${percent}% transferred`}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onCancel(file.role)}>Cancel {file.role} upload</Button>
        </>}
        {file.error && <p role="alert" className="mt-2 text-xs text-destructive">{file.error.message}</p>}
        {canRetry(file.role) && <Button size="sm" variant="outline" className="mt-2" onClick={() => onRetry(file.role)}>Retry {file.role} upload</Button>}
      </div>;
    })}
    {state.confirmation === "confirming" && <p role="status" className="text-xs text-muted-foreground">Verifying completed transfers…</p>}
    {state.confirmationError && <p role="alert" className="text-xs leading-relaxed text-destructive">{state.confirmationError.message}</p>}
    {state.confirmation === "confirmed" && <p role="status" className="text-xs text-primary">All workbooks uploaded. Confirm your worksheets below to continue.</p>}
  </section>;
}
