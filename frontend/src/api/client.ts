import type { CreateJobResponse, JobResponse, PresignedUpload } from "./legacy-types";

// Historical, unrouted demo client. It is not authenticated or OpenAPI-generated.
// Do not activate it for Day 2; new integration must use http-client.ts plus a
// BE-schema-backed endpoint adapter. Existing legacy behavior is preserved.

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatErrorDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) return String(item.msg);
        return JSON.stringify(item);
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return "Request failed";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { detail?: unknown };
      detail = formatErrorDetail(body.detail ?? detail);
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function createJob(inputFilename: string, commentName: string): Promise<CreateJobResponse> {
  return request<CreateJobResponse>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({ config: { comment_name: commentName }, input_filename: inputFilename }),
  });
}

export async function uploadToS3(upload: PresignedUpload, file: File): Promise<void> {
  const response = await fetch(upload.url, {
    method: "PUT",
    headers: { "Content-Type": XLSX_CONTENT_TYPE },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
  }
}

export function completeUpload(jobId: string, slot: "input" | "main"): Promise<JobResponse> {
  return request<JobResponse>(`/v1/jobs/${encodeURIComponent(jobId)}/uploads/complete`, {
    method: "POST",
    body: JSON.stringify({ slot }),
  });
}

export function startJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/v1/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST" });
}
