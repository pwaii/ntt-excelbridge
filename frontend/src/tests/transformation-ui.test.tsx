import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QualityReviewWorkspace } from "@/components/job/quality-review-workspace";
import { createQualityReviewFlow } from "@/quality/controller";
import { matchTypes, type QualityItem } from "@/quality/types";
import { qualityItem, qualityJobId, qualityReceipt, qualitySnapshot } from "./quality-fixtures";

let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
function button(text: string) { const found = [...container.querySelectorAll("button")].find((node) => node.textContent === text); if (!found) throw new Error(`Missing ${text}`); return found; }
async function render(items: QualityItem[]) {
  const submit = vi.fn().mockResolvedValue(qualityReceipt());
  const flow = createQualityReviewFlow(qualityJobId, { load: async () => qualitySnapshot({ items, status: "TRANSFORMATION_REVIEW_PENDING" }), submit }, "transformation");
  await act(async () => root.render(<MemoryRouter><QualityReviewWorkspace flow={flow} jobId={qualityJobId} /></MemoryRouter>));
  return { flow, submit };
}
it("renders formula text safely, referenced columns and backend syntax status", async () => {
  await render([qualityItem({ kind: "formula", formula: { text: '=HYPERLINK("<img src=x>")', referencedColumns: ["B", "C"], syntax: "verified" } })]);
  act(() => button("Date format differs").click());
  expect(container.textContent).toContain("Syntax checked"); expect(container.textContent).toContain("Referenced columns: B, C");
  expect(container.textContent).toContain('=HYPERLINK("<img src=x>")'); expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("not been calculated");
});
it("shows all match badges and a skipped outcome for unmatched rows", async () => {
  await render(matchTypes.map((type) => qualityItem({ id: type, kind: "update-match", title: type, match: { type, sourceKey: "source", targetKeys: [] } })));
  expect(container.querySelector('[aria-label="Match counts"]')?.textContent).toContain("ambiguous: 1");
  act(() => button("unmatched").click()); expect(container.textContent).toContain("Skipped. No new row will be inserted.");
  const accept = container.querySelector('option[value="accept"]') as HTMLOptionElement; expect(accept.disabled).toBe(true);
});
it("bulk requires its own scope confirmation and creates drafts across pages without submitting", async () => {
  const items = Array.from({ length: 120 }, (_, index) => qualityItem({ id: `mapping-${index}`, kind: "standardization", confidence: 0.99 }));
  const { flow, submit } = await render(items);
  expect(button("Create acceptance drafts").disabled).toBe(true);
  act(() => container.querySelector<HTMLInputElement>('[aria-label="Bulk review"] input')!.click());
  act(() => button("Create acceptance drafts").click());
  expect(Object.keys(flow.getSnapshot().drafts)).toHaveLength(120); expect(submit).not.toHaveBeenCalled();
  expect(button("Submit review").disabled).toBe(true); expect(container.textContent).toContain("Accept drafts: 120");
  act(() => container.querySelector<HTMLInputElement>('section:last-child input[type="checkbox"]')!.click());
  await act(async () => button("Submit review").click()); expect(submit).toHaveBeenCalledOnce();
});

it("shows formula evidence immediately and keeps it visible when filtering row matches", async () => {
  await render([
    qualityItem({ id: "formula", kind: "formula", title: "Calculate profit", formula: { text: "=B2-C2", referencedColumns: ["B", "C"], syntax: "verified" } }),
    qualityItem({ id: "match", kind: "update-match", title: "Match customer", match: { type: "exact", sourceKey: "123", targetKeys: ["123"] } }),
  ]);
  expect(container.querySelector('[aria-label="Formula evidence"]')?.textContent).toContain("=B2-C2");
  const matchFilter = [...container.querySelectorAll("label")].find((node) => node.textContent?.startsWith("Match type"))!.querySelector("select")!;
  act(() => { matchFilter.value = "normalized"; matchFilter.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(button("Calculate profit")).toBeTruthy();
  expect([...container.querySelectorAll("tbody button")].some((node) => node.textContent === "Match customer")).toBe(false);
  expect(button("Submit review").disabled).toBe(true);
});

it("finds a required decision hidden by filters without discarding existing drafts", async () => {
  const { flow } = await render([
    qualityItem({ id: "formula", kind: "formula", title: "Calculate profit", formula: { text: "=B2-C2", referencedColumns: ["B", "C"], syntax: "verified" } }),
    qualityItem({ id: "mapping", kind: "standardization", title: "Rename region" }),
  ]);
  act(() => flow.decide("formula", { decision: "accept" }));
  const kindFilter = [...container.querySelectorAll("label")].find((node) => node.textContent?.startsWith("Issue type"))!.querySelector("select")!;
  act(() => { kindFilter.value = "formula"; kindFilter.dispatchEvent(new Event("change", { bubbles: true })); });
  expect([...container.querySelectorAll("tbody button")].some((node) => node.textContent === "Rename region")).toBe(false);
  act(() => button("Review remaining").click());
  expect(kindFilter.value).toBe("all");
  expect(container.querySelector(".review-details")?.textContent).toContain("Rename region");
  expect(flow.getSnapshot().drafts.formula.decision).toBe("accept");
  expect(container.textContent).toContain("1 decision left to review");
});

it("does not show row-match controls for a formula-only review", async () => {
  await render([qualityItem({ kind: "formula", formula: { text: "=B2-C2", referencedColumns: ["B", "C"], syntax: "verified" } })]);
  expect([...container.querySelectorAll("label")].some((node) => node.textContent?.startsWith("Match type"))).toBe(false);
  expect(container.querySelector('[aria-label="Match counts"]')).toBeNull();
  expect(container.querySelector('[aria-label="Formula evidence"]')).not.toBeNull();
});
