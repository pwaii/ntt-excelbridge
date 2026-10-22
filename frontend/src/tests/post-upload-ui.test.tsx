import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostUploadConfiguration } from "@/components/job/post-upload-configuration";
import { JobProgressPage } from "@/pages/job-progress-page";
import { createMetadataFlow, type MetadataFlow } from "@/metadata/controller";
import { metadataForm, mockMetadataAdapter, mockSheet, mockSnapshot } from "./metadata-fixtures";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(flow: MetadataFlow) {
  await act(async () => { root.render(<MemoryRouter initialEntries={["/configure"]}><Routes><Route path="/configure" element={<PostUploadConfiguration flow={flow} />} /><Route path="/jobs/:id" element={<JobProgressPage />} /></Routes></MemoryRouter>); });
}
function button(text: string) {
  const result = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
async function select(id: string, value: string) {
  await act(async () => {
    const field = container.querySelector<HTMLSelectElement>(`#${id}`)!;
    field.value = value; field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("post-upload UI with synthetic normalized metadata only", () => {
  it("shows loading without inventing sheets or counts", async () => {
    const adapter = mockMetadataAdapter(); adapter.load = () => new Promise(() => {});
    await render(createMetadataFlow("mock-job", metadataForm(), adapter));
    expect(container.textContent).toContain("Loading worksheets");
    expect(container.querySelector("select")?.options).toHaveLength(1);
    expect(container.textContent).not.toContain("Mock source sheet");
    expect(button("Start workflow").disabled).toBe(true);
  });
  it("shows honest unavailable state and blocks Start without an adapter", async () => {
    await render(createMetadataFlow("mock-job", metadataForm()));
    expect(container.textContent).toContain("Worksheet details are unavailable");
    expect(container.textContent).not.toContain("Detected header row:");
    expect(button("Start workflow").disabled).toBe(true);
  });
  it("loads real selector options from supplied metadata, confirms a header and starts only after key selection", async () => {
    const flow = createMetadataFlow("mock-job", metadataForm(true), mockMetadataAdapter()); await render(flow);
    expect(container.querySelector<HTMLSelectElement>("#current-metadata-sheet")?.value).toBe("");
    await select("current-metadata-sheet", mockSheet.sheetName);
    expect(container.textContent).toContain("Detected header row: 3");
    expect(container.querySelector<HTMLSelectElement>("#current-metadata-key")?.disabled).toBe(true);
    await act(async () => button("Confirm header row").click());
    expect(button("Start workflow").disabled).toBe(true);
    await select("current-metadata-key", "mock-key-id");
    expect(button("Save setup").disabled).toBe(true);
    await select("main-metadata-sheet", mockSheet.sheetName);
    await act(async () => button("Confirm header row").click());
    await select("main-metadata-key", "mock-key-id");
    await act(async () => button("Save setup").click());
    expect(button("Start workflow").disabled).toBe(false);
    await act(async () => button("Start workflow").click());
    expect(container.querySelector("h1")?.textContent).toBe("Job progress");
    expect(container.textContent).toContain("Sign in to read the backend job status");
  });
  it("resets confirmation/key after selecting a different sheet", async () => {
    const flow = createMetadataFlow("mock-job", metadataForm(true), mockMetadataAdapter()); await render(flow);
    await select("current-metadata-sheet", mockSheet.sheetName);
    await act(async () => button("Confirm header row").click());
    await select("current-metadata-key", "mock-key-id");
    await select("current-metadata-sheet", "Mock alternate sheet");
    expect(flow.getSnapshot().choices.current.header).toBeNull();
    expect(container.querySelector<HTMLSelectElement>("#current-metadata-key")?.value).toBe("");
    expect(button("Start workflow").disabled).toBe(true);
  });
  it("supports explicit backend zero-based bounds without auto-confirming", async () => {
    const snapshot = mockSnapshot();
    const zeroBased = { ...mockSheet, detectedHeaderRow: 0, headerRowBounds: { min: 0, max: 19, indexBase: 0 as const }, columnsHeaderRow: 0 };
    const flow = createMetadataFlow("mock-job", metadataForm(), mockMetadataAdapter({ ...snapshot, workbooks: { current: { ...snapshot.workbooks.current!, sheets: [zeroBased] } } }));
    await render(flow); await select("current-metadata-sheet", mockSheet.sheetName);
    const row = container.querySelector<HTMLInputElement>("#current-metadata-header-row")!;
    expect(row.min).toBe("0"); expect(row.max).toBe("19");
    expect(container.textContent).toContain("zero-based row indices");
    expect(flow.getSnapshot().choices.current.header).toBeNull();
    await act(async () => button("Confirm header row").click());
    expect(flow.getSnapshot().choices.current.header?.row).toBe(0);
  });
  it("invalidates header/key on correction and uses backend-specific bounds", async () => {
    const flow = createMetadataFlow("mock-job", metadataForm(true), mockMetadataAdapter()); await render(flow);
    await select("current-metadata-sheet", mockSheet.sheetName);
    await act(async () => button("Confirm header row").click()); await select("current-metadata-key", "mock-key-id");
    const row = container.querySelector<HTMLInputElement>("#current-metadata-header-row")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(row, "5"); row.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(flow.getSnapshot().choices.current.header).toBeNull();
    expect(flow.getSnapshot().choices.current.keyColumnId).toBeNull();
    await act(async () => button("Confirm header row").click());
    expect(container.querySelector<HTMLSelectElement>("#current-metadata-key")?.disabled).toBe(true);
    expect(button("Start workflow").disabled).toBe(true);
  });
  it("displays provided warnings and current/main output policy without inventing missing counts", async () => {
    const snapshot = mockSnapshot();
    const flow = createMetadataFlow("mock-job", metadataForm(true), mockMetadataAdapter({ ...snapshot, workbooks: { ...snapshot.workbooks, current: { ...snapshot.workbooks.current!, sheets: [{ ...mockSheet, dataRowCount: undefined }], warnings: ["Mock backend warning: limited preview"] } } }));
    await render(flow); await select("current-metadata-sheet", mockSheet.sheetName);
    expect(container.textContent).toContain("limited preview");
    expect(container.textContent).toContain("Row count not provided");
    expect(container.textContent).toContain("new main workbook");
    expect(container.textContent).toContain("skipped and reported");
    expect(button("Start workflow").disabled).toBe(true);
  });
  it("warns for a backend count above working size without rejecting solely above 2,000", async () => {
    const snapshot = mockSnapshot();
    const flow = createMetadataFlow("mock-job", metadataForm(), mockMetadataAdapter({ ...snapshot, workbooks: { current: { ...snapshot.workbooks.current!, sheets: [{ ...mockSheet, dataRowCount: 2_001, topIssuesOnly: true }] } } }));
    await render(flow); await select("current-metadata-sheet", mockSheet.sheetName);
    expect(container.textContent).toContain("warning, not a rejection");
    expect(container.textContent).toContain("top issues only");
  });
  it.each([false, true])("hides matching keys and saves without them when update is off (standardize=%s)", async (standardize) => {
    const snapshot = mockSnapshot();
    const workbooks = { current: { ...snapshot.workbooks.current!, keyRule: "optional" as const }, main: { ...snapshot.workbooks.main!, keyRule: "optional" as const } };
    const configuration = { ...metadataForm(standardize), standardize, update: false };
    const flow = createMetadataFlow("mock-job", configuration, mockMetadataAdapter({ ...snapshot, workbooks }));
    await render(flow);
    for (const role of standardize ? ["current", "main"] : ["current"]) {
      await select(`${role}-metadata-sheet`, mockSheet.sheetName);
      expect(container.querySelector(`#${role}-metadata-key`)).toBeNull();
      expect(button("Save setup").disabled).toBe(true);
      await act(async () => button("Confirm header row").click());
    }
    expect(container.textContent).not.toContain("Key column");
    expect(button("Save setup").disabled).toBe(false);
    await act(async () => button("Save setup").click());
    expect(button("Start workflow").disabled).toBe(false);
  });
});

it.each([false, true])("saves before starting with one explicit action, and never starts if saving fails (failure: %s)", async (failure) => {
  const snapshot = mockSnapshot();
  const adapter = mockMetadataAdapter({ ...snapshot, workbooks: { current: { ...snapshot.workbooks.current!, keyRule: "not-applicable" } } });
  const operations: string[] = [];
  adapter.persistSelections = vi.fn(async (_id, _selection, selectionKey) => { operations.push("save"); if (failure) throw new Error("Synthetic save failure"); return { selectionKey, serverRevision: "saved-revision" }; });
  adapter.start = vi.fn(async () => { operations.push("start"); return { accepted: true as const, jobId: "mock-job", statusLabel: "INSPECTING" }; });
  await render(createMetadataFlow("mock-job", metadataForm(), adapter));
  await select("current-metadata-sheet", mockSheet.sheetName);
  await act(async () => button("Confirm header row").click());
  expect(button("Start workflow").disabled).toBe(false);
  await act(async () => { button("Start workflow").click(); button("Start workflow").click(); });
  expect(operations).toEqual(failure ? ["save"] : ["save", "start"]);
  expect(adapter.start).toHaveBeenCalledTimes(failure ? 0 : 1);
});
