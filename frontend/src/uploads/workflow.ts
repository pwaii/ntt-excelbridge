import { jobCreationSchema, type JobFormValues } from "@/schemas/job-creation";
import { ApiError } from "@/api/errors";
import { UploadError, type PresignedPutInstruction, type PutUploader, type TransferReceipt, type UploadConfirmationAdapter, type UploadWorkflowState, type WorkbookRole } from "./types";

// Contract-independent workflow. Do not connect until Task 8 provides a real
// created job and a validated instruction/confirmation adapter. URLs stay private.
export function createUploadWorkflow<T>({ jobId, configuration, instructions, uploader, confirmationAdapter }: {
  jobId: string;
  configuration: JobFormValues;
  instructions: Partial<Record<WorkbookRole, PresignedPutInstruction>>;
  uploader: PutUploader;
  confirmationAdapter?: UploadConfirmationAdapter<T>;
}) {
  const parsed = jobCreationSchema.parse(configuration);
  if (!jobId.trim()) throw new UploadError("configuration", "A real backend job identity is required before upload.");
  const additionalFiles = parsed.additionalFiles ?? [];
  const roles: WorkbookRole[] = ["current", ...additionalFiles.map((_, index) => `attachment_${index + 1}` as const)];
  if (parsed.standardize || parsed.update) roles.push("main");
  const files: Partial<Record<WorkbookRole, File | null>> = {
    current: parsed.currentFile!,
    main: parsed.mainFile,
    ...Object.fromEntries(additionalFiles.map((file, index) => [`attachment_${index + 1}`, file])),
  };
  let state: UploadWorkflowState<T> = {
    jobId, confirmation: "waiting",
    files: roles.map((role) => ({ role, filename: files[role]!.name, size: files[role]!.size, phase: "waiting", attempts: 0, progress: null })),
  };
  const active = new Map<WorkbookRole, AbortController>();
  const transfers: Partial<Record<WorkbookRole, TransferReceipt>> = {};
  let confirming = false;
  let confirmationAttempts = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const update = (role: WorkbookRole, patch: Partial<UploadWorkflowState<T>["files"][number]>) => {
    state = { ...state, files: state.files.map((file) => file.role === role ? { ...file, ...patch } : file) }; emit();
  };
  const canRetry = (role: WorkbookRole) => {
    const file = state.files.find((entry) => entry.role === role);
    const expiry = instructions[role]?.expiresAt;
    return Boolean(file && ["failed", "cancelled"].includes(file.phase) && file.attempts < 2
      && !["forbidden", "expired", "configuration"].includes(file.error?.kind ?? "") && (expiry === undefined || expiry > Date.now()));
  };
  async function upload(role: WorkbookRole): Promise<boolean> {
    const previous = state.files.find((file) => file.role === role);
    if (!previous || active.has(role) || confirming || (previous.phase !== "waiting" && !canRetry(role))) return false;
    const instruction = instructions[role];
    if (!instruction) { update(role, { phase: "failed", error: new UploadError("configuration", "Backend upload instructions are missing for this workbook.") }); return false; }
    const controller = new AbortController();
    active.set(role, controller);
    update(role, { phase: "uploading", attempts: previous.attempts + 1, progress: null, error: undefined });
    try {
      const receipt = await uploader.upload(files[role]!, instruction, { signal: controller.signal, onProgress: (progress) => update(role, { progress }) });
      if (controller.signal.aborted) throw new UploadError("cancelled", "Upload cancelled.");
      transfers[role] = receipt;
      update(role, { phase: "awaiting-confirmation" });
      return true;
    } catch (error) {
      const safe = error instanceof UploadError ? error : new UploadError("network", "Workbook upload failed. Check the connection and upload instructions.");
      update(role, { phase: safe.kind === "cancelled" ? "cancelled" : "failed", error: safe });
      return false;
    } finally { active.delete(role); }
  }
  async function confirm(): Promise<boolean> {
    if (confirming || state.confirmation === "confirmed" || active.size || !state.files.every((file) => file.phase === "awaiting-confirmation")) return false;
    if (confirmationAttempts >= 2 || (state.confirmation === "failed" && !confirmationAdapter?.retrySafe)) return false;
    if (!confirmationAdapter) {
      state = { ...state, confirmation: "failed", confirmationError: { message: "Backend confirmation is unavailable until the OpenAPI adapter is connected. File transfers are not yet server-confirmed." } }; emit(); return false;
    }
    confirming = true;
    confirmationAttempts += 1;
    state = { ...state, confirmation: "confirming", confirmationError: undefined }; emit();
    try {
      const result = await confirmationAdapter.confirm(jobId, roles, { ...transfers }, new AbortController().signal);
      if (!result || result.manifest === undefined || result.manifest === null || !Array.isArray(result.requestIds)) throw new ApiError("protocol", "Backend upload confirmation could not be validated.");
      state = { ...state, confirmation: "confirmed", result, files: state.files.map((file) => ({ ...file, phase: "uploaded" })) }; emit(); return true;
    } catch (error) {
      state = { ...state, confirmation: "failed", confirmationError: {
        message: "File transfer finished, but backend confirmation failed. Verify server state before retrying confirmation; do not recreate the job or upload successful files again.",
        requestId: error instanceof ApiError ? error.requestId : undefined,
        code: error instanceof ApiError ? error.code : undefined,
      } }; emit(); return false;
    } finally { confirming = false; }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    upload, canRetry, confirm,
    async uploadAll() {
      await Promise.all(roles.map((role) => upload(role)));
      return confirm();
    },
    cancel(role: WorkbookRole) { active.get(role)?.abort(); },
  };
}
