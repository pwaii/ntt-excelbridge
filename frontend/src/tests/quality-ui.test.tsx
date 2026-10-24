import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QualityReviewWorkspace } from "@/components/job/quality-review-workspace";
import { JobTimeline } from "@/components/job/job-timeline";
import { createQualityReviewFlow } from "@/quality/controller";
import type { QualitySnapshot } from "@/quality/types";
import { qualityItem, qualitySnapshot, qualityReceipt, qualityJobId } from "./quality-fixtures";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

function verdictBtn(label: string) {
  const found = [...container.querySelectorAll(".verdict-btn")].find(n => n.textContent?.includes(label));
  if (!found) throw new Error(`Missing verdict button: ${label}`);
  return found as HTMLButtonElement;
}
function filterSelect(labelText: string) {
  const el = [...container.querySelectorAll(".review-filter-panel label")]
    .find(n => n.textContent?.trimStart().startsWith(labelText))?.querySelector("select");
  if (!el) throw new Error(`Missing filter select: ${labelText}`);
  return el as HTMLSelectElement;
}
function change(el: HTMLSelectElement, value: string) {
  act(() => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
function openFilters() {
  const btn = [...container.querySelectorAll("button")].find(n => n.textContent?.includes("Filters"));
  if (!btn) throw new Error("Missing filters button");
  act(() => (btn as HTMLButtonElement).click());
}

async function render(snapshot = qualitySnapshot()) {
  const submit = vi.fn().mockResolvedValue(qualityReceipt());
  const flow = createQualityReviewFlow(qualityJobId, { load: async () => snapshot, submit });
  await act(async () => root.render(<MemoryRouter><QualityReviewWorkspace flow={flow} jobId={qualityJobId} /></MemoryRouter>));
  return { flow, submit };
}

it("renders safe cell evidence, draft states and requires an explicit submission confirmation", async () => {
  const { submit } = await render(qualitySnapshot({ items: [qualityItem({ cells: [{ coordinate: "A3", before: '<img src=x onerror="alert(1)">', after: '=HYPERLINK("bad")' }] })] }));
  expect([...container.querySelectorAll<HTMLButtonElement>(".review-topbar button")].some(button => button.textContent?.includes("Filters"))).toBe(true);
  // Cell content is rendered as text, never as HTML
  expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain('=HYPERLINK("bad")');
  expect(container.querySelector("a[href='bad']")).toBeNull();
  // Accept via verdict button
  act(() => verdictBtn("Accept").click());
  expect(submit).not.toHaveBeenCalled();
  // Submit requires confirmation checkbox
  expect([...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Submit review"))?.disabled).toBe(true);
  act(() => container.querySelector<HTMLInputElement>('.review-topbar-confirm input')!.click());
  await act(async () => { const btn = [...container.querySelectorAll("button")].find(n => n.textContent?.includes("Submit review"))!; (btn as HTMLButtonElement).click(); });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Review submitted");
  expect(container.textContent).toContain("Review ID:");
  expect(container.textContent).toContain("Check job progress for processing status");
});

it("sorts unknown/low confidence first and filters by type retain hidden drafts", async () => {
  const { flow } = await render(qualitySnapshot({ items: [
    qualityItem({ id: "high", confidence: 0.99 }),
    qualityItem({ id: "low", title: "Low confidence", confidence: 0.2 }),
    qualityItem({ id: "unknown", title: "Unknown confidence", confidence: undefined, kind: "blank-row" }),
  ] }));
  // Lowest confidence first — unknown is shown on first card
  expect(container.querySelector(".finding-title")?.textContent).toBe("Unknown confidence");
  // Navigate to low confidence item and decide
  act(() => container.querySelector<HTMLButtonElement>(".card-nav-btn:last-of-type")!.click());
  act(() => verdictBtn("Reject").click());
  // Wait for advance timeout then check draft was saved
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });
  expect(flow.getSnapshot().drafts.low.decision).toBe("reject");
  // Filter by blank-row type — navigates to unknown only
  openFilters();
  change(filterSelect("Issue type"), "blank-row");
  expect(container.querySelector(".finding-title")?.textContent).toBe("Unknown confidence");
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(1);
});

it("shows source filenames in the card meta and filters by workbook", async () => {
  await render(qualitySnapshot({ items: [
    qualityItem({ id: "one", filename: "north.xlsx" }),
    qualityItem({ id: "two", filename: "south.xlsx", title: "South finding" }),
  ] }));
  // First card shows a filename
  expect(container.querySelector(".finding-location")?.textContent).toContain("north.xlsx");
  // Filter by workbook
  openFilters();
  change(filterSelect("Current workbook"), "south.xlsx");
  expect(container.querySelector(".finding-title")?.textContent).toBe("South finding");
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(1);
});

it("requires a reason for ignore and shows pattern and affected count", async () => {
  await render(qualitySnapshot({ items: [qualityItem({ kind: "normalization-rule", pattern: "DD/MM/YYYY", affectedCount: 2000 })] }));
  expect(container.textContent).toContain("2000 affected cells");
  act(() => verdictBtn("Ignore").click());
  // Reason is required — confirm without it shows error
  act(() => (container.querySelector(".verdict-form button[type='button']") as HTMLButtonElement | null)?.click() ?? void 0);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("reason is required");
  expect([...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Submit review"))?.disabled).toBe(true);
});

it("handles 120 items without pagination — sidebar has 120 dots and keyboard navigates", async () => {
  const items = Array.from({ length: 120 }, (_, i) => qualityItem({ id: String(i).padStart(3, "0"), title: `Finding ${i}`, confidence: 0.5 }));
  await render(qualitySnapshot({ items }));
  // All items in sidebar as dots
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(120);
  // First card shown
  expect(container.querySelector(".finding-title")?.textContent).toBe("Finding 0");
  // Navigate forward via next button
  act(() => container.querySelector<HTMLButtonElement>(".card-nav-btn:last-of-type")!.click());
  expect(container.querySelector(".card-nav-count")?.textContent).toContain("2");
  // Keyboard navigation
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  expect(container.querySelector(".card-nav-count")?.textContent).toContain("3");
});

it("allows a human to submit a completed empty report to advance the review gate", async () => {
  const { submit } = await render(qualitySnapshot({ items: [] }));
  expect(container.textContent).toContain("contains no findings");
  expect(container.querySelector('[aria-busy]')).toBeNull();
  expect(container.querySelector("select")).toBeNull();
  const submitButton = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Submit review")) as HTMLButtonElement;
  expect(submitButton.disabled).toBe(false);
  await act(async () => submitButton.click());
  expect(submit).toHaveBeenCalledOnce();
});

it("shows loading and failure states without displaying raw thrown values", async () => {
  let reject!: (reason: Error) => void;
  const flow = createQualityReviewFlow(qualityJobId, { load: () => new Promise<QualitySnapshot>((_done, fail) => { reject = fail; }), submit: vi.fn() });
  await act(async () => root.render(<MemoryRouter><QualityReviewWorkspace flow={flow} jobId={qualityJobId} /></MemoryRouter>));
  expect(container.textContent).toContain("Loading quality review");
  await act(async () => reject(new Error("private-workbook-data")));
  expect(container.textContent).toContain("could not be loaded");
  expect(container.textContent).not.toContain("private-workbook-data");
  expect([...container.querySelectorAll("button")].find(button => button.textContent?.includes("Reload review"))?.disabled).toBe(false);
});

it("shows finished prerequisites and links only to the current review gate", () => {
  const receipt = qualityReceipt();
  const job = { ...receipt.job, config: { ...receipt.job.config, conflict_policy: "reject_all" as const }, status: "QUALITY_REVIEW_PENDING" as const };
  act(() => root.render(<MemoryRouter><JobTimeline job={job} observed={["INSPECTING", "QUALITY_REVIEW_PENDING"]} /></MemoryRouter>));
  expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Quality review");
  expect(container.querySelector("li")?.textContent).toContain("Complete");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/jobs/${qualityJobId}/quality-review`);
});

it("offers filter recovery instead of treating zero filtered rows as an empty report", async () => {
  await render(qualitySnapshot({ items: [qualityItem({ severity: "medium" })] }));
  openFilters();
  change(filterSelect("Severity"), "high");
  expect(container.textContent).toContain("No findings match these filters.");
  expect(container.querySelector('[aria-label="Empty review"]')).toBeNull();
  act(() => (container.querySelector("button.mt-4") as HTMLButtonElement | null)?.click() ?? void 0);
  const btn = [...container.querySelectorAll("button")].find(n => n.textContent === "Show all items");
  if (btn) act(() => (btn as HTMLButtonElement).click());
  expect(container.querySelector(".finding-title")?.textContent).toBe("Date format differs");
});

it("draft persists when navigating away and back to the same finding", async () => {
  const { flow } = await render(qualitySnapshot({ items: [qualityItem(), qualityItem({ id: "issue-2", title: "Second finding" })] }));
  // First card: accept
  act(() => verdictBtn("Accept").click());
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });
  // Auto-advanced to second card — navigate back
  act(() => container.querySelector<HTMLButtonElement>(".card-nav-btn:first-of-type")!.click());
  expect(container.querySelector(".finding-title")?.textContent).toBe("Date format differs");
  // Draft still saved in flow state
  expect(flow.getSnapshot().drafts["issue-1"]?.decision).toBe("accept");
  // Verdict button shows active state
  expect(verdictBtn("Accept").getAttribute("data-active")).toBe("true");
});
