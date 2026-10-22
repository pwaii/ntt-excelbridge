import { ApiError, httpErrorMessage, responseDiagnostics } from "./errors";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface ApiResponse<T> { readonly data: T; readonly requestId?: string }
interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: JsonValue;
  signal?: AbortSignal;
  timeoutMs?: number;
  query?: Readonly<Record<string, string | number>>;
  // Mandatory trust boundary. Future endpoint adapters validate against the BE
  // contract; generic casts must not masquerade as runtime response validation.
  decode: (payload: unknown) => T;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function encodeJson(value: JsonValue): string {
  const body = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "object" && item !== null
      && (item instanceof Blob || item instanceof FormData || item instanceof ArrayBuffer)) throw new Error();
    return item;
  });
  if (body === undefined) throw new Error();
  return body;
}

// Transport only. No endpoint/request/response schema is invented here.
export function createApiClient({ baseUrl, getValidToken, fetcher = fetch, development = false, localDevelopment = false }: {
  baseUrl: string;
  getValidToken: () => Promise<string>;
  fetcher?: typeof fetch;
  development?: boolean;
  localDevelopment?: boolean;
}) {
  let base: URL;
  try { base = new URL(baseUrl); }
  catch { throw new ApiError("configuration", "Configure a valid backend API base URL."); }
  const loopback = development && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (localDevelopment && !loopback) throw new ApiError("configuration", "Local fallback is restricted to development loopback APIs.");
  if (base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))) {
    throw new ApiError("configuration", "Configure a trusted HTTPS backend API URL (HTTP loopback is allowed only in development).");
  }
  return {
    async request<T>(path: string, options: RequestOptions<T>): Promise<ApiResponse<T>> {
      if (!/^\/v1\//.test(path) || /[\\?#\r\n]/.test(path)) throw new ApiError("configuration", "Use a relative backend API path.");
      const url = new URL(`${base.href.replace(/\/$/, "")}${path}`);
      for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
      if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/v1/`)) throw new ApiError("configuration", "The backend API path is invalid.");
      const timeoutMs = options.timeoutMs ?? 30_000;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ApiError("configuration", "Use a positive API timeout.");
      let body: string | undefined;
      try { body = options.body === undefined ? undefined : encodeJson(options.body); }
      catch { throw new ApiError("configuration", "Backend API requests must contain JSON declarations, never workbook bytes."); }
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) controller.abort();
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        if (controller.signal.aborted) throw new Error();
        let token = "";
        try { if (!localDevelopment) token = await abortable(getValidToken(), controller.signal); }
        catch {
          if (controller.signal.aborted) throw new Error();
          throw new ApiError("authentication", "A valid backend API token is unavailable. Sign in or check authentication configuration.", 401);
        }
        if (!localDevelopment && (!token || /\s/.test(token))) throw new ApiError("authentication", "A valid backend API token is unavailable.", 401);
        if (controller.signal.aborted) throw new Error();
        const response = await fetcher(url.href, {
          method: options.method ?? "GET", body, signal: controller.signal,
          headers: { ...(localDevelopment ? { "X-User-Id": "local-user" } : { Authorization: `Bearer ${token}` }), Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
        });
        let payload: unknown;
        try { payload = response.status === 204 ? null : await response.json(); }
        catch {
          if (controller.signal.aborted) throw new Error();
          if (response.ok) throw new ApiError("protocol", "The backend returned an unreadable response.", response.status, undefined, responseDiagnostics(response.headers, null).requestId);
        }
        const diagnostics = responseDiagnostics(response.headers, payload);
        if (!response.ok) throw new ApiError("http", httpErrorMessage(response.status, diagnostics.code), response.status, diagnostics.code, diagnostics.requestId);
        let data: T;
        try { data = options.decode(payload); }
        catch { throw new ApiError("protocol", "The backend response does not match the expected contract.", response.status, undefined, diagnostics.requestId); }
        return { data, requestId: diagnostics.requestId };
      } catch (error) {
        if (controller.signal.aborted) throw new ApiError(timedOut ? "timeout" : "cancelled", timedOut ? "The request timed out. Check server state before retrying a create request." : "The request was cancelled. A submitted create request may still complete on the server.");
        if (error instanceof ApiError) throw error;
        throw new ApiError("network", "The backend could not be reached. Check server state before retrying a create request.");
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
      }
    },
  };
}
