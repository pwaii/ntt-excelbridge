import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResultWorkspace } from "@/components/job/result-workspace";
import { createApiClient } from "@/api/http-client";
import { createJobsApi } from "@/api/jobs-api";
import base from "./fixtures/backend/current-get.json";

const origin = "https://synthetic.s3.us-east-1.amazonaws.com";
const signed = { artifact_type: "output", key: "jobs/synthetic/output.xlsx", url: `${origin}/output.xlsx?signature=synthetic`, expires_in: 60, request_id: "synthetic-request" };
let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
function button(text: string) { const found = [...container.querySelectorAll("button")].find((node) => node.textContent === text); if (!found) throw new Error(`Missing ${text}`); return found; }
async function render(status = "COMPLETED", artifacts: Record<string, { key: string }> = { output: { key: signed.key } }) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...base, job: { ...base.job, status, artifacts } })));
  const api = createJobsApi(createApiClient({ baseUrl: "https://api.example.invalid", getValidToken: async () => "synthetic-token", fetcher }), [origin]);
  await act(async () => root.render(<MemoryRouter><ResultWorkspace api={api} jobId={base.job.job_id} /></MemoryRouter>));
  return { fetcher };
}
it("shows actual completion and only prepares a published artifact after a human request", async () => {
  const { fetcher } = await render();
  expect(container.textContent).toContain("Backend processing completed"); expect(container.textContent).toContain("Not published by backend");
  expect(container.querySelector(`a[href^="${origin}"]`)).toBeNull(); expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(signed)));
  await act(async () => button("Generate download link").click());
  const link = container.querySelector<HTMLAnchorElement>(`a[href^="${origin}"]`)!;
  expect(link.href).toBe(signed.url); expect(link.rel).toContain("noreferrer"); expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("does not certify AI corrections");
});
it.each(["INSPECTING", "QUALITY_REVIEW_PENDING", "FAILED", "CANCELLED"])("offers progress recovery and no downloads at %s", async (status) => {
  await render(status); expect(container.textContent).toContain("Result is not ready");
  expect(container.querySelector(`a[href="/jobs/${base.job.job_id}"]`)).not.toBeNull();
  expect(container.textContent).not.toContain("Generate download link");
});
it("removes an expired link and requests a fresh URL", async () => {
  vi.useFakeTimers(); const { fetcher } = await render();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(signed)));
  await act(async () => button("Generate download link").click());
  act(() => vi.advanceTimersByTime(60_001));
  expect(container.textContent).toContain("Link expired"); expect(container.querySelector(`a[href^="${origin}"]`)).toBeNull();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...signed, url: `${origin}/fresh.xlsx` })));
  await act(async () => button("Generate new link").click());
  expect(container.querySelector<HTMLAnchorElement>(`a[href^="${origin}"]`)?.href).toBe(`${origin}/fresh.xlsx`);
});
it("reports request errors without advertising a download or retrying automatically", async () => {
  const { fetcher } = await render(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Not ready" }), { status: 404 }));
  await act(async () => button("Generate download link").click());
  expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector(`a[href^="${origin}"]`)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("clears a previously generated link when refreshing authoritative job state", async () => {
  const { fetcher } = await render(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify(signed)));
  await act(async () => button("Generate download link").click());
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...base, job: { ...base.job, status: "FAILED" } })));
  await act(async () => button("Refresh result").click());
  expect(container.textContent).toContain("FAILED"); expect(container.querySelector(`a[href^="${origin}"]`)).toBeNull();
});
it("blocks a signed link for a different artifact key", async () => {
  const { fetcher } = await render(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...signed, key: "jobs/another/output.xlsx" })));
  await act(async () => button("Generate download link").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("does not match this job");
  expect(container.querySelector(`a[href^="${origin}"]`)).toBeNull();
});
it("renders an empty published-artifacts list without inventing output or counts", async () => {
  await render("COMPLETED", {});
  expect(container.querySelectorAll('[aria-label="Artifact downloads"] article')).toHaveLength(6);
  expect(container.querySelectorAll('[aria-label="Artifact downloads"] button')).toHaveLength(0);
  expect(container.textContent).toContain("counts, formula syntax results");
});
