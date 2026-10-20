import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalDevelopmentAdapter, localDevelopmentAllowed } from "@/auth/local-development";
import { createApiClient } from "@/api/http-client";
import { AuthProvider } from "@/auth/auth-provider";
import { AppRoutes } from "@/routes";

const env = { VITE_AUTH_MODE: "local-development", VITE_API_BASE_URL: "http://127.0.0.1:8000" };
afterEach(() => { sessionStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("explicit local backend fallback", () => {
  it("requires an explicit choice and never supplies a fabricated JWT", async () => {
    const adapter = createLocalDevelopmentAdapter(env, "http://localhost:5173", true, sessionStorage);
    expect(adapter.mode).toBe("local-development");
    expect(await adapter.initialize()).toBeNull();
    const listener = vi.fn(); adapter.subscribe(listener);
    await adapter.login("/jobs/new");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ subject: "local-user" }));
    await expect(adapter.getValidToken()).rejects.toThrow("does not issue a Cognito JWT");
    const fresh = createLocalDevelopmentAdapter(env, "http://localhost:5173", true, sessionStorage);
    expect(await fresh.initialize()).toMatchObject({ subject: "local-user" });
    await fresh.logout();
    expect(await fresh.initialize()).toBeNull();
  });
  it.each([
    [false, "http://localhost:5173", "http://127.0.0.1:8000"],
    [true, "https://app.example.invalid", "http://127.0.0.1:8000"],
    [true, "http://localhost:5173", "https://api.example.invalid"],
  ])("rejects unsupported environment DEV=%s frontend=%s backend=%s", (dev, origin, api) => {
    expect(() => createLocalDevelopmentAdapter({ ...env, VITE_API_BASE_URL: api }, origin as string, dev as boolean, sessionStorage)).toThrow("requires");
  });
  it("does not activate implicitly when Cognito configuration is absent", () => {
    expect(localDevelopmentAllowed({ VITE_API_BASE_URL: env.VITE_API_BASE_URL }, "http://localhost:5173", true)).toBe(false);
  });
  it("calls local backend with its fallback header and no bearer token", async () => {
    const getToken = vi.fn(async () => { throw new Error("Must not request a fake JWT"); });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const client = createApiClient({ baseUrl: env.VITE_API_BASE_URL, getValidToken: getToken, development: true, localDevelopment: true, fetcher });
    await client.request("/v1/jobs", { decode: (payload) => payload });
    expect(fetcher.mock.calls[0][1]!.headers).toEqual({ "X-User-Id": "local-user", Accept: "application/json" });
    expect(getToken).not.toHaveBeenCalled();
  });
  it.each([[false, "http://127.0.0.1:8000"], [true, "https://api.example.invalid"]])("blocks tokenless API access outside development loopback", (development, baseUrl) => {
    expect(() => createApiClient({ baseUrl: baseUrl as string, development: development as boolean, localDevelopment: true, getValidToken: async () => "" })).toThrow("restricted");
  });
  it("fails closed if a production build is configured for local development", async () => {
    vi.stubEnv("DEV", false); vi.stubEnv("PROD", true); vi.stubEnv("VITE_AUTH_MODE", "local-development");
    vi.resetModules();
    const { browserAuthAdapter } = await import("@/auth/browser-adapter");
    expect(browserAuthAdapter.canSignIn).toBe(false);
    expect(await browserAuthAdapter.initialize()).toBeNull();
    expect(browserAuthAdapter.configurationIssues.join(" ")).toContain("disabled in production");
  });
  it("enters the actual local workspace, labels fallback access and clears it on exit", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubEnv("VITE_AUTH_MODE", "local-development"); vi.stubEnv("VITE_API_BASE_URL", env.VITE_API_BASE_URL);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const adapter = createLocalDevelopmentAdapter(env, "http://localhost:5173", true, sessionStorage);
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    try {
      await act(async () => { root.render(<MemoryRouter initialEntries={["/jobs/new"]}><AuthProvider adapter={adapter}><AppRoutes /></AuthProvider></MemoryRouter>); });
      expect(container.textContent).toContain("No Cognito login or JWT verification");
      const find = (label: string) => [...container.querySelectorAll("button")].find((button) => button.textContent === label)!;
      await act(async () => { find("Continue in local development").click(); });
      expect(container.querySelector("h1")!.textContent).toBe("Create workflow");
      expect(container.textContent).toContain("Local fallback: local-user");
      expect(container.textContent).not.toContain("Signed in as");
      await act(async () => { find("Exit local workspace").click(); });
      expect(container.querySelector("h1")!.textContent).toBe("Sign in");
      expect(await adapter.initialize()).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
