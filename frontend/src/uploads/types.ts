export type WorkbookRole = "current" | "main" | `attachment_${number}`;

// INTERNAL adapter output, not the missing backend/OpenAPI presigned schema.
// The schema-backed adapter must supply the exact method/headers and a reliable
// absolute expiry when available. Nothing is inferred from file.type or URL text.
export interface PresignedPutInstruction {
  readonly method: "PUT";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt?: number; // epoch milliseconds, only from a validated adapter
}
export interface TransferProgress { readonly loaded: number; readonly total: number | null }
export interface TransferReceipt { readonly status: number; readonly etag: string | null }
export type UploadFailureKind = "configuration" | "expired" | "forbidden" | "http" | "network" | "timeout" | "cancelled";
export class UploadError extends Error {
  constructor(readonly kind: UploadFailureKind, message: string, readonly status?: number) { super(message); this.name = "UploadError"; }
}
export interface PutUploader {
  upload(file: File, instruction: PresignedPutInstruction, options?: { signal?: AbortSignal; onProgress?: (progress: TransferProgress) => void }): Promise<TransferReceipt>;
}
export interface UploadFileState {
  readonly role: WorkbookRole;
  readonly filename: string;
  readonly size: number;
  readonly phase: "waiting" | "uploading" | "awaiting-confirmation" | "uploaded" | "failed" | "cancelled";
  readonly attempts: number;
  readonly progress: TransferProgress | null;
  readonly error?: UploadError;
}
export interface ConfirmedUploads<T> {
  readonly manifest: T; // Backend-verified, opaque until OpenAPI exists.
  readonly requestIds: readonly string[];
}
export interface UploadConfirmationAdapter<T> {
  readonly retrySafe?: boolean; // Only if the published contract makes retry safe.
  // This adapter owns exact body/slot mapping, per-file vs combined requests,
  // Cognito JWT via Task 8 transport, and complete manifest validation.
  confirm(jobId: string, roles: readonly WorkbookRole[], transfers: Readonly<Partial<Record<WorkbookRole, TransferReceipt>>>, signal: AbortSignal): Promise<ConfirmedUploads<T>>;
}
export interface UploadWorkflowState<T> {
  readonly jobId: string;
  readonly files: readonly UploadFileState[];
  readonly confirmation: "waiting" | "confirming" | "confirmed" | "failed";
  readonly confirmationError?: { readonly message: string; readonly requestId?: string; readonly code?: string };
  readonly result?: ConfirmedUploads<T>;
}
