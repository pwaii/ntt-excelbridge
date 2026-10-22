import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/auth/context";
import { CreateJobPage } from "@/pages/create-job-page";
import { JobProgressPage } from "@/pages/job-progress-page";
import metadataInput from "./fixtures/backend/both-metadata-input.json";
import metadataMain from "./fixtures/backend/both-metadata-main.json";
import configured from "./fixtures/backend/both-configured.json";
import started from "./fixtures/backend/both-started.json";
import { rememberedJob } from "@/lib/pending-job";
import both from "./fixtures/backend/both-create.json";
import inputConfirmed from "./fixtures/backend/both-confirm-input.json";
import mainConfirmed from "./fixtures/backend/both-confirm-main.json";
import fetched from "./fixtures/backend/both-get.json";

const origin = "https://contract-fixture.s3.us-east-1.amazonaws.com";
let container: HTMLDivElement; let root: Root;
const requests: FixtureXhr[] = [];
class FixtureXhr extends EventTarget {
  upload = new EventTarget(); status = 200; responseURL = ""; timeout = 0; withCredentials = false;
  headers: Record<string, string> = {}; body?: unknown; method?: string;
  open(method: string, url: string) { this.method = method; this.responseURL = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body: unknown) { this.body = body; requests.push(this); queueMicrotask(() => this.dispatchEvent(new Event("load"))); }
  getResponseHeader() { return '"etag-1"'; }
  abort() { this.dispatchEvent(new Event("abort")); }
}
const auth: AuthContextValue = { state: { status: "authenticated", user: { subject: "contract-fixture-user" } }, canSignIn: true, configurationIssues: [], login: async () => {}, logout: async () => {}, getValidToken: async () => "mock-unit-token", getReturnTo: () => "/jobs/new" };
beforeEach(() => {
  vi.stubEnv("VITE_AUTH_MODE", "cognito");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid");
  vi.stubEnv("VITE_S3_UPLOAD_ORIGINS", origin);
  vi.stubEnv("VITE_COGNITO_API_TOKEN_TYPE", "access");
  vi.stubGlobal("XMLHttpRequest", FixtureXhr);
  sessionStorage.clear(); requests.length = 0;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;

describe("production page wiring with FastAPI contract fixtures and mocked auth/S3", () => {
  it("creates, uploads, confirms, saves real metadata choices and starts once", async () => {
    let current: unknown = both;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/metadata")) return new Response(JSON.stringify(path.includes("/main/") ? metadataMain : metadataInput));
      if (path.endsWith("/configuration")) { current = configured; return new Response(JSON.stringify(configured)); }
      if (path.endsWith("/start")) { current = started; return new Response(JSON.stringify(started)); }
      if (path === "/v1/jobs" && options?.method === "POST") return new Response(JSON.stringify(both), { status: 201 });
      if (path.endsWith("/uploads/complete")) {
        current = JSON.parse(options!.body as string).slot === "input" ? inputConfirmed : mainConfirmed;
        return new Response(JSON.stringify(current));
      }
      if (options?.method === "GET") return new Response(JSON.stringify(current));
      throw new Error("Unexpected mutation; Start must not be called.");
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><CreateJobPage /></AuthContext.Provider></MemoryRouter>); });
    const files: File[] = [];
    await act(async () => {
      for (const name of ["standardize", "update"]) container.querySelector<HTMLInputElement>(`input[name=${name}]`)!.click();
    });
    await act(async () => {
      for (const [id, name] of [["current-file", "current.xlsx"], ["main-file", "main.xlsx"]]) {
        const file = new File(["fixture bytes"], name); files.push(file);
        const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
        Object.defineProperty(input, "files", { configurable: true, value: [file] });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const prompt = container.querySelector<HTMLTextAreaElement>("#prompt")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(prompt, "Profit");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
      const header = container.querySelector<HTMLInputElement>("#output-header")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(header, "profit");
      header.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("#prompt")!.getAttribute("name")).toBe("comment_name");
    expect(button("Upload workbooks").disabled).toBe(false);
    await act(async () => { button("Upload workbooks").click(); button("Upload workbooks").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("All workbooks uploaded"));
    expect(requests.map((xhr) => xhr.body)).toEqual(files);
    expect(requests.every((xhr) => xhr.method === "PUT" && !xhr.withCredentials && !xhr.headers.Authorization)).toBe(true);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/v1/jobs"))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/uploads/complete"))).toHaveLength(2);
    expect(container.textContent).toContain("Confirm your worksheets");
    await act(async () => {
      for (const role of ["current", "main"]) {
        const select = container.querySelector<HTMLSelectElement>(`#${role}-metadata-sheet`)!;
        select.value = "Data"; select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => { for (const item of [...container.querySelectorAll("button")].filter((item) => item.textContent === "Confirm header row")) item.click(); });
    await act(async () => {
      for (const role of ["current", "main"]) {
        const select = container.querySelector<HTMLSelectElement>(`#${role}-metadata-key`)!;
        select.value = "A"; select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(button("Start workflow").disabled).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/start"))).toBe(false);
    await act(async () => { button("Save setup").click(); });
    expect(button("Start workflow").disabled).toBe(false);
    await act(async () => { button("Start workflow").click(); });
    expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/start"))).toHaveLength(1);
    expect(rememberedJob()).toBe(both.job.job_id);
    expect(container.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
  });
  it("reads backend state on a fresh job route and refreshes without POST replay", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify(String(url).includes("/metadata") ? (String(url).includes("/main/") ? metadataMain : metadataInput) : fetched)));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/jobs/${fetched.job.job_id}`]}><AuthContext.Provider value={auth}><Routes><Route path="/jobs/:id" element={<JobProgressPage />} /></Routes></AuthContext.Provider></MemoryRouter>); });
    expect(container.textContent).toContain("UPLOADED");
    expect(container.textContent).not.toContain("Workflow started");
    await act(async () => { button("Refresh job status").click(); });
    expect(fetcher.mock.calls.filter(([url]) => !String(url).includes("/metadata"))).toHaveLength(4);
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("restores saved header/key selections on a fresh page without browser files", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify(String(url).includes("/metadata") ? (String(url).includes("/main/") ? metadataMain : metadataInput) : configured)));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/jobs/${configured.job.job_id}`]}><AuthContext.Provider value={auth}><Routes><Route path="/jobs/:id" element={<JobProgressPage />} /></Routes></AuthContext.Provider></MemoryRouter>); });
    expect(container.querySelector<HTMLSelectElement>("#current-metadata-sheet")!.value).toBe("Data");
    expect(container.querySelector<HTMLInputElement>("#current-metadata-header-row")!.value).toBe("3");
    expect(container.querySelector<HTMLSelectElement>("#main-metadata-key")!.value).toBe("A");
    expect(button("Setup saved").disabled).toBe(true);
    expect(button("Start workflow").disabled).toBe(false);
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("blocks real creation when authentication configuration is incomplete", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={{ ...auth, configurationIssues: ["Missing VITE_COGNITO_DOMAIN."] }}><CreateJobPage /></AuthContext.Provider></MemoryRouter>); });
    expect(button("Upload workbooks").disabled).toBe(true);
    expect(container.textContent).toContain("Missing VITE_COGNITO_DOMAIN");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
