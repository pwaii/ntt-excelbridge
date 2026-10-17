import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "@/routes";
import { AuthContext, type AuthContextValue } from "@/auth/context";

const testAuth: AuthContextValue = {
  state: { status: "authenticated", user: { subject: "unit-test-subject" } }, canSignIn: true,
  configurationIssues: [], login: async () => {}, logout: async () => {},
  getValidToken: async () => { throw new Error("Not used by route tests"); }, getReturnTo: () => "/jobs/new",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  act(() => root.render(<BrowserRouter><AuthContext.Provider value={testAuth}><AppRoutes /></AuthContext.Provider></BrowserRouter>));
}

function click(element: Element | null) {
  if (!element) throw new Error("Expected an interactive element");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
}

describe("application routing", () => {
  it.each([
    ["/login", "Sign in"],
    ["/jobs/new", "Create workflow"],
    ["/jobs/job-42", "Job progress"],
    ["/jobs/job-42/quality-review", "Quality review"],
    ["/jobs/job-42/transformation-review", "Transformation review"],
    ["/jobs/job-42/result", "Result"],
    ["/unknown", "Page not found"],
    ["/jobs/job-42/unknown", "Page not found"],
  ])("renders %s with a matching heading and title", (path, heading) => {
    renderAt(path);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe(heading);
    expect(document.title).toBe(`${heading} | XLSX Data Workflow`);
    expect(document.activeElement?.id).toBe("main-content");
    if (heading !== "Create workflow" && heading !== "Page not found" && heading !== "Sign in" && heading !== "Job progress") {
      expect(container.textContent).toContain("Coming soon");
      expect(container.textContent).toContain("is not implemented yet");
      expect(container.querySelector("form")).toBeNull();
    }
  });

  it("redirects the root to login without calling authentication services", () => {
    renderAt("/");
    expect(window.location.pathname).toBe("/login");
    expect(container.querySelector("h1")?.textContent).toBe("Sign in");
    expect(container.textContent).toContain("You’re signed in");
    expect(container.querySelector("form")).toBeNull();
  });

  it("keeps job navigation scoped to the current ID and marks only the exact active page", () => {
    renderAt("/jobs/customer%20report/quality-review");
    const navigation = container.querySelector('[aria-label="Desktop navigation"]');
    expect(navigation?.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(navigation?.querySelector('[aria-current="page"]')?.textContent).toBe("Quality review");
    expect(navigation?.querySelector('a[href="/jobs/customer%20report/result"]')).not.toBeNull();
    click(navigation?.querySelector('a[href="/jobs/customer%20report/result"]') ?? null);
    expect(window.location.pathname).toBe("/jobs/customer%20report/result");
    expect(container.querySelector("h1")?.textContent).toBe("Result");
    expect(navigation?.querySelector('[aria-current="page"]')?.textContent).toBe("Result");
  });

  it("does not invent a current job on workspace pages", () => {
    renderAt("/jobs/new");
    const links = container.querySelectorAll('[aria-label="Desktop navigation"] a');
    expect([...links].map((link) => link.getAttribute("href"))).toEqual(["/jobs/new", "/login"]);
  });

  it("opens mobile navigation and closes it after a client-side route change", () => {
    renderAt("/login");
    const menu = container.querySelector<HTMLButtonElement>('[aria-controls="mobile-navigation"]');
    const navigation = container.querySelector<HTMLElement>("#mobile-navigation");
    expect(navigation?.hidden).toBe(true);
    click(menu);
    expect(menu?.getAttribute("aria-expanded")).toBe("true");
    expect(navigation?.hidden).toBe(false);
    click(navigation?.querySelector('a[href="/jobs/new"]') ?? null);
    expect(window.location.pathname).toBe("/jobs/new");
    expect(container.querySelector("h1")?.textContent).toBe("Create workflow");
    expect(navigation?.hidden).toBe(true);
    expect(menu?.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes mobile navigation with Escape and restores focus to the toggle", () => {
    renderAt("/jobs/job-42");
    const menu = container.querySelector<HTMLButtonElement>('[aria-controls="mobile-navigation"]');
    click(menu);
    const navigation = container.querySelector<HTMLElement>("#mobile-navigation");
    const link = navigation?.querySelector<HTMLAnchorElement>("a");
    link?.focus();
    act(() => link?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(navigation?.hidden).toBe(true);
    expect(document.activeElement).toBe(menu);
  });
});
