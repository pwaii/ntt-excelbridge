import { workbookFileSchema } from "@/schemas/job-creation";
import { UploadError, type PutUploader, type TransferReceipt } from "./types";
import { isApprovedS3Origin } from "./approved-origin";

export function createPresignedPutUploader({ allowedOrigins, backendOrigin, createXhr = () => new XMLHttpRequest(), timeoutMs = 120_000 }: {
  allowedOrigins: readonly string[]; // Verified S3 origins from the integration adapter/config, never guessed.
  backendOrigin: string;
  createXhr?: () => XMLHttpRequest;
  timeoutMs?: number;
}): PutUploader {
  let forbiddenOrigin: string;
  try { forbiddenOrigin = new URL(backendOrigin).origin; }
  catch { throw new UploadError("configuration", "Configure the backend origin before enabling direct S3 upload."); }
  const active = new WeakSet<File>();
  return {
    async upload(file, instruction, { signal, onProgress } = {}) {
      if (!workbookFileSchema.safeParse(file).success) throw new UploadError("configuration", "Select a valid XLSX workbook within the 25 MB limit.");
      if (signal?.aborted) throw new UploadError("cancelled", "Upload cancelled.");
      if (active.has(file)) throw new UploadError("configuration", "This workbook already has an upload in progress.");
      let destination: URL;
      try { destination = new URL(instruction.url); }
      catch { throw new UploadError("configuration", "Valid backend-issued upload instructions are required."); }
      if (instruction.method !== "PUT" || destination.protocol !== "https:" || destination.username || destination.password || destination.hash
        || destination.origin === forbiddenOrigin || !isApprovedS3Origin(destination, allowedOrigins) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new UploadError("configuration", "Upload instructions must target an approved HTTPS S3 origin with the supported PUT method.");
      }
      if (instruction.expiresAt !== undefined && (!Number.isFinite(instruction.expiresAt) || instruction.expiresAt <= Date.now())) {
        throw new UploadError("expired", "Upload instructions have expired. Obtain fresh instructions through the backend before retrying.");
      }
      const headers = Object.entries(instruction.headers);
      const names = new Set<string>();
      for (const [name, value] of headers) {
        const normalized = name.toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value) || names.has(normalized)
          || ["authorization", "proxy-authorization", "cookie", "host", "content-length", "origin", "referer", "connection", "transfer-encoding"].includes(normalized)) {
          throw new UploadError("configuration", "Upload instructions contain unsupported headers. Cognito credentials must never be sent to S3.");
        }
        names.add(normalized);
      }
      active.add(file);
      try {
        return await new Promise<TransferReceipt>((resolve, reject) => {
          const xhr = createXhr();
          let settled = false;
          const cleanup = () => {
            signal?.removeEventListener("abort", cancel);
            xhr.upload.removeEventListener("progress", progress);
            xhr.removeEventListener("load", loaded);
            xhr.removeEventListener("error", network);
            xhr.removeEventListener("timeout", timeout);
            xhr.removeEventListener("abort", aborted);
          };
          const finish = (error?: UploadError, receipt?: TransferReceipt) => {
            if (settled) return;
            settled = true; cleanup();
            if (error) reject(error); else resolve(receipt!);
          };
          const cancel = () => { xhr.abort(); finish(new UploadError("cancelled", "Upload cancelled. Server verification is still required before any file is considered uploaded.")); };
          const progress = (event: ProgressEvent) => {
            if (!settled && Number.isFinite(event.loaded) && event.loaded >= 0) onProgress?.({ loaded: event.loaded, total: event.lengthComputable && event.total > 0 ? event.total : null });
          };
          const loaded = () => {
            if (xhr.responseURL && new URL(xhr.responseURL).origin !== destination.origin) {
              finish(new UploadError("configuration", "The upload destination redirected unexpectedly. Obtain correctly scoped upload instructions.")); return;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              // Never fabricate ETag/checksum; a missing CORS-exposed ETag is null.
              finish(undefined, { status: xhr.status, etag: xhr.getResponseHeader("ETag") });
            } else if (xhr.status === 403) finish(new UploadError("forbidden", "S3 refused the upload. The URL may have expired or its signed headers/permissions may be incorrect. Fresh backend instructions may be required.", 403));
            else finish(new UploadError("http", "S3 did not accept the workbook. Check upload instructions before retrying.", xhr.status));
          };
          const network = () => finish(new UploadError("network", "Upload could not reach S3. Check the connection and bucket CORS configuration."));
          const timeout = () => finish(new UploadError("timeout", "The upload timed out. The object may exist; backend confirmation remains authoritative."));
          const aborted = () => finish(new UploadError("cancelled", "Upload cancelled."));
          // Upload progress listeners cause CORS preflight; register before open/send.
          xhr.upload.addEventListener("progress", progress);
          xhr.addEventListener("load", loaded);
          xhr.addEventListener("error", network);
          xhr.addEventListener("timeout", timeout);
          xhr.addEventListener("abort", aborted);
          signal?.addEventListener("abort", cancel, { once: true });
          try {
            xhr.open(instruction.method, instruction.url, true);
            xhr.withCredentials = false;
            xhr.timeout = timeoutMs;
            for (const [name, value] of headers) xhr.setRequestHeader(name, value);
            if (signal?.aborted) cancel(); else xhr.send(file);
          } catch { finish(new UploadError("network", "The browser could not send this upload. Check the signed headers and CORS configuration.")); }
        });
      } catch (error) {
        if (error instanceof UploadError) throw error;
        throw new UploadError("network", "The browser could not initialize this upload.");
      } finally { active.delete(file); }
    },
  };
}
