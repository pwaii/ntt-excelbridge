export type ApiFailureKind = "http" | "authentication" | "network" | "timeout" | "cancelled" | "protocol" | "configuration";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiFailureKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) { super(message); this.name = "ApiError"; }
}

export function httpErrorMessage(status: number) {
  if (status === 400 || status === 422) return "The server could not validate this request. Check the configuration.";
  if (status === 401) return "Sign in again before continuing.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "The requested resource was not found.";
  if (status === 409) return "The request conflicts with the current server state. Reload before continuing.";
  if (status === 429) return "Too many requests. Wait before trying again.";
  if (status >= 500) return "The server could not complete the request. Try again later.";
  return "The server rejected the request.";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function diagnostic(value: unknown) {
  // Identifiers only; never display arbitrary server prose, HTML, token-like JWTs,
  // request payloads or presigned URLs. This is best-effort, not a server schema.
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}
export function responseDiagnostics(headers: Headers, payload: unknown) {
  const body = record(payload);
  const error = record(body?.error);
  const detail = record(body?.detail);
  return {
    requestId: diagnostic(headers.get("x-request-id")) ?? diagnostic(headers.get("x-amzn-requestid"))
      ?? diagnostic(body?.request_id) ?? diagnostic(error?.request_id) ?? diagnostic(detail?.request_id),
    code: diagnostic(error?.code) ?? diagnostic(detail?.code) ?? diagnostic(body?.code)
      ?? diagnostic(body?.error_code) ?? diagnostic(error?.error_code) ?? diagnostic(detail?.error_code),
  };
}
