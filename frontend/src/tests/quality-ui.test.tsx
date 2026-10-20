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
function button(label: string) { const element = [...container.querySelectorAll("button")].find((node) => node.textContent === label); if (!element) throw new Error(`Missing button: ${label}`); return element; }
function select(label: string) { const element = [...container.querySelectorAll("label")].find((node) => node.textContent?.startsWith(label))?.querySelector("select"); if (!element) throw new Error(`Missing select: ${label}`); return element; }
function change(element: HTMLSelectElement, value: string) { act(() => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function render(snapshot = qualitySnapshot()) {
  const submit = vi.fn().mockResolvedValue(qualityReceipt());
  const flow = createQualityReviewFlow(qualityJobId, { load: async () => snapshot, submit });
  await act(async () => root.render(<MemoryRouter><QualityReviewWorkspace flow={flow} jobId={qualityJobId} /></MemoryRouter>));
  return { flow, submit };
}

it("renders safe cell evidence, draft states and requires an explicit submission confirmation", async () => {
  const { submit } = await render(qualitySnapshot({ items: [qualityItem({ cells: [{ coordinate: "A3", before: '<img src=x onerror="alert(1)">', after: '=HYPERLINK("bad")' }] })] }));
  expect(button("Submit review").disabled).toBe(true);
  act(() => button("Date format differs").click());
  expect(container.textContent).toContain('<img src=x onerror="alert(1)">'); expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain('=HYPERLINK("bad")'); expect(container.querySelector("a[href='bad']")).toBeNull();
  change(select("Decision for this finding"), "accept");
  expect(container.textContent).toContain("Draft: accept"); expect(submit).not.toHaveBeenCalled(); expect(button("Submit review").disabled).toBe(true);
  act(() => container.querySelector<HTMLInputElement>('section:last-child input[type="checkbox"]')!.click());
  await act(async () => button("Submit review").click());
  expect(submit).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("Review recorded by backend");
  expect(container.textContent).toContain("does not prove that the next workflow segment has started");
});
it("sorts unknown/low confidence first, filters types and retains hidden drafts", async () => {
  const { flow } = await render(qualitySnapshot({ items: [qualityItem({ id: "high", confidence: 0.99 }), qualityItem({ id: "low", title: "Low confidence", confidence: 0.2 }), qualityItem({ id: "unknown", title: "Unknown confidence", confidence: undefined, kind: "blank-row" })] }));
  expect(container.querySelector("tbody button")?.textContent).toBe("Unknown confidence");
  act(() => button("Low confidence").click()); change(select("Decision for this finding"), "reject");
  change(select("Issue type"), "blank-row"); expect(container.querySelectorAll("tbody button")).toHaveLength(1);
  expect(flow.getSnapshot().drafts.low.decision).toBe("reject");
  change(select("Issue type"), "all"); change(select("Decision"), "pending");
  expect([...container.querySelectorAll("tbody button")].map((element) => element.textContent)).not.toContain("Low confidence");
});
it("requires a reason for ignore and shows pattern-level context rather than per-cell decisions", async () => {
  await render(qualitySnapshot({ items: [qualityItem({ kind: "normalization-rule", pattern: "DD/MM/YYYY", affectedCount: 2000 })] }));
  act(() => button("Date format differs").click()); change(select("Decision for this finding"), "ignore");
  expect(container.textContent).toContain("2000 affected cells reported by backend");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("reason is required");
  expect(button("Submit review").disabled).toBe(true); expect(container.querySelectorAll("select")).toHaveLength(6);
});
it("paginates and windows a large report with keyboard-accessible issue navigation", async () => {
  const items = Array.from({ length: 120 }, (_, index) => qualityItem({ id: String(index).padStart(3, "0"), title: `Finding ${index}`, confidence: 0.5 }));
  await render(qualitySnapshot({ items }));
  expect(container.textContent).toContain("Page 1 of 3"); expect(container.querySelectorAll("tbody button").length).toBeLessThanOrEqual(10);
  act(() => button("Next page").click()); expect(container.textContent).toContain("Page 2 of 3"); expect(button("Finding 50")).toBeTruthy();
  act(() => button("Finding 50").click()); act(() => button("Next issue").click());
  expect(container.querySelector("#finding-details")?.parentElement?.parentElement?.textContent).toContain("Finding 51");
  const scroller = container.querySelector<HTMLElement>('[aria-label="Scrollable quality findings"]')!;
  act(() => { scroller.scrollTop = 2160; scroller.dispatchEvent(new Event("scroll", { bubbles: true })); });
  expect(button("Finding 80")).toBeTruthy(); expect(container.querySelectorAll("tbody button").length).toBeLessThanOrEqual(10);
});
it("shows an honest empty report and never enables an empty review submission", async () => {
  await render(qualitySnapshot({ items: [] })); expect(container.textContent).toContain("contains no findings"); expect(button("Submit review").disabled).toBe(true);
});
it("shows loading and failure states without displaying raw thrown values", async () => {
  let reject!: (reason: Error) => void;
  const flow = createQualityReviewFlow(qualityJobId, { load: () => new Promise<QualitySnapshot>((_done, fail) => { reject = fail; }), submit: vi.fn() });
  await act(async () => root.render(<MemoryRouter><QualityReviewWorkspace flow={flow} jobId={qualityJobId} /></MemoryRouter>));
  expect(container.textContent).toContain("Loading quality review");
  await act(async () => reject(new Error("private-workbook-data")));
  expect(container.textContent).toContain("could not be loaded"); expect(container.textContent).not.toContain("private-workbook-data");
});
it("marks only actual timeline observations and links to the real quality gate", () => {
  const receipt = qualityReceipt();
  const job = { ...receipt.job, config: { ...receipt.job.config, conflict_policy: "reject_all" as const }, status: "QUALITY_REVIEW_PENDING" as const };
  act(() => root.render(<MemoryRouter><JobTimeline job={job} observed={["INSPECTING", "QUALITY_REVIEW_PENDING"]} /></MemoryRouter>));
  expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Quality review");
  expect(container.querySelector("li")?.textContent).toContain("Not observed");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/jobs/${qualityJobId}/quality-review`);
});
