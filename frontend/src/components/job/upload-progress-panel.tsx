import { LoaderCircle, CheckCircle2, XCircle } from "lucide-react";
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
      const uploading = file.phase === "uploading";
      const verifying = file.phase === "awaiting-confirmation";
      const done = file.phase === "uploaded";
      const failed = file.phase === "failed" || file.phase === "cancelled";
      const active = uploading || verifying;
      const phaseLabel =
        done ? "Uploaded and verified" :
        verifying ? "Verifying upload…" :
        uploading ? "Uploading…" :
        failed ? (file.phase === "cancelled" ? "Cancelled" : "Upload failed") :
        "Waiting to upload";
      return <div key={file.role} className="min-w-0 border-t pt-4">
        <p className="break-all text-sm font-medium">{file.filename}</p>
        <p className="mt-1 text-xs text-muted-foreground">{file.role === "main" ? "Master workbook" : "Current workbook"} · {formatFileSize(file.size)}</p>
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {active && <LoaderCircle size={13} className="processing-indicator shrink-0" aria-hidden="true" />}
          {done && <CheckCircle2 size={13} className="shrink-0 text-green-600" aria-hidden="true" />}
          {failed && <XCircle size={13} className="shrink-0 text-destructive" aria-hidden="true" />}
          <p role="status">{phaseLabel}</p>
        </div>
        {uploading && <>
          <progress aria-label={`${file.role} workbook transfer`} max={100} value={percent} className="upload-transfer-progress" />
          <p className="mt-1 text-xs text-muted-foreground">{percent === undefined ? "Progress percentage unavailable" : `${percent}% transferred`}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onCancel(file.role)}>Cancel upload</Button>
        </>}
        {file.error && <p role="alert" className="mt-2 text-xs text-destructive">{file.error.message}</p>}
        {canRetry(file.role) && <Button size="sm" variant="outline" className="mt-2" onClick={() => onRetry(file.role)}>Retry upload</Button>}
      </div>;
    })}
    {state.confirmation === "confirming" && (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle size={13} className="processing-indicator shrink-0" aria-hidden="true" />
        <p role="status">Verifying completed transfers…</p>
      </div>
    )}
    {state.confirmationError && <p role="alert" className="text-xs leading-relaxed text-destructive">{state.confirmationError.message}</p>}
    {state.confirmation === "confirmed" && (
      <div className="flex items-center gap-1.5 text-xs text-primary">
        <CheckCircle2 size={13} className="shrink-0" aria-hidden="true" />
        <p role="status">All workbooks uploaded. Confirm your worksheets below to continue.</p>
      </div>
    )}
  </section>;
}
