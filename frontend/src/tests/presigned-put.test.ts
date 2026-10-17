import { describe, expect, it } from "vitest";
import { createPresignedPutUploader } from "@/uploads/presigned-put";
import type { PresignedPutInstruction } from "@/uploads/types";

// Internal normalized instruction fixture, not a real presigned URL or BE DTO.
const origin = "https://mock-bucket.s3.us-east-1.amazonaws.com";
const instruction: PresignedPutInstruction = { method: "PUT", url: `${origin}/test-only?mock-signature=not-valid`, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x-amz-checksum-sha256": "mock-checksum" } };
class FakeXhr extends EventTarget {
  upload = new EventTarget();
  status = 0;
  responseURL = "";
  timeout = 0;
  withCredentials = true;
  headers: Record<string, string> = {};
  method?: string;
  url?: string;
  body?: Document | XMLHttpRequestBodyInit | null;
  opened = false;
  aborted = false;
  open(method: string, url: string) { this.method = method; this.url = url; this.opened = true; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body?: Document | XMLHttpRequestBodyInit | null) { this.body = body; }
  abort() { this.aborted = true; this.dispatchEvent(new Event("abort")); }
  getResponseHeader(name: string) { return name === "ETag" ? '"actual-test-header"' : null; }
  finish(status = 200) { this.status = status; this.dispatchEvent(new Event("load")); }
}
function setup() {
  const requests: FakeXhr[] = [];
  const uploader = createPresignedPutUploader({ allowedOrigins: [origin, "https://api.example.invalid"], backendOrigin: "https://api.example.invalid/", createXhr: () => { const xhr = new FakeXhr(); requests.push(xhr); return xhr as unknown as XMLHttpRequest; } });
  return { uploader, requests, file: new File(["actual file bytes"], "current.xlsx", { type: "application/octet-stream" }) };
}

describe("raw presigned PUT transport (deterministic XHR mocks)", () => {
  it("sends the real File unchanged with exact supplied signed headers and no bearer credentials", async () => {
    const { uploader, requests, file } = setup();
    const request = uploader.upload(file, instruction);
    const xhr = requests[0];
    expect(xhr.method).toBe("PUT"); expect(xhr.url).toBe(instruction.url);
    expect(xhr.body).toBe(file); expect(xhr.body).not.toBeInstanceOf(FormData);
    expect(xhr.headers).toEqual(instruction.headers); expect(xhr.withCredentials).toBe(false);
    expect(Object.keys(xhr.headers).some((name) => name.toLowerCase() === "authorization")).toBe(false);
    xhr.finish(204);
    expect(await request).toEqual({ status: 204, etag: '"actual-test-header"' });
  });
  it("reports only actual XHR progress, including indeterminate totals", async () => {
    const { uploader, requests, file } = setup();
    const updates: unknown[] = [];
    const request = uploader.upload(file, instruction, { onProgress: (progress) => updates.push(progress) });
    expect(updates).toEqual([]);
    requests[0].upload.dispatchEvent(new ProgressEvent("progress", { loaded: 4, total: 16, lengthComputable: true }));
    requests[0].upload.dispatchEvent(new ProgressEvent("progress", { loaded: 8, lengthComputable: false }));
    requests[0].finish(); await request;
    expect(updates).toEqual([{ loaded: 4, total: 16 }, { loaded: 8, total: null }]);
  });
  it("cancels with AbortSignal and removes progress listeners", async () => {
    const { uploader, requests, file } = setup();
    const updates: unknown[] = [];
    const controller = new AbortController();
    const request = uploader.upload(file, instruction, { signal: controller.signal, onProgress: (value) => updates.push(value) });
    const rejected = expect(request).rejects.toMatchObject({ kind: "cancelled" });
    controller.abort(); await rejected;
    requests[0].upload.dispatchEvent(new ProgressEvent("progress", { loaded: 1 }));
    expect(requests[0].aborted).toBe(true); expect(updates).toEqual([]);
  });
  it.each([[403, "forbidden"], [500, "http"]] as const)("reports S3 HTTP %s without raw URLs or response bodies", async (status, kind) => {
    const { uploader, requests, file } = setup();
    const request = uploader.upload(file, instruction);
    const rejected = expect(request).rejects.toMatchObject({ kind, status });
    requests[0].finish(status); await rejected;
  });
  it.each([["error", "network"], ["timeout", "timeout"]] as const)("handles browser %s", async (event, kind) => {
    const { uploader, requests, file } = setup();
    const request = uploader.upload(file, instruction);
    const rejected = expect(request).rejects.toMatchObject({ kind });
    requests[0].dispatchEvent(new Event(event)); await rejected;
  });
  it("rejects expired instructions before issuing a request", async () => {
    const { uploader, requests, file } = setup();
    await expect(uploader.upload(file, { ...instruction, expiresAt: 1 })).rejects.toMatchObject({ kind: "expired" });
    expect(requests).toHaveLength(0);
  });
  it("rejects simultaneous upload of the same File", async () => {
    const { uploader, requests, file } = setup();
    const first = uploader.upload(file, instruction);
    await expect(uploader.upload(file, instruction)).rejects.toMatchObject({ kind: "configuration" });
    expect(requests).toHaveLength(1); requests[0].finish(); await first;
  });
  it.each(["Authorization", "Cookie", "Host", "Content-Length"])("rejects forbidden signed header %s", async (name) => {
    const { uploader, requests, file } = setup();
    await expect(uploader.upload(file, { ...instruction, headers: { [name]: "do-not-send" } })).rejects.toMatchObject({ kind: "configuration" });
    expect(requests).toHaveLength(0);
  });
  it.each(["https://api.example.invalid/v1/jobs/upload", "https://elsewhere.invalid/file", "http://mock-bucket.s3.us-east-1.amazonaws.com/file"])("rejects unsafe destination %s", async (url) => {
    const { uploader, requests, file } = setup();
    await expect(uploader.upload(file, { ...instruction, url })).rejects.toMatchObject({ kind: "configuration" });
    expect(requests).toHaveLength(0);
  });
  it("preserves XLSX and size validation before network", async () => {
    const { uploader, requests } = setup();
    await expect(uploader.upload(new File(["bytes"], "wrong.xlsm"), instruction)).rejects.toMatchObject({ kind: "configuration" });
    const oversized = new File(["bytes"], "huge.xlsx"); Object.defineProperty(oversized, "size", { value: 25 * 1024 * 1024 + 1 });
    await expect(uploader.upload(oversized, instruction)).rejects.toMatchObject({ kind: "configuration" });
    expect(requests).toHaveLength(0);
  });
});
