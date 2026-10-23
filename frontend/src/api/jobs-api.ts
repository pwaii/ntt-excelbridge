import { z } from "zod";
import type { components } from "./generated/backend";
import { createApiClient } from "./http-client";
import { ApiError } from "./errors";
import type { CreateJobAdapter } from "./create-job-types";
import type { PresignedPutInstruction, UploadConfirmationAdapter, WorkbookRole } from "@/uploads/types";
import { qualitySnapshotSchema } from "@/quality/types";

export type BackendJob = components["schemas"]["JobRecord"];
export type WorkbookMetadataResponse = Omit<components["schemas"]["WorkbookMetadataResponse"], "slot"> & { slot: WorkbookSlot };
type CreateRequest = components["schemas"]["CreateJobRequest"];
type JobResponse = components["schemas"]["JobResponse"];
type CreateResponse = components["schemas"]["CreateJobResponse"];
type CompleteResponse = components["schemas"]["UploadCompleteResponse"];
export type UploadInstructions = Partial<Record<WorkbookRole, PresignedPutInstruction>>;
export type WorkbookSlot = "input" | "input_2" | "input_3" | "input_4" | "input_5" | "input_6" | "input_7" | "input_8" | "main";
export const artifactTypes = ["output", "audit", "review_summary", "validation", "quality", "inspection"] as const;
export type ArtifactType = typeof artifactTypes[number] | `output_${number}` | "output_current" | `output_current_${number}`;
const text = z.string().min(1);
const fileSchema = z.object({ filename: text, key: text, content_type: z.string().nullable().optional(), size_bytes: z.number().int().nonnegative().nullable().optional(), etag: z.string().nullable().optional(), uploaded: z.boolean().default(false) });
const selectionSchema = z.object({ sheet_name: text, header_row: z.number().int().min(1).max(20), header_confirmed: z.literal(true), key_column: z.string().nullable().optional(), workbook_version: text });
const jobSchema = z.object({
  job_id: text, owner_id: text,
  status: z.enum(["DRAFT", "UPLOADING", "UPLOADED", "INSPECTING", "DETECTED", "SEMANTIC_REVIEW_PENDING", "QUALITY_REVIEW_PENDING", "NORMALIZATION_PENDING", "FORMULA_REVIEW_PENDING", "STANDARDIZATION_PENDING", "UPDATE_PENDING", "TRANSFORMATION_REVIEW_PENDING", "APPLYING", "VALIDATING_OUTPUT", "COMPLETED", "FAILED", "CANCELLED", "COST_GUARD_REACHED"]),
  revision: z.number().int().nonnegative(),
  config: z.object({ comment_name: z.string().max(200), output_header: z.string().nullable().optional(), standardize: z.boolean().default(false), update: z.boolean().default(false), conflict_policy: z.enum(["reject_all", "latest_wins", "merge"]).default("reject_all"), input_sheet: z.string().nullable().optional(), main_sheet: z.string().nullable().optional(), key_column: z.string().nullable().optional(), input_header_row: z.number().int().nullable().optional(), main_header_row: z.number().int().nullable().optional(), main_key_column: z.string().nullable().optional() }),
  configuration_confirmed: z.boolean().default(false), workbook_selections: z.record(z.string(), selectionSchema).default({}),
  files: z.record(z.string(), fileSchema).default({}),
  artifacts: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
  input_hash: z.string().nullable().optional(), main_hash: z.string().nullable().optional(), output_hash: z.string().nullable().optional(), expires_at: z.number().int().nullable().optional(),
  execution_arn: z.string().nullable().optional(), workflow_segment: z.number().int().nullable().optional(), error_code: z.string().nullable().optional(), error_detail: z.string().nullable().optional(),
  result_summary: z.record(z.string(), z.union([z.number().int(), z.string()])).nullable().optional(),
});
const responseSchema = z.object({ job: jobSchema, request_id: text });
const createSchema = responseSchema.extend({ uploads: z.array(z.object({ slot: text, filename: text, key: text, url: z.url(), expires_in: z.number().int().positive() })) });
const completeSchema = responseSchema.extend({ uploaded_slot: z.string().regex(/^(input|input_[2-8]|main)$/) });
const metadataSchema = z.object({ job_id: text, slot: z.enum(["input", "input_2", "input_3", "input_4", "input_5", "input_6", "input_7", "input_8", "main"]), workbook_version: text, size_bytes: z.number().int().nonnegative(), header_min: z.number().int(), header_max: z.number().int(), index_base: z.literal(1), key_required: z.boolean(), sheets: z.array(z.object({ name: text, detected_header_row: z.number().int().nullable(), header_row: z.number().int().nullable(), data_row_count: z.number().int().nonnegative(), columns: z.array(z.object({ id: text, label: text })), errors: z.array(z.string()).default([]) })), request_id: text });
const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const slotFor = (role: WorkbookRole) => role === "current" ? "input" : role === "main" ? "main" : role.replace("current_", "input_");
function jobPath(id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ApiError("configuration", "Invalid backend job identity.");
  return `/v1/jobs/${id}`;
}

// Runtime decoders mirror the pinned OpenAPI; return annotations check against
// generated types. Additional semantic checks bind responses to this operation.
export function createJobsApi(client: ReturnType<typeof createApiClient>, allowedOrigins: readonly string[], downloadOrigins: readonly string[] = allowedOrigins) {
  const checkId = (job: BackendJob, id: string) => {
    if (job.job_id !== id) throw new ApiError("protocol", "The backend returned a different job.");
  };
  async function getJob(id: string, signal?: AbortSignal): Promise<JobResponse> {
    const result = await client.request(jobPath(id), { signal, decode: (value): JobResponse => responseSchema.parse(value) });
    checkId(result.data.job, id);
    return result.data;
  }
  const createAdapter: CreateJobAdapter<UploadInstructions> = {
    async create(configuration, signal) {
      const currentFiles = configuration.currentFiles?.length ? configuration.currentFiles : [configuration.currentFile!];
      const roles: WorkbookRole[] = ["current", ...currentFiles.slice(1).map((_, index) => `current_${index + 2}` as const)];
      if (configuration.standardize || configuration.update) roles.push("main");
      const files: Partial<Record<WorkbookRole, File | null>> = {
        current: currentFiles[0],
        main: configuration.mainFile,
        ...Object.fromEntries(currentFiles.slice(1).map((file, index) => [`current_${index + 2}`, file])),
      };
      for (const role of roles) {
        if (/[\\/]/.test(files[role]!.name) || files[role]!.name.length > 255) throw new ApiError("configuration", "Use workbook filenames of at most 255 characters without path separators.");
      }
      const body: CreateRequest = {
        config: { comment_name: configuration.comment_name, output_header: configuration.outputHeader, standardize: configuration.standardize, update: configuration.update, conflict_policy: "reject_all" },
        input_filename: files.current!.name,
        ...(currentFiles.length > 1 ? { input_filenames: currentFiles.map((file) => file.name) } : {}),
        ...(roles.includes("main") ? { main_filename: files.main!.name } : {}),
      };
      if (body.config.comment_name.length > 200) throw new ApiError("configuration", "Prompt must contain at most 200 characters, as required by the backend.");
      const requestedAt = Date.now();
      const result = await client.request("/v1/jobs", { method: "POST", body, signal, decode: (value): CreateResponse => createSchema.parse(value) });
      const { job, uploads, request_id } = result.data;
      jobPath(job.job_id);
      if (job.config.comment_name !== body.config.comment_name || job.config.output_header !== body.config.output_header || job.config.standardize !== body.config.standardize || job.config.update !== body.config.update) throw new ApiError("protocol", "The backend job configuration does not match the submitted configuration.");
      if (uploads.length !== roles.length) throw new ApiError("protocol", "The backend upload slots do not match the requested workbooks.");
      const instructions: UploadInstructions = {};
      for (const role of roles) {
        const slot = slotFor(role);
        const entries = uploads.filter((upload) => upload.slot === slot);
        const stored = job.files?.[slot];
        const upload = entries[0];
        if (entries.length !== 1 || !stored || upload.filename !== files[role]!.name || stored.filename !== upload.filename || stored.key !== upload.key) throw new ApiError("protocol", "Backend upload identity could not be verified.");
        const url = new URL(upload.url);
        if (url.protocol !== "https:" || url.username || url.password || url.hash || !allowedOrigins.includes(url.origin)) throw new ApiError("protocol", "Backend upload URL is outside the configured S3 origins.");
        // The checked-in S3Store signs put_object with this exact ContentType.
        // expires_in starts before the response arrives, so use request start.
        instructions[role] = { method: "PUT", url: upload.url, headers: { "Content-Type": xlsxContentType }, expiresAt: requestedAt + upload.expires_in * 1000 };
      }
      return { jobId: job.job_id, uploadInstructions: instructions, requestId: request_id };
    },
  };
  const confirmationAdapter: UploadConfirmationAdapter<BackendJob> = {
    // No blind retry: this backend advances revision per slot and partial success
    // must be reconciled with GET before issuing another confirmation.
    async confirm(id, roles, _transfers, signal) {
      const requestIds: string[] = [];
      let { job } = await getJob(id, signal);
      for (const role of roles) {
        const slot = slotFor(role);
        if (job.files?.[slot]?.uploaded) continue;
        const body: components["schemas"]["UploadCompleteRequest"] = { slot };
        const result = await client.request(`${jobPath(id)}/uploads/complete`, { method: "POST", body, signal, decode: (value): CompleteResponse => completeSchema.parse(value) });
        checkId(result.data.job, id);
        if (result.data.uploaded_slot !== slot || !result.data.job.files?.[slot]?.uploaded) throw new ApiError("protocol", "Backend did not confirm the requested workbook.");
        job = result.data.job;
        requestIds.push(result.data.request_id);
      }
      if (!roles.every((role) => job.files?.[slotFor(role)]?.uploaded)) throw new ApiError("protocol", "Required workbooks are not server-confirmed.");
      return { manifest: job, requestIds };
    },
  };
  async function getMetadata(id: string, slot: WorkbookSlot, query: Record<string, string | number>, signal?: AbortSignal) {
    const result = await client.request(`${jobPath(id)}/workbooks/${slot}/metadata`, { query, signal, decode: (value): WorkbookMetadataResponse => metadataSchema.parse(value) as WorkbookMetadataResponse });
    if (result.data.job_id !== id || result.data.slot !== slot) throw new ApiError("protocol", "Workbook metadata identity mismatch.");
    return result.data;
  }
  async function saveConfiguration(id: string, body: components["schemas"]["SaveWorkbookConfiguration"], signal?: AbortSignal) {
    const result = await client.request(`${jobPath(id)}/configuration`, { method: "PUT", body, signal, decode: (value): JobResponse => responseSchema.parse(value) });
    checkId(result.data.job, id); return result.data;
  }
  async function startJob(id: string, revision: number, signal?: AbortSignal) {
    const result = await client.request(`${jobPath(id)}/start`, { method: "POST", query: { expected_revision: revision }, signal, decode: (value): JobResponse => responseSchema.parse(value) });
    checkId(result.data.job, id); return result.data;
  }
  async function submitReview(id: string, body: components["schemas"]["ReviewRequest"], signal?: AbortSignal) {
    const result = await client.request(`${jobPath(id)}/reviews`, { method: "POST", body, signal, timeoutMs: 300_000,
      decode: (value): components["schemas"]["ReviewResponse"] => responseSchema.extend({ review_id: text }).parse(value) });
    checkId(result.data.job, id);
    if (result.data.job.revision <= body.expected_revision) throw new ApiError("protocol", "The backend did not acknowledge a new review revision.");
    return result.data;
  }
  async function getArtifact(id: string, type: ArtifactType, signal?: AbortSignal) {
    const requestedAt = Date.now();
    const result = await client.request(`${jobPath(id)}/artifacts/${type}`, { signal,
      decode: (value): components["schemas"]["PresignedDownload"] => z.object({ artifact_type: text, key: text, url: z.url(), expires_in: z.number().int().positive(), request_id: text }).parse(value) });
    const signed = result.data;
    const url = new URL(signed.url);
    if (signed.artifact_type !== type || url.protocol !== "https:" || url.username || url.password || url.hash || !downloadOrigins.includes(url.origin)) throw new ApiError("protocol", "The artifact download URL or identity could not be verified.");
    return { ...signed, expiresAt: requestedAt + signed.expires_in * 1000 };
  }
  async function getReviewReport(id: string, stage: "quality" | "transformation", revision: number, cursor: number, signal?: AbortSignal) {
    const result = await client.request(`${jobPath(id)}/review-report`, { query: { stage, expected_revision: revision, cursor, limit: 100 }, signal,
      decode: (value): components["schemas"]["ReviewReportPage"] => qualitySnapshotSchema.safeExtend({ stage: z.enum(["quality", "transformation"]), total: z.number().int().nonnegative(), nextCursor: z.number().int().nonnegative().nullable().optional(), requestId: text }).parse(value) });
    if (result.data.jobId !== id || result.data.revision !== revision || result.data.stage !== stage) throw new ApiError("protocol", "Review report identity or revision mismatch.");
    return result.data;
  }
  async function retryJob(id: string, signal?: AbortSignal) {
    const result = await client.request(`${jobPath(id)}/retry`, { method: "POST", signal, decode: (value): JobResponse => responseSchema.parse(value) });
    checkId(result.data.job, id); return result.data;
  }
  return { getJob, createAdapter, confirmationAdapter, getMetadata, saveConfiguration, startJob, submitReview, getArtifact, getReviewReport, retryJob };
}
export type JobsApi = ReturnType<typeof createJobsApi>;
