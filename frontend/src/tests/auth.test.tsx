import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/auth-provider";
import { useAuth } from "@/auth/context";
import { AuthError, safeReturnTo, type AuthAdapter, type AuthUser } from "@/auth/types";
import { AppRoutes } from "@/routes";
import { readAuthConfig } from "@/auth/config";
import { createUnavailableAuthAdapter } from "@/auth/cognito-adapter";

const user: AuthUser = { subject: "mock-test-subject", name: "Test user", email: "test@example.invalid" };
let container: HTMLDivElement;
let root: Root;
let listener: (user: AuthUser | null) => void;

function adapter(patch: Partial<AuthAdapter> = {}): AuthAdapter {
  return {
    canSignIn: true, configurationIssues: [], initialize: vi.fn(async () => null),
    login: vi.fn(async () => {}), logout: vi.fn(async () => {}),
    getValidToken: vi.fn(async () => "unit-test-token"),
    subscribe: (callback) => { listener = callback; return () => {}; }, getReturnTo: () => "/jobs/new", ...patch,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn());
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function renderAt(path: string, auth: AuthAdapter) {
  window.history.replaceState(null, "", path);
  await act(async () => { root.render(<BrowserRouter><AuthProvider adapter={auth}><AppRoutes /></AuthProvider></BrowserRouter>); });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}

describe("authentication routing and UI", () => {
  it("introduces the product with a standard sign-in action and keeps provider details off the welcome page", async () => {
    await renderAt("/login", adapter());
    expect(container.textContent).toContain("Pilotxl");
    expect(container.textContent).toContain("review the proposed changes");
    expect(container.textContent).not.toContain("Cognito");
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("#sign-in")).not.toBeNull();
    expect([...container.querySelectorAll("button")].find((item) => item.textContent === "Sign in")?.disabled).toBe(false);
  });
  it.each(["/jobs/new", "/jobs/id", "/jobs/id/quality-review", "/jobs/id/transformation-review", "/jobs/id/result"])("protects %s without calling the backend", async (path) => {
    await renderAt(path, adapter());
    expect(window.location.pathname).toBe("/login");
    expect(container.querySelector("h1")?.textContent).toBe("Clear changes.Confident decisions.");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("renders the existing creation page for an authenticated user", async () => {
    await renderAt("/jobs/new", adapter({ initialize: async () => user }));
    expect(container.querySelector("h1")?.textContent).toBe("New job");
    expect(container.querySelector<HTMLInputElement>("#current-file")?.type).toBe("file");
    expect(container.textContent).toContain("Signed in as Test user");
  });
  it("waits for initialization without redirecting or showing protected content", async () => {
    let resolve!: (value: AuthUser | null) => void;
    await renderAt("/jobs/new", adapter({ initialize: () => new Promise((done) => { resolve = done; }) }));
    expect(window.location.pathname).toBe("/jobs/new");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Checking your session");
    expect(container.querySelector("form")).toBeNull();
    await act(async () => { resolve(null); });
    expect(window.location.pathname).toBe("/login");
  });
  it("reports initialization failures without exposing SDK/token details", async () => {
    await renderAt("/login", adapter({ initialize: async () => { throw new Error("SECRET_JWT_FROM_SDK"); } }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be initialized");
    expect(container.textContent).not.toContain("SECRET_JWT");
  });
  it("signs in with a safe return path and reports redirect failure", async () => {
    const auth = adapter({ login: vi.fn(async () => { throw new Error("private SDK response"); }) });
    await renderAt("/jobs/id/result", auth);
    await click("Sign in");
    expect(auth.login).toHaveBeenCalledWith("/jobs/id/result");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to sign in");
    expect(container.textContent).not.toContain("private SDK");
  });
  it("clears visible identity and protects the workspace on logout", async () => {
    const auth = adapter({ initialize: async () => user });
    await renderAt("/jobs/new", auth);
    await click("Sign out");
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/login");
    expect(container.textContent).not.toContain("Signed in as Test user");
  });
  it("redirects an expired provider session back to sign in", async () => {
    await renderAt("/jobs/new", adapter({ initialize: async () => user }));
    await act(async () => { listener(null); });
    expect(window.location.pathname).toBe("/login");
  });
  it("handles the callback without redirect loops", async () => {
    const auth = adapter({ initialize: async () => user, getReturnTo: () => "/jobs/id/result" });
    await renderAt("/auth/callback", auth);
    expect(window.location.pathname).toBe("/jobs/id");
    expect(container.querySelector("h1")?.textContent).toBe("Job progress");
  });
  it("shows a safe failed-callback recovery action", async () => {
    await renderAt("/auth/callback", adapter());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No sign-in response");
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });
  it("fails closed when settings are missing, including in production", async () => {
    const settings = readAuthConfig({}, "https://app.example.invalid", false);
    const auth = createUnavailableAuthAdapter(settings.issues);
    await renderAt("/jobs/new", auth);
    expect(window.location.pathname).toBe("/login");
    expect([...container.querySelectorAll("button")].find((item) => item.textContent === "Sign in")?.disabled).toBe(true);
    expect(container.textContent).toContain("Missing VITE_COGNITO_AUTHORITY");
    await expect(auth.getValidToken()).rejects.toThrow("not configured");
  });
});

describe("token retrieval through the provider", () => {
  function Probe() {
    const auth = useAuth();
    return <><span>{auth.state.status}</span><button onClick={() => { void auth.getValidToken().catch(() => {}); }}>Get token</button></>;
  }
  it("delegates token retrieval without rendering the token", async () => {
    const auth = adapter({ initialize: async () => user });
    await act(async () => { root.render(<AuthProvider adapter={auth}><Probe /></AuthProvider>); });
    await click("Get token");
    expect(auth.getValidToken).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("unit-test-token");
  });
  it("sanitizes expired-session/token failures and drops authenticated state", async () => {
    const auth = adapter({ initialize: async () => user, getValidToken: async () => { throw new AuthError("Your session has expired. Sign in again."); } });
    await act(async () => { root.render(<AuthProvider adapter={auth}><Probe /></AuthProvider>); });
    await click("Get token");
    expect(container.textContent).toContain("error");
  });
});

describe("configuration and return targets", () => {
  const valid = {
    VITE_COGNITO_AUTHORITY: "https://cognito-idp.us-east-1.amazonaws.com/mock-pool",
    VITE_COGNITO_DOMAIN: "https://mock.auth.us-east-1.amazoncognito.com",
    VITE_COGNITO_CLIENT_ID: "mock-client-id",
    VITE_COGNITO_REDIRECT_URI: "http://127.0.0.1:5173/auth/callback",
    VITE_COGNITO_LOGOUT_URI: "http://127.0.0.1:5173/login",
  };
  it("does not infer an API token type and supports the existing client ID alias", () => {
    const result = readAuthConfig({ ...valid, VITE_COGNITO_CLIENT_ID: "", VITE_COGNITO_APP_CLIENT_ID: "alias" }, "http://127.0.0.1:5173", true);
    expect(result.config?.clientId).toBe("alias");
    expect(result.config?.apiTokenType).toBeNull();
  });
  it("rejects insecure production redirect URLs and cross-origin callbacks", () => {
    expect(readAuthConfig(valid, "http://127.0.0.1:5173", false).config).toBeNull();
    expect(readAuthConfig({ ...valid, VITE_COGNITO_REDIRECT_URI: "https://elsewhere.invalid/auth/callback" }, "http://127.0.0.1:5173", true).config).toBeNull();
  });
  it.each(["https://evil.invalid", "//evil.invalid", "/auth/callback", "/login", "/jobs/new?token=secret", "/jobs/\\evil"])("rejects unsafe return target %s", (target) => {
    expect(safeReturnTo(target)).toBe("/jobs/new");
  });
});
