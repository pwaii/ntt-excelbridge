# Progress Page Stepper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-tab job navigation with a single `/jobs/:id` route containing a horizontal circle stepper that drives inline stage detail panels.

**Architecture:** `ConnectedJobStatus` retains all polling/data-fetching logic and gains `selected`/`seen` state to drive a new `WorkflowStepper` circle component and mount-once/hide detail panels for the three review pages. `JobTabsLayout` is deleted; three old sub-routes become `<Navigate>` redirects. The sidebar `JobNavGroup` collapses to a single link.

**Tech Stack:** React 18, React Router v6, Vitest, raw `createRoot`/`act` tests (no @testing-library), Lucide icons, CSS custom properties.

---

## File map

| Action | File | Purpose |
|--------|------|---------|
| Create | `frontend/src/components/job/workflow-stepper.tsx` | Pure circle-stepper component (circles, connectors, click handler) |
| Create | `frontend/src/tests/workflow-stepper.test.tsx` | Unit tests for the stepper |
| Modify | `frontend/src/components/job/job-timeline.tsx` | Export `messages` record |
| Modify | `frontend/src/components/job/connected-job-status.tsx` | Replace JobTimeline/CompletedJobOutput with stepper + panels |
| Modify | `frontend/src/pages/job-progress-page.tsx` | Add `<h1 className="sr-only">Job progress</h1>` |
| Modify | `frontend/src/routes/route-config.ts` | Remove `jobNavigation`, update `getPageTitle` |
| Modify | `frontend/src/routes/index.tsx` | Swap `JobTabsLayout` for `JobProgressPage` + 3 redirect routes |
| Modify | `frontend/src/components/layout/app-layout.tsx` | Collapse `JobNavGroup` to single link |
| Modify | `frontend/src/tests/routing.test.tsx` | Update for single route, redirects, no sub-links |
| Modify | `frontend/src/tests/job-polling.test.tsx` | Update terminal-state assertions |
| Modify | `frontend/src/index.css` | Add stepper CSS |
| Delete | `frontend/src/components/layout/job-tabs-layout.tsx` | Replaced by the new page/panel model |

---

## Task 1: Export `messages` from `job-timeline.tsx`

**Files:**
- Modify: `frontend/src/components/job/job-timeline.tsx:7`

- [ ] **Step 1: Change `const messages` to `export const messages`**

In `frontend/src/components/job/job-timeline.tsx` line 7, change:
```typescript
const messages: Record<string, [string, string]> = {
```
to:
```typescript
export const messages: Record<string, [string, string]> = {
```

- [ ] **Step 2: Run tests to confirm no breakage**

```
cd frontend && npx vitest run
```
Expected: all tests pass (no test imports `messages` yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/job/job-timeline.tsx
git commit -m "feat: export messages record from job-timeline for reuse"
```

---

## Task 2: `WorkflowStepper` component — failing test

**Files:**
- Create: `frontend/src/tests/workflow-stepper.test.tsx`

- [ ] **Step 1: Create the test file**

Create `frontend/src/tests/workflow-stepper.test.tsx`:

```typescript
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowStepper } from "@/components/job/workflow-stepper";
import type { StageState } from "@/lib/job-stages";

type StepperStage = { label: string; state: StageState };

const fiveStages: StepperStage[] = [
  { label: "Setup", state: "complete" },
  { label: "Data", state: "complete" },
  { label: "Quality", state: "active" },
  { label: "Changes", state: "pending" },
  { label: "Output", state: "pending" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

function render(stages: StepperStage[], selected: number, onSelect = vi.fn()) {
  act(() => root.render(<WorkflowStepper stages={stages} selected={selected} onSelect={onSelect} />));
}

describe("WorkflowStepper", () => {
  it("renders five tabs with correct aria-selected", () => {
    render(fiveStages, 2);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(5);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
  });

  it("complete and active tabs are enabled; pending tabs are disabled", () => {
    render(fiveStages, 2);
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs[0].disabled).toBe(false); // complete
    expect(tabs[1].disabled).toBe(false); // complete
    expect(tabs[2].disabled).toBe(false); // active
    expect(tabs[3].disabled).toBe(true);  // pending
    expect(tabs[4].disabled).toBe(true);  // pending
  });

  it("clicking a complete tab calls onSelect with its index", () => {
    const onSelect = vi.fn();
    render(fiveStages, 2, onSelect);
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => tabs[0].click());
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("clicking the active tab calls onSelect with its index", () => {
    const onSelect = vi.fn();
    render(fiveStages, 2, onSelect);
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => tabs[2].click());
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("renders 4 connectors for 5 stages", () => {
    render(fiveStages, 2);
    expect(container.querySelectorAll(".step-connector")).toHaveLength(4);
  });

  it("connector left of complete stage has data-left=complete", () => {
    render(fiveStages, 2);
    const connectors = container.querySelectorAll(".step-connector");
    expect(connectors[0].getAttribute("data-left")).toBe("complete"); // after Setup(complete)
    expect(connectors[1].getAttribute("data-left")).toBe("complete"); // after Data(complete)
    expect(connectors[2].getAttribute("data-left")).toBe("active");   // after Quality(active)
    expect(connectors[3].getAttribute("data-left")).toBe("pending");  // after Changes(pending)
  });

  it("failed stage tab is enabled and has aria-label containing its state", () => {
    const stages: StepperStage[] = [
      { label: "Setup", state: "complete" },
      { label: "Data", state: "failed" },
      { label: "Quality", state: "pending" },
      { label: "Changes", state: "pending" },
      { label: "Output", state: "pending" },
    ];
    render(stages, 1);
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs[1].disabled).toBe(false);
    expect(tabs[1].getAttribute("aria-label")).toContain("failed");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail** (component doesn't exist yet)

```
cd frontend && npx vitest run workflow-stepper
```
Expected: FAIL — `Cannot find module '@/components/job/workflow-stepper'`

---

## Task 3: `WorkflowStepper` component implementation

**Files:**
- Create: `frontend/src/components/job/workflow-stepper.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/job/workflow-stepper.tsx`:

```typescript
import { Fragment } from "react";
import { Check, CircleDot, AlertCircle } from "lucide-react";
import type { StageState } from "@/lib/job-stages";

type StepperStage = { label: string; state: StageState };

export function WorkflowStepper({ stages, selected, onSelect }: {
  stages: StepperStage[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="stepper-row" role="tablist" aria-label="Workflow stages">
      {stages.map((stage, i) => {
        const interactive = stage.state === "complete" || stage.state === "active" || stage.state === "failed";
        return (
          <Fragment key={stage.label}>
            {i > 0 && (
              <div className="step-connector" data-left={stages[i - 1].state} aria-hidden="true" />
            )}
            <div className="stepper-item">
              <button
                role="tab"
                type="button"
                aria-selected={i === selected}
                aria-label={`${stage.label}: ${stage.state}`}
                className={`stepper-node step-${stage.state}`}
                disabled={!interactive}
                onClick={() => onSelect(i)}
              >
                {stage.state === "complete" && <Check size={16} aria-hidden="true" />}
                {stage.state === "active" && <CircleDot size={16} aria-hidden="true" />}
                {stage.state === "failed" && <AlertCircle size={16} aria-hidden="true" />}
              </button>
              <span className="stepper-label" aria-hidden="true">{stage.label}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```
cd frontend && npx vitest run workflow-stepper
```
Expected: all 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/job/workflow-stepper.tsx frontend/src/tests/workflow-stepper.test.tsx
git commit -m "feat: add WorkflowStepper component with circle-and-connector layout"
```

---

## Task 4: Stepper CSS

**Files:**
- Modify: `frontend/src/index.css`

Find the existing `.workflow-phases` / `.workflow-status` block (around line 244) and add the new stepper rules after it.

- [ ] **Step 1: Add stepper CSS**

In `frontend/src/index.css`, find the comment `/* Job progress:` and add the following block immediately after the existing `.workflow-status` / `.workflow-phases` rules (before the next unrelated section):

```css
  /* Horizontal circle stepper */
  .stepper-row {
    display: flex;
    align-items: flex-start;
    padding: 24px 0 8px;
    gap: 0;
  }
  .stepper-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .stepper-node {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 9999px;
    border: 2px solid var(--border);
    background: transparent;
    color: var(--muted-foreground);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: default;
    transition: box-shadow 0.15s;
  }
  .stepper-node.step-complete {
    background: var(--success);
    border-color: var(--success);
    color: white;
    cursor: pointer;
  }
  .stepper-node.step-active {
    background: var(--workflow-accent);
    border-color: var(--workflow-accent);
    color: white;
    cursor: pointer;
  }
  .stepper-node.step-failed {
    background: var(--destructive);
    border-color: var(--destructive);
    color: white;
    cursor: pointer;
  }
  .stepper-node[aria-selected="true"] {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--workflow-accent) 30%, transparent);
  }
  .stepper-label {
    font-size: 11px;
    color: var(--muted-foreground);
    text-align: center;
    max-width: 5rem;
    line-height: 1.3;
  }
  .step-connector {
    flex: 1;
    align-self: flex-start;
    margin-top: 1.1875rem; /* half of 2.5rem node height */
    border-top: 2px dashed var(--border);
    min-width: 1rem;
  }
  .step-connector[data-left="complete"] {
    border-top-style: solid;
    border-top-color: var(--success);
  }
  .step-connector[data-left="active"] {
    border-top-style: solid;
    border-top-color: var(--border);
  }
  .stepper-panel {
    padding: 16px 0 8px;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }
  .stage-detail { padding: 4px 0; }
  .stage-detail h3 { font-size: 1rem; font-weight: 600; margin-bottom: 4px; }
  .stage-detail p { font-size: 0.875rem; color: var(--muted-foreground); }
```

- [ ] **Step 2: Run tests**

```
cd frontend && npx vitest run
```
Expected: all tests pass (CSS changes don't affect tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add stepper CSS for horizontal circle stepper"
```

---

## Task 5: Routing — remove sub-routes, add redirects

**Files:**
- Modify: `frontend/src/routes/route-config.ts`
- Modify: `frontend/src/routes/index.tsx`

- [ ] **Step 1: Rewrite `route-config.ts`**

Replace entire `frontend/src/routes/route-config.ts` with:

```typescript
import { matchPath } from "react-router-dom";

export function getPageTitle(pathname: string) {
  if (matchPath("/auth/callback", pathname)) return "Completing sign in";
  if (matchPath("/login", pathname) || pathname === "/") return "Sign in";
  if (matchPath("/jobs/new", pathname)) return "Create workflow";
  if (matchPath("/jobs/:id/*", pathname)) return "Job progress";
  return "Page not found";
}
```

- [ ] **Step 2: Rewrite `routes/index.tsx`**

Replace entire `frontend/src/routes/index.tsx` with:

```typescript
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { JobProgressPage } from "@/pages/job-progress-page";
import { CreateJobPage } from "@/pages/create-job-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { SignInPage } from "@/pages/sign-in-page";
import { getPageTitle } from "@/routes/route-config";
import { ProtectedRoute } from "@/auth/protected-route";
import { AuthCallbackPage } from "@/pages/auth-callback-page";

function RedirectToJob() {
  const { id } = useParams<"id">();
  return <Navigate to={`/jobs/${encodeURIComponent(id!)}`} replace />;
}

export function AppRoutes() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${getPageTitle(pathname)} | Pilotxl`;
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<SignInPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/jobs/new" element={<CreateJobPage />} />
          <Route path="/jobs/:id/quality-review" element={<RedirectToJob />} />
          <Route path="/jobs/:id/transformation-review" element={<RedirectToJob />} />
          <Route path="/jobs/:id/result" element={<RedirectToJob />} />
          <Route path="/jobs/:id/*" element={<JobProgressPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 3: Run tests** (routing tests will fail — expected at this point)

```
cd frontend && npx vitest run routing
```
Expected: several routing test failures (sub-route h1/title assertions, sidebar sub-link assertions).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/route-config.ts frontend/src/routes/index.tsx
git commit -m "feat: collapse job routing to single /jobs/:id route with sub-route redirects"
```

---

## Task 6: Sidebar — collapse `JobNavGroup` to single link

**Files:**
- Modify: `frontend/src/components/layout/app-layout.tsx`

- [ ] **Step 1: Simplify `JobNavGroup` and remove `jobNavigation` import**

In `frontend/src/components/layout/app-layout.tsx`, replace the entire `JobNavGroup` function and update the import:

Remove line 7:
```typescript
import { jobNavigation } from "@/routes/route-config";
```

Replace lines 14–21 (`function JobNavGroup`):
```typescript
// Before:
function JobNavGroup({ jobId, activeJobId, onNavigate }: { jobId: string; activeJobId?: string; onNavigate?: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) => cn("nav-link", isActive && "nav-link-active");
  const isActive = jobId === activeJobId;
  return <div className="job-navigation">
    <p className="nav-group-label">Workflow {jobId.slice(0, 8)}</p>
    {isActive && jobNavigation.map(({ suffix, label, icon: Icon }) => <NavLink key={suffix} to={`/jobs/${encodeURIComponent(jobId)}${suffix}`} end className={linkClass} onClick={onNavigate}><Icon aria-hidden="true" />{label}</NavLink>)}
    {!isActive && <NavLink to={`/jobs/${encodeURIComponent(jobId)}`} end className={linkClass} onClick={onNavigate}>View workflow</NavLink>}
  </div>;
}
```

```typescript
// After:
function JobNavGroup({ jobId, onNavigate }: { jobId: string; onNavigate?: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) => cn("nav-link", isActive && "nav-link-active");
  return <div className="job-navigation">
    <NavLink to={`/jobs/${encodeURIComponent(jobId)}`} className={linkClass} onClick={onNavigate}>
      Workflow {jobId.slice(0, 8)}
    </NavLink>
  </div>;
}
```

Also update `Navigation` (line 23) to remove the `activeJobId` prop from `JobNavGroup`:

```typescript
// Before:
{jobIds.map(id => <JobNavGroup key={id} jobId={id} activeJobId={jobId} onNavigate={onNavigate} />)}

// After:
{jobIds.map(id => <JobNavGroup key={id} jobId={id} onNavigate={onNavigate} />)}
```

Also remove `{ id: jobId }` from the `Navigation` props signature (it no longer needs `jobId`):

```typescript
// Before:
function Navigation({ jobId, jobIds, onNavigate }: { jobId?: string; jobIds: string[]; onNavigate?: () => void }) {

// After:
function Navigation({ jobIds, onNavigate }: { jobIds: string[]; onNavigate?: () => void }) {
```

And update both `Navigation` usages in `AppLayout` to remove `jobId={jobId}`:
```typescript
// Line 46 before:
<nav aria-label="Desktop navigation" className="desktop-navigation"><Navigation jobId={jobId} jobIds={jobIds} /></nav>
// After:
<nav aria-label="Desktop navigation" className="desktop-navigation"><Navigation jobIds={jobIds} /></nav>

// Line 57 before:
<nav id="mobile-navigation" ... ><Navigation jobId={jobId} jobIds={jobIds} onNavigate={...} />...
// After:
<nav id="mobile-navigation" ... ><Navigation jobIds={jobIds} onNavigate={...} />...
```

- [ ] **Step 2: Run tests**

```
cd frontend && npx vitest run routing
```
Expected: more tests pass now; sidebar sub-link test still failing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/app-layout.tsx
git commit -m "feat: collapse sidebar JobNavGroup to single workflow link"
```

---

## Task 7: Update routing tests

**Files:**
- Modify: `frontend/src/tests/routing.test.tsx`

- [ ] **Step 1: Rewrite `routing.test.tsx`**

Replace entire `frontend/src/tests/routing.test.tsx` with:

```typescript
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
  vi.stubEnv("VITE_API_BASE_URL", "");
  vi.stubEnv("VITE_COGNITO_API_TOKEN_TYPE", "");
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
  vi.unstubAllEnvs();
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
    ["/jobs/new", "New job"],
    ["/jobs/job-42", "Job progress"],
    ["/jobs/job-42/quality-review", "Job progress"],      // redirects
    ["/jobs/job-42/transformation-review", "Job progress"], // redirects
    ["/jobs/job-42/result", "Job progress"],              // redirects
    ["/jobs/job-42/unknown", "Job progress"],             // wildcard catch
    ["/unknown", "Page not found"],
  ])("renders %s with a matching heading and title", (path, heading) => {
    renderAt(path);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe(heading);
    expect(document.title).toBe(`${heading} | Pilotxl`);
    expect(document.activeElement?.id).toBe("main-content");
  });

  it("redirects the root to login without calling authentication services", () => {
    renderAt("/");
    expect(window.location.pathname).toBe("/login");
    expect(container.querySelector("h1")?.textContent).toBe("Sign in");
    expect(container.textContent).toContain("You're signed in");
    expect(container.querySelector("form")).toBeNull();
  });

  it("shows a single workflow link per job with no sub-links", () => {
    renderAt("/jobs/customer%20report");
    const navigation = container.querySelector('[aria-label="Desktop navigation"]');
    const jobLink = navigation?.querySelector('a[href="/jobs/customer%20report"]');
    expect(jobLink).not.toBeNull();
    expect(jobLink?.getAttribute("aria-current")).toBe("page");
    expect(navigation?.querySelector('a[href*="quality-review"]')).toBeNull();
    expect(navigation?.querySelector('a[href*="transformation-review"]')).toBeNull();
    expect(navigation?.querySelector('a[href*="result"]')).toBeNull();
  });

  it("does not invent a current job on workspace pages", () => {
    renderAt("/jobs/new");
    const links = container.querySelectorAll('[aria-label="Desktop navigation"] a');
    expect([...links].map((link) => link.getAttribute("href"))).toEqual(["/jobs/new", "/login"]);
  });

  it("opens mobile navigation and closes it after a client-side route change", () => {
    renderAt("/jobs/job-42");
    const menu = container.querySelector<HTMLButtonElement>('[aria-controls="mobile-navigation"]');
    const navigation = container.querySelector<HTMLElement>("#mobile-navigation");
    expect(navigation?.hidden).toBe(true);
    click(menu);
    expect(menu?.getAttribute("aria-expanded")).toBe("true");
    expect(navigation?.hidden).toBe(false);
    click(navigation?.querySelector('a[href="/jobs/new"]') ?? null);
    expect(window.location.pathname).toBe("/jobs/new");
    expect(container.querySelector("h1")?.textContent).toBe("New job");
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
```

- [ ] **Step 2: Run routing tests**

```
cd frontend && npx vitest run routing
```
Expected: all routing tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tests/routing.test.tsx
git commit -m "test: update routing tests for single-route job navigation"
```

---

## Task 8: Update `JobProgressPage` — add h1

**Files:**
- Modify: `frontend/src/pages/job-progress-page.tsx`

- [ ] **Step 1: Add `<h1 className="sr-only">Job progress</h1>`**

Replace the full file content:

```typescript
import { useContext } from "react";
import { useParams } from "react-router-dom";
import { AuthContext } from "@/auth/context";
import { ConnectedJobStatus } from "@/components/job/connected-job-status";

export function JobProgressPage() {
  const auth = useContext(AuthContext);
  const { id } = useParams();
  return <section aria-labelledby="job-progress-heading" className="engagement-progress">
    <h1 id="job-progress-heading" className="sr-only">Job progress</h1>
    {auth && id ? <ConnectedJobStatus jobId={id} /> : <p className="mt-5 text-sm text-muted-foreground">Sign in to read the backend job status.</p>}
  </section>;
}
```

- [ ] **Step 2: Run all tests**

```
cd frontend && npx vitest run
```
Expected: all tests pass (routing tests now find the h1).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/job-progress-page.tsx
git commit -m "feat: add sr-only h1 to JobProgressPage for accessible heading"
```

---

## Task 9: Update `ConnectedJobStatus` — stepper + panels

This is the largest change. `ConnectedJobStatus` keeps all fetching/polling/retry/error logic unchanged. It replaces `JobTimeline` and `CompletedJobOutput` with `WorkflowStepper` + detail panels.

**Files:**
- Modify: `frontend/src/components/job/connected-job-status.tsx`

- [ ] **Step 1: Rewrite `connected-job-status.tsx`**

Replace the full file content:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { ApiError } from "@/api/errors";
import type { BackendJob } from "@/api/jobs-api";
import { Button } from "@/components/ui/button";
import { WorkflowLoading } from "@/components/ui/workflow-loading";
import { workflowConfigurationSchema } from "@/schemas/job-creation";
import { createMetadataFlow } from "@/metadata/controller";
import { createBackendMetadataAdapter } from "@/metadata/backend-adapter";
import { PostUploadConfiguration } from "./post-upload-configuration";
import { WorkflowStepper } from "./workflow-stepper";
import { messages } from "./job-timeline";
import { jobStages } from "@/lib/job-stages";
import { QualityReviewPage } from "@/pages/quality-review-page";
import { TransformationReviewPage } from "@/pages/transformation-review-page";
import { ResultPage } from "@/pages/result-page";
import { RefreshCw } from "lucide-react";

// Real status reconciliation with capped polling and server-owned workflow state.
export function ConnectedJobStatus({ jobId }: { jobId: string }) {
  const auth = useAuth();
  const getToken = useRef(auth.getValidToken); getToken.current = auth.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => getToken.current(), import.meta.env.DEV), []);
  const [job, setJob] = useState<BackendJob>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [observed, setObserved] = useState<string[]>([]);
  const [selected, setSelected] = useState(-1);
  const [seen, setSeen] = useState(new Set<number>());
  const active = useRef<AbortController>();
  const delay = useRef(2000);
  const autoSelected = useRef(false);
  const ready = auth.state.status === "authenticated" && auth.configurationIssues.length === 0 && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));
  const load = useCallback(async () => {
    if (!services.api || !ready || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(undefined);
    try {
      const result = await services.api.getJob(jobId, controller.signal);
      if (!controller.signal.aborted) { setJob(result.job); setObserved((previous) => previous.includes(result.job.status) ? previous : [...previous, result.job.status]); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof ApiError ? `${failure.message}${failure.requestId ? ` Request ID: ${failure.requestId}` : ""}` : "Job status could not be loaded.");
    } finally {
      if (active.current === controller) active.current = undefined;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [services, ready, jobId]);
  useEffect(() => {
    delay.current = 2000;
    autoSelected.current = false;
    setJob(undefined);
    setObserved([]);
    setSelected(-1);
    setSeen(new Set());
    void load();
    return () => { const controller = active.current; active.current = undefined; controller?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!job || !["FORMULA_REVIEW_PENDING", "INSPECTING", "DETECTED", "APPLYING", "VALIDATING_OUTPUT", "NORMALIZATION_PENDING", "STANDARDIZATION_PENDING", "UPDATE_PENDING"].includes(job.status) || error) return;
    const timer = setTimeout(() => { delay.current = Math.min(15_000, delay.current * 2); void load(); }, delay.current);
    return () => clearTimeout(timer);
  }, [job, error, load]);
  // Auto-select active stage on first job load.
  useEffect(() => {
    if (!job || autoSelected.current) return;
    autoSelected.current = true;
    const stgs = jobStages(job, observed);
    const idx = stgs.findIndex(s => s.state === "active" || s.state === "failed");
    const first = idx >= 0 ? idx : stgs.reduce((best, s, i) => s.state === "complete" ? i : best, -1);
    if (first >= 0) { setSelected(first); setSeen(new Set(first >= 2 ? [first] : [])); }
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps
  const resumeFlow = useMemo(() => {
    if (!job || job.status !== "UPLOADED" || !services.api) return undefined;
    const config = workflowConfigurationSchema.safeParse({ comment_name: job.config.comment_name, outputHeader: job.config.output_header, standardize: job.config.standardize, update: job.config.update });
    const currentRoles = Object.keys(job.files ?? {}).filter((slot) => slot === "input" || /^input_[2-8]$/.test(slot)).sort((a, b) => a === "input" ? -1 : b === "input" ? 1 : Number(a.slice(6)) - Number(b.slice(6))).map((slot) => slot === "input" ? "current" : `current_${slot.slice(6)}` as `current_${number}`);
    return config.success ? createMetadataFlow(jobId, config.data, createBackendMetadataAdapter(services.api), currentRoles) : undefined;
  }, [job, jobId, services]);
  async function retry() {
    if (!services.api || !ready || active.current || job?.status !== "FAILED" || error) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(undefined);
    try {
      const result = await services.api.retryJob(jobId, controller.signal);
      if (!controller.signal.aborted) { setJob(result.job); setObserved((previous) => previous.includes(result.job.status) ? previous : [...previous, result.job.status]); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof ApiError ? `${failure.message} Refresh job status before trying another retry.` : "The retry outcome is unknown. Refresh job status before trying again.");
    } finally {
      if (active.current === controller) active.current = undefined;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function handleSelect(i: number) {
    setSelected(i);
    if (i >= 2) setSeen(prev => { const next = new Set(prev); next.add(i); return next; });
  }
  const stages = job ? jobStages(job, observed) : [];
  const msg = job ? (messages[job.status] ?? ["Checking workflow status", "Refresh this page to check for updates."]) : null;
  const completedCopy: Record<string, [string, string]> = {
    setup: ["Setup complete", "Your workbooks are ready."],
    inspect: ["Data check complete", "No blocking issues were found."],
  };
  return <section aria-labelledby="backend-job-status" className="job-workspace">
    <div className="workspace-toolbar"><h2 id="backend-job-status" className="sr-only">Job details</h2><span className="truncate text-xs text-muted-foreground">{job?.files?.input?.filename ?? "Connecting to your workflow"}</span><Button type="button" variant="ghost" size="sm" disabled={!ready || !services.api || loading} aria-busy={loading} onClick={() => { void load(); }}><RefreshCw aria-hidden="true" />Refresh job status</Button></div>
    {!ready && <p role="note" className="notice">Sign in to load this workflow. If it remains unavailable, check your connection settings.</p>}
    {loading && !job && <WorkflowLoading label="Loading your workflow..." />}
    {error && <p role="alert" className="notice notice-error break-words">{error}</p>}
    {job && <>
      <WorkflowStepper stages={stages} selected={selected} onSelect={handleSelect} />
      <div className="stepper-panel">
        {selected === 0 && (
          <div className="stage-detail">
            {stages[0]?.state === "complete"
              ? <><h3>{completedCopy.setup[0]}</h3><p>{completedCopy.setup[1]}</p></>
              : <><h3>{msg?.[0]}</h3><p>{msg?.[1]}</p></>}
            {resumeFlow && <PostUploadConfiguration flow={resumeFlow} onStarted={() => { void load(); }} />}
          </div>
        )}
        {selected === 1 && (
          <div className="stage-detail">
            {stages[1]?.state === "complete"
              ? <><h3>{completedCopy.inspect[0]}</h3><p>{completedCopy.inspect[1]}</p></>
              : <><h3>{msg?.[0]}</h3><p>{msg?.[1]}</p></>}
          </div>
        )}
        {seen.has(2) && <div hidden={selected !== 2}><QualityReviewPage /></div>}
        {seen.has(3) && <div hidden={selected !== 3}><TransformationReviewPage /></div>}
        {seen.has(4) && <div hidden={selected !== 4}><ResultPage /></div>}
      </div>
    </>}
    {job?.error_code && <div role="alert" className="notice notice-error"><p className="font-medium">Processing needs attention</p>{job.error_detail && <p className="mt-1 break-words">{job.error_detail}</p>}<details className="mt-2 text-xs"><summary className="cursor-pointer">Error details</summary><p className="mt-2 break-all">{job.error_code}</p></details></div>}
    {job?.status === "FAILED" && <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={!ready || !services.api || loading || Boolean(error)} onClick={() => { void retry(); }}>Retry failed processing</Button><p className="text-xs text-muted-foreground">No need to upload again.</p></div>}
    {job && <details className="section-disclosure"><summary>Workflow details</summary><dl className="job-context"><div><dt>Requested column</dt><dd>{job.config.output_header || job.config.comment_name}</dd></div><div><dt>Worksheet</dt><dd>{job.config.input_sheet || job.workbook_selections?.input?.sheet_name || "Not reported"}</dd></div><div><dt>Last updated</dt><dd><time dateTime={job.updated_at}>{new Date(job.updated_at).toLocaleString()}</time></dd></div></dl><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
      {Object.entries(job.files ?? {}).map(([slot, file]) => <div key={slot}><dt className="text-xs text-muted-foreground">{slot === "main" ? "Main workbook" : `Current workbook${slot === "input" ? " 1" : ` ${slot.slice(6)}`}`}</dt><dd className="mt-1 break-all">{file.filename}</dd><dd className="mt-1 text-xs text-muted-foreground">{file.uploaded ? "Upload confirmed" : "Upload not confirmed"}</dd></div>)}
      <div><dt className="text-xs text-muted-foreground">Job ID</dt><dd className="mt-1 break-all">{jobId}</dd></div><div><dt className="text-xs text-muted-foreground">Server status / revision</dt><dd className="mt-1 break-all">{job.status} / {job.revision}</dd></div>
    </dl></details>}
  </section>;
}
```

- [ ] **Step 2: Run all tests**

```
cd frontend && npx vitest run
```
Expected: `job-polling.test.tsx` will fail on QUALITY_REVIEW_PENDING and TRANSFORMATION_REVIEW_PENDING assertions — those still reference the old sub-route links. Fix in the next step.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/job/connected-job-status.tsx
git commit -m "feat: replace JobTimeline with WorkflowStepper and inline stage panels"
```

---

## Task 10: Update `job-polling.test.tsx`

**Files:**
- Modify: `frontend/src/tests/job-polling.test.tsx`

- [ ] **Step 1: Read current failing assertions**

In `job-polling.test.tsx` lines 29–33, these assertions check sub-route links that no longer exist:

```typescript
// OLD — to be replaced:
if (terminal === "QUALITY_REVIEW_PENDING") {
  expect(container.querySelector('a[href$="/quality-review"]')?.textContent).toBe("Review data quality");
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Quality review");
} else if (terminal === "TRANSFORMATION_REVIEW_PENDING") expect(container.querySelector('a[href$="/transformation-review"]')?.textContent).toBe("Review transformations");
else expect(container.textContent).toContain(terminal);
```

- [ ] **Step 2: Replace lines 29–33 with stepper assertions**

Replace that block with:

```typescript
if (terminal === "QUALITY_REVIEW_PENDING") {
  const selectedTab = [...container.querySelectorAll('[role="tab"]')].find(t => t.getAttribute("aria-selected") === "true");
  expect(selectedTab?.getAttribute("aria-label")).toContain("Quality review");
  expect(container.querySelector('a[href$="/quality-review"]')).toBeNull();
} else if (terminal === "TRANSFORMATION_REVIEW_PENDING") {
  const selectedTab = [...container.querySelectorAll('[role="tab"]')].find(t => t.getAttribute("aria-selected") === "true");
  expect(selectedTab?.getAttribute("aria-label")).toContain("Review changes");
  expect(container.querySelector('a[href$="/transformation-review"]')).toBeNull();
} else {
  expect(container.textContent).toContain(terminal);
}
```

- [ ] **Step 3: Run all tests**

```
cd frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/tests/job-polling.test.tsx
git commit -m "test: update job-polling assertions for stepper stage selection"
```

---

## Task 11: Delete `job-tabs-layout.tsx`

**Files:**
- Delete: `frontend/src/components/layout/job-tabs-layout.tsx`

- [ ] **Step 1: Delete the file**

```bash
rm frontend/src/components/layout/job-tabs-layout.tsx
```

- [ ] **Step 2: Verify no remaining imports**

```bash
cd frontend && grep -r "job-tabs-layout\|JobTabsLayout" src/
```
Expected: no output (all references removed in Task 5).

- [ ] **Step 3: Run full test suite**

```
cd frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/components/layout/job-tabs-layout.tsx
git commit -m "feat: remove JobTabsLayout — replaced by single-route stepper model"
```

---

## Self-review

### Spec coverage

| Spec section | Covered by task |
|---|---|
| §1 Single sidebar link | Task 6 |
| §2 Five-stage circle stepper, color states, icons | Task 2+3+4 |
| §2 Connectors (flexbox spacer, color by left-stage state) | Task 3+4 |
| §2 Pending non-interactive, active/complete interactive | Task 2+3 |
| §2 Auto-select active stage on load | Task 9 |
| §3 Non-review stage panels (messages + fixed complete copy) | Task 9 |
| §3 Review stage panels (QualityReviewPage, TransformationReviewPage, ResultPage) | Task 9 |
| §3 Mount-once/hide for review panels | Task 9 |
| §4 Single `/jobs/:id` route | Task 5 |
| §4 Three sub-route redirects | Task 5 |
| §4 JobTabsLayout removed | Task 11 |
| §4 routing.test.tsx updated | Task 7 |
| §4 quality-ui / transformation-ui tests unchanged (mount location change only) | Verified — those tests import components directly, not via routing |
| §5 h1 added to JobProgressPage | Task 8 |
| §5 jobNavigation removed from app-layout | Task 6 |
| §5 getPageTitle updated | Task 5 |
| §5 job-polling.test.tsx updated | Task 10 |

### Placeholder scan

No TBD, TODO, or "similar to Task N" references. All code blocks are complete.

### Type consistency

- `StepperStage` (label, state) is used consistently in test (Task 2) and component (Task 3).
- `handleSelect(i: number)` defined in Task 9, called from `WorkflowStepper` via `onSelect` prop — matching signatures.
- `messages` exported in Task 1, imported in Task 9 — same `Record<string, [string, string]>` type.
- `jobStages` return type used in Task 9 via `stages[i]?.state` — matches `StageState` from `job-stages.ts`.
