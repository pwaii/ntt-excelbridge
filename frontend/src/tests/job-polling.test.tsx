import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "@/auth/context";
import { ConnectedJobStatus } from "@/components/job/connected-job-status";
import completed from "./fixtures/backend/current-started.json";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(["COMPLETED", "FAILED", "QUALITY_REVIEW_PENDING"])("polls with backoff and stops on backend %s without replaying Start", async (terminal) => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubEnv("VITE_AUTH_MODE", "cognito"); vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid"); vi.stubEnv("VITE_COGNITO_API_TOKEN_TYPE", "access");
  const responses = ["INSPECTING", "APPLYING", terminal];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ ...completed, job: { ...completed.job, status: responses.shift() ?? terminal } })));
  vi.stubGlobal("fetch", fetcher);
  const auth: AuthContextValue = { state: { status: "authenticated", user: { subject: "test" } }, configurationIssues: [], canSignIn: true, login: async () => {}, logout: async () => {}, getValidToken: async () => "mock-unit-token", getReturnTo: () => "/jobs/new" };
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><ConnectedJobStatus jobId={completed.job.job_id} /></AuthContext.Provider></MemoryRouter>); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(3999); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    if (terminal === "QUALITY_REVIEW_PENDING") {
      expect(container.querySelector('a[href$="/quality-review"]')?.textContent).toBe("Review data quality");
      expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Quality review");
    } else expect(container.textContent).toContain(`Workflow finished with backend status: ${terminal}`);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  } finally { act(() => root.unmount()); container.remove(); }
});
