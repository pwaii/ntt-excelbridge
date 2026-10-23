import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QualityReviewWorkspace } from "@/components/job/quality-review-workspace";
import { createQualityReviewFlow } from "@/quality/controller";
import { matchTypes } from "@/quality/types";
import { qualityItem, qualityJobId, qualityReceipt, qualitySnapshot } from "./quality-fixtures";

let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
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

async function render(items = [qualityItem({ kind: "standardization" })]) {
  const submit = vi.fn().mockResolvedValue(qualityReceipt());
  const flow = createQualityReviewFlow(qualityJobId, { load: async () => qualitySnapshot({ items, status: "TRANSFORMATION_REVIEW_PENDING" }), submit }, "transformation");
  await act(async () => root.render(<MemoryRouter><QualityReviewWorkspace flow={flow} jobId={qualityJobId} /></MemoryRouter>));
  return { flow, submit };
}

it("renders formula text safely with referenced columns and backend syntax status", async () => {
  await render([qualityItem({ kind: "formula", cells: [], formula: { text: '=HYPERLINK("<img src=x>")', referencedColumns: ["B", "C"], syntax: "verified" } })]);
  // Formula rendered as text, never HTML
  expect(container.textContent).toContain('=HYPERLINK("<img src=x>")');
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("Referenced columns: B, C");
  expect(container.textContent).toContain("not been calculated");
  expect(container.querySelector('[aria-label="Formula evidence"]')).not.toBeNull();
});

it("shows skipped outcome and blocks accept verdict for unmatched rows", async () => {
  await render([qualityItem({ kind: "update-match", match: { type: "unmatched", sourceKey: "row-001", targetKeys: [] } })]);
  // Match evidence is rendered
  expect(container.textContent).toContain("Skipped. No new row will be inserted.");
  // Accept is disabled because there is no verified match
  expect(verdictBtn("Accept").disabled).toBe(true);
  // Reject is still available
  expect(verdictBtn("Reject").disabled).toBe(false);
});

it("auto-advances after each decision and all drafts persist without submitting", async () => {
  const items = Array.from({ length: 5 }, (_, i) => qualityItem({ id: `m-${i}`, title: `Mapping ${i}`, kind: "standardization", confidence: 0.99 }));
  const { flow, submit } = await render(items);
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(5);
  // Accept first item — auto-advances
  act(() => verdictBtn("Accept").click());
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });
  expect(container.querySelector(".card-nav-count")?.textContent).toContain("2");
  expect(flow.getSnapshot().drafts["m-0"]?.decision).toBe("accept");
  expect(submit).not.toHaveBeenCalled();
  // Submit button still blocked (remaining undecided items)
  const submitBtn = [...container.querySelectorAll("button")].find(n => n.textContent?.includes("Submit review"))!;
  expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
});

it("shows formula evidence immediately and hides match items when filtering by formula type", async () => {
  await render([
    qualityItem({ id: "formula", kind: "formula", cells: [], title: "Calculate profit", formula: { text: "=B2-C2", referencedColumns: ["B", "C"], syntax: "verified" } }),
    qualityItem({ id: "match", kind: "update-match", title: "Match customer", match: { type: "exact", sourceKey: "123", targetKeys: ["123"] } }),
  ]);
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(2);
  // Formula evidence is accessible in the card (details content is in DOM regardless of open state)
  expect(container.querySelector('[aria-label="Formula evidence"]')).not.toBeNull();
  // Filter to formula kind only
  openFilters();
  change(filterSelect("Issue type"), "formula");
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(1);
  expect(container.querySelector(".finding-title")?.textContent).toBe("Calculate profit");
});

it("reveals a required item hidden by filters via clear without discarding existing drafts", async () => {
  const { flow } = await render([
    qualityItem({ id: "formula", kind: "formula", cells: [], title: "Calculate profit", formula: { text: "=B2-C2", referencedColumns: ["B", "C"], syntax: "verified" } }),
    qualityItem({ id: "mapping", kind: "standardization", title: "Rename region" }),
  ]);
  // Save a draft on formula item
  act(() => flow.decide("formula", { decision: "accept" }));
  // Filter to formula only — Rename region disappears
  openFilters();
  change(filterSelect("Issue type"), "formula");
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(1);
  expect(container.querySelector(".finding-title")?.textContent).not.toBe("Rename region");
  // Clear filters — both items visible
  const clearBtn = [...container.querySelectorAll("button")].find(n => n.textContent?.trim() === "Clear filters");
  if (clearBtn) act(() => (clearBtn as HTMLButtonElement).click());
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(2);
  // Formula draft was not discarded
  expect(flow.getSnapshot().drafts.formula?.decision).toBe("accept");
});

it("does not show match type filter for a formula-only review", async () => {
  await render([qualityItem({ kind: "formula", cells: [], formula: { text: "=B2-C2", referencedColumns: ["B", "C"], syntax: "verified" } })]);
  openFilters();
  // No match type filter — no update-match items in this review
  expect([...container.querySelectorAll(".review-filter-panel label")].some(n => n.textContent?.startsWith("Match type"))).toBe(false);
  // Formula evidence still accessible
  expect(container.querySelector('[aria-label="Formula evidence"]')).not.toBeNull();
});

it("shows all match type badges across items via dot navigation", async () => {
  const items = matchTypes.map(type => qualityItem({ id: type, kind: "update-match", title: type, match: { type, sourceKey: "src", targetKeys: type === "unmatched" ? [] : ["tgt"] } }));
  await render(items);
  expect(container.querySelectorAll(".review-dot-btn")).toHaveLength(matchTypes.length);
  // Navigate to last item (unmatched)
  const dots = container.querySelectorAll(".review-dot-btn");
  act(() => (dots[dots.length - 1] as HTMLButtonElement).click());
  expect(container.querySelector(".card-nav-count")?.textContent).toContain(`${matchTypes.length}`);
  expect(container.textContent).toContain("Skipped. No new row will be inserted.");
  expect(verdictBtn("Accept").disabled).toBe(true);
});
