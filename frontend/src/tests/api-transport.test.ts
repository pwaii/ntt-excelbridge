import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, type JsonValue } from "@/api/http-client";
import { ApiError } from "@/api/errors";

// CONTRACT-INDEPENDENT transport fixtures, not POST /v1/jobs examples.
const decode = (payload: unknown) => {
  if (typeof payload !== "object" || payload === null || !("sample" in payload) || payload.sample !== true) throw new Error();
  return { sample: true };
};
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
function client(fetcher: typeof fetch, getValidToken = vi.fn(async () => "mock-api-token")) {
  return createApiClient({ baseUrl: "https://api.example.invalid", getValidToken, fetcher });
}
afterEach(() => vi.restoreAllMocks());

describe("contract-independent authenticated transport", () => {
  it("attaches only the token returned by Task 7 and decodes JSON with request ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ sample: true, request_id: "request-body" }));
    const getToken = vi.fn(async () => "mock-selected-token-type");
    const result = await client(fetcher, getToken).request("/v1/transport-test", { method: "POST", body: { declaration: "not-a-workbook" }, decode });
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.example.invalid/v1/transport-test");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer mock-selected-token-type", "Content-Type": "application/json" });
    expect(options).toMatchObject({ redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
    expect(result).toEqual({ data: { sample: true }, requestId: "request-body" });
  });
  it.each([400, 401, 403, 404, 409, 422, 429, 500, 503])("handles HTTP %s without exposing server prose or retrying POST", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: status === 409 ? "REVIEW_REVISION_CONFLICT" : "TEST_ERROR", message: "private workbook contents and mock-api-token" }, request_id: "request-123" }, status));
    try {
      await client(fetcher).request("/v1/transport-test", { method: "POST", decode });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, requestId: "request-123", code: status === 409 ? "REVIEW_REVISION_CONFLICT" : "TEST_ERROR" });
      expect((error as ApiError).message).not.toContain("private workbook");
      expect((error as ApiError).message).not.toContain("mock-api-token");
    }
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("handles FastAPI-shaped detail and header request IDs independently", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ detail: { code: "TEST_VALIDATION", request_id: "body-id" } }, 400, { "x-request-id": "header-id" }));
    await expect(client(fetcher).request("/v1/transport-test", { decode })).rejects.toMatchObject({ code: "TEST_VALIDATION", requestId: "header-id" });
  });
  it("handles a validation array without assuming it has a single message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ detail: [{ msg: "sensitive", loc: ["body", "field"] }] }, 422));
    await expect(client(fetcher).request("/v1/transport-test", { decode })).rejects.toMatchObject({ status: 422, code: undefined });
  });
  it("retains error_code diagnostics without treating that envelope as universal", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ detail: "Do not display backend prose", error_code: "TEST_CONFIGURATION_ERROR", request_id: "test-configuration-request" }, 503));
    await expect(client(fetcher).request("/v1/transport-test", { decode })).rejects.toMatchObject({ code: "TEST_CONFIGURATION_ERROR", requestId: "test-configuration-request" });
  });
  it("handles non-JSON error bodies while retaining correlation headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>private</html>", { status: 502, headers: { "x-amzn-requestid": "aws-request" } }));
    await expect(client(fetcher).request("/v1/transport-test", { decode })).rejects.toMatchObject({ status: 502, requestId: "aws-request", message: "The server could not complete the request. Try again later." });
  });
  it("rejects successful responses that fail the mandatory decoder", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ unexpected: "shape" }, 200, { "x-request-id": "schema-error" }));
    await expect(client(fetcher).request("/v1/transport-test", { decode })).rejects.toMatchObject({ kind: "protocol", requestId: "schema-error" });
  });
  it("sanitizes network exceptions and never retries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret presigned URL and token"));
    await expect(client(fetcher).request("/v1/transport-test", { method: "POST", decode })).rejects.toMatchObject({ kind: "network", message: "The backend could not be reached. Check server state before retrying a create request." });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not fetch when the provider cannot supply the required token", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const getToken = vi.fn(async () => { throw new Error("private auth response"); });
    await expect(client(fetcher, getToken).request("/v1/transport-test", { decode })).rejects.toMatchObject({ kind: "authentication", status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("times out token retrieval without issuing a late POST", async () => {
    const fetcher = vi.fn<typeof fetch>();
    let resolve!: (value: string) => void;
    const getToken = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    await expect(client(fetcher, getToken).request("/v1/transport-test", { method: "POST", timeoutMs: 5, decode })).rejects.toMatchObject({ kind: "timeout" });
    resolve("mock-late-token");
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels an in-flight request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener("abort", () => reject(new Error("abort")), { once: true }); }));
    const controller = new AbortController();
    const request = client(fetcher).request("/v1/transport-test", { signal: controller.signal, decode });
    const rejected = expect(request).rejects.toMatchObject({ kind: "cancelled" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
  });
  it("times out an in-flight request without a POST retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener("abort", () => reject(new Error("abort")), { once: true }); }));
    await expect(client(fetcher).request("/v1/transport-test", { method: "POST", timeoutMs: 5, decode })).rejects.toMatchObject({ kind: "timeout" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("never sends bytes or credentials to presigned/third-party destinations", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(client(fetcher).request("https://s3.example.invalid/file", { decode })).rejects.toMatchObject({ kind: "configuration" });
    await expect(client(fetcher).request("/v1/transport-test", { method: "POST", body: { file: new File(["bytes"], "local.xlsx") } as unknown as JsonValue, decode })).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires HTTPS except explicit development loopback", () => {
    const getValidToken = async () => "mock-token";
    expect(() => createApiClient({ baseUrl: "http://api.example.invalid", getValidToken })).toThrow(ApiError);
    expect(() => createApiClient({ baseUrl: "http://127.0.0.1:8000", getValidToken, development: true })).not.toThrow();
  });
});
