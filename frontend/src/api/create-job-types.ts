import type { JobFormValues } from "@/schemas/job-creation";
import type { ApiError } from "./errors";

// Frontend integration boundary ONLY, not the POST /v1/jobs wire contract.
// A future BE-schema-backed adapter maps actual job/upload response fields into
// this memory-only receipt. Upload instructions remain opaque until BE publishes.
export interface CreateJobReceipt<TUploadInstructions> {
  readonly jobId: string;
  readonly uploadInstructions: TUploadInstructions;
  readonly requestId?: string;
}
export interface CreateJobAdapter<TUploadInstructions> {
  create(configuration: JobFormValues, signal: AbortSignal): Promise<CreateJobReceipt<TUploadInstructions>>;
}
interface Created<T> {
  readonly configuration: JobFormValues;
  readonly receipt: CreateJobReceipt<T>;
}
export type CreateJobState<T> =
  | { readonly phase: "editing-configuration" }
  | { readonly phase: "creating-job"; readonly configuration: JobFormValues }
  | ({ readonly phase: "job-created" | "upload-instructions-received" | "ready-for-upload" } & Created<T>)
  | { readonly phase: "create-error"; readonly error: ApiError; readonly outcomeUnknown: boolean; readonly configuration?: JobFormValues };
