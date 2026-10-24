import { describe, expect, it, vi } from "vitest";
import { createMetadataFlow } from "@/metadata/controller";
import { metadataKey } from "@/lib/workflow-readiness";
import { ApiError } from "@/api/errors";
import type { MetadataAdapter } from "@/metadata/types";
import { metadataForm, mockAlternateSheet, mockMetadataAdapter, mockSheet, mockSnapshot } from "./metadata-fixtures";

async function ready(adapter = mockMetadataAdapter(), update = false) {
  const flow = createMetadataFlow("mock-job", metadataForm(update), adapter);
  await flow.load();
  for (const role of (update ? ["current", "main"] : ["current"]) as ("current" | "main")[]) {
    flow.selectSheet(role, mockSheet.sheetName);
    flow.setHeader(role, { metadataKey: metadataKey(mockSheet), row: 3 });
    flow.selectKey(role, "mock-key-id");
  }
  return flow;
}

describe("post-upload metadata and start boundary (mock adapters, no API schema)", () => {
  it("saves explicitly, invalidates a changed draft, and does not resave before Start", async () => {
    const adapter = mockMetadataAdapter(); const flow = await ready(adapter);
    expect(await flow.save()).toBe(true);
    expect(flow.getSnapshot().configurationSaved).toBe(true);
    expect(adapter.start).not.toHaveBeenCalled();
    expect(await flow.start()).toBe(true);
    expect(adapter.persistSelections).toHaveBeenCalledOnce();
  });
  it("restores backend-confirmed configuration without requiring browser File objects", async () => {
    const snapshot = mockSnapshot();
    const chosen = { sheetName: mockSheet.sheetName, header: { metadataKey: metadataKey(mockSheet), row: 3 }, keyColumnId: "mock-key-id" };
    const adapter = mockMetadataAdapter({ ...snapshot, persistedChoices: { current: chosen, main: chosen } });
    const flow = createMetadataFlow("mock-job", { comment_name: "Profit", outputHeader: "profit", standardize: false, update: false }, adapter);
    await flow.load();
    expect(flow.getSnapshot().configurationSaved).toBe(true);
    expect(flow.getReadiness().canStart).toBe(true);
    flow.setHeader("current", null);
    expect(flow.getSnapshot().configurationSaved).toBe(false);
    expect(flow.getReadiness().canStart).toBe(false);
  });
  it("tracks and requires independent worksheet/header choices for every current workbook", async () => {
    const base = mockSnapshot();
    const workbook = { ...base.workbooks.current!, keyRule: "not-applicable" as const };
    const adapter = mockMetadataAdapter({ ...base, workbooks: { current: workbook, current_2: workbook } });
    const flow = createMetadataFlow("mock-job", metadataForm(), adapter, ["current", "current_2"]);
    await flow.load();
    expect(flow.roles).toEqual(["current", "current_2"]);
    expect(flow.getReadiness().blockers).toContain("current_2: select an available worksheet.");
    for (const role of flow.roles) {
      expect(flow.selectSheet(role, mockSheet.sheetName)).toBe(true);
      expect(flow.setHeader(role, { metadataKey: metadataKey(mockSheet), row: 3 })).toBe(true);
    }
    expect(flow.getReadiness().canStart).toBe(true);
    // A secondary current workbook may keep its own sheet AND header row (4 here, not the
    // primary's 3); the backend reads each slot's own sheet_name/header_row, so this is allowed.
    flow.selectSheet("current_2", mockAlternateSheet.sheetName);
    flow.setHeader("current_2", { metadataKey: metadataKey(mockAlternateSheet), row: 4 });
    expect(flow.getReadiness().blockers.join(" ")).not.toContain("processing pipeline shares that setting");
    expect(flow.getReadiness().canStart).toBe(true);
    expect(await flow.save()).toBe(true);
    expect(adapter.persistSelections).toHaveBeenCalledWith("mock-job", expect.objectContaining({ choices: expect.objectContaining({ current: expect.anything(), current_2: expect.anything() }) }), expect.any(String), expect.any(String), expect.anything());
  });
  it("keeps each current workbook's header independent (no propagation from the primary)", async () => {
    const base = mockSnapshot();
    const workbook = { ...base.workbooks.current!, keyRule: "not-applicable" as const };
    const adapter = mockMetadataAdapter({ ...base, workbooks: { current: workbook, current_2: workbook } });
    const flow = createMetadataFlow("mock-job", metadataForm(), adapter, ["current", "current_2"]);
    await flow.load();
    flow.selectSheet("current", mockSheet.sheetName);
    flow.selectSheet("current_2", mockSheet.sheetName);
    flow.setHeader("current", { metadataKey: metadataKey(mockSheet), row: 3 });
    // Setting the primary's header must NOT auto-fill the secondary; each slot is configured on its own.
    expect(flow.getSnapshot().choices.current_2?.header ?? null).toBe(null);
  });
  it("reconciles a fresh controller from backend state without replaying Start", async () => {
    const adapter = mockMetadataAdapter({ ...mockSnapshot(), startState: "started", startedJob: { accepted: true, jobId: "mock-job", statusLabel: "Mock running" } });
    const fresh = createMetadataFlow("mock-job", metadataForm(), adapter);
    expect(fresh.getSnapshot().startedJob).toBeUndefined();
    expect(fresh.getReadiness().canStart).toBe(false);
    await fresh.load();
    expect(fresh.getSnapshot()).toMatchObject({ phase: "started", startedJob: { jobId: "mock-job" } });
    expect(await fresh.start()).toBe(false);
    expect(adapter.start).not.toHaveBeenCalled();
    expect(adapter.persistSelections).not.toHaveBeenCalled();
  });
  it("blocks unavailable metadata and missing adapters", async () => {
    const flow = createMetadataFlow("mock-job", metadataForm());
    expect(await flow.load()).toBe(false);
    expect(flow.getSnapshot().phase).toBe("unavailable");
    expect(flow.getReadiness().canStart).toBe(false);
    expect(await flow.start()).toBe(false);
  });
  it("exposes loading and safe metadata errors without stale data", async () => {
    const adapter = mockMetadataAdapter();
    adapter.load = () => new Promise((_resolve, reject) => { reject(new ApiError("network", "private response", undefined, undefined, "mock-error-request")); });
    const flow = createMetadataFlow("mock-job", metadataForm(), adapter);
    const request = flow.load(); expect(flow.getSnapshot().phase).toBe("loading");
    expect(await request).toBe(false);
    expect(flow.getSnapshot()).toMatchObject({ phase: "error", error: { requestId: "mock-error-request" }, snapshot: undefined });
    expect(flow.getSnapshot().error?.message).not.toContain("private response");
  });
  it("does not silently select sheets, keys or headers, and rejects nonexistent choices", async () => {
    const flow = createMetadataFlow("mock-job", metadataForm(), mockMetadataAdapter()); await flow.load();
    expect(flow.getSnapshot().choices.current).toEqual({ sheetName: null, keyColumnId: null, header: null });
    expect(flow.selectSheet("current", "invented sheet")).toBe(false);
    expect(flow.selectSheet("current", mockSheet.sheetName)).toBe(true);
    expect(flow.selectKey("current", "mock-key-id")).toBe(false);
    expect(flow.setHeader("current", { metadataKey: metadataKey(mockSheet), row: 3 })).toBe(true);
    expect(flow.selectKey("current", "invented key")).toBe(false);
    expect(flow.getReadiness().blockers.join(" ")).toContain("select a required key column");
  });
  it("requires both headers and keys for update and resets them on sheet/header change", async () => {
    const flow = await ready(mockMetadataAdapter(), true);
    expect(flow.getReadiness().canStart).toBe(true);
    flow.selectSheet("main", "Mock alternate sheet");
    expect(flow.getSnapshot().choices.main).toEqual({ sheetName: "Mock alternate sheet", keyColumnId: null, header: null });
    expect(flow.getReadiness().canStart).toBe(false);
    flow.setHeader("current", null);
    expect(flow.getSnapshot().choices.current!.keyColumnId).toBeNull();
  });
  it("does not use old columns after correcting the header and reloads real column metadata through the adapter", async () => {
    const adapter = mockMetadataAdapter(); const flow = await ready(adapter);
    flow.setHeader("current", { metadataKey: metadataKey(mockSheet), row: 5 });
    expect(flow.selectKey("current", "mock-key-id")).toBe(false);
    expect(flow.getReadiness().canStart).toBe(false);
    const refreshed = { ...mockSheet, detectedHeaderRow: 5, columnsHeaderRow: 5, columns: [{ id: "mock-corrected-key", label: "Mock corrected header" }] };
    const snapshot = mockSnapshot();
    adapter.load = vi.fn(async () => ({ ...snapshot, workbooks: { current: { ...snapshot.workbooks.current!, sheets: [refreshed] } } }));
    await flow.load();
    expect(adapter.load).toHaveBeenCalledWith("mock-job", expect.objectContaining({ current: expect.objectContaining({ header: expect.objectContaining({ row: 5 }) }) }), expect.any(AbortSignal));
    expect(flow.getSnapshot().choices.current!.header).toBeNull();
    flow.setHeader("current", { metadataKey: metadataKey(refreshed), row: 5 });
    expect(flow.selectKey("current", "mock-corrected-key")).toBe(true);
    expect(flow.getReadiness().canStart).toBe(true);
  });
  it("blocks start without a contract to persist the final selections", async () => {
    const adapter = mockMetadataAdapter(); delete adapter.persistSelections;
    const flow = await ready(adapter);
    expect(flow.getReadiness().canStart).toBe(false);
    expect(await flow.start()).toBe(false); expect(adapter.start).not.toHaveBeenCalled();
  });
  it("requires matching persistence acknowledgement before starting with the authoritative revision", async () => {
    const adapter = mockMetadataAdapter(); const flow = await ready(adapter);
    expect(await flow.start()).toBe(true);
    expect(adapter.persistSelections).toHaveBeenCalledWith("mock-job", expect.objectContaining({ configuration: expect.objectContaining({ comment_name: "Profit", outputHeader: "profit" }), choices: flow.getSnapshot().choices }), expect.any(String), "mock-server-revision", expect.any(AbortSignal));
    expect(adapter.start).toHaveBeenCalledWith("mock-job", "mock-saved-revision", expect.any(AbortSignal));
    expect(flow.getSnapshot()).toMatchObject({ phase: "started", startedJob: { requestId: "mock-start-request" } });
    expect(await flow.start()).toBe(false);
  });
  it("blocks mismatched persistence acknowledgements and does not optimistically start", async () => {
    const adapter = mockMetadataAdapter(); adapter.persistSelections = async () => ({ selectionKey: "wrong", serverRevision: "mock-other-revision" });
    const flow = await ready(adapter);
    expect(await flow.start()).toBe(false); expect(adapter.start).not.toHaveBeenCalled();
    expect(flow.getSnapshot().reconcileRequired).toBe(true);
  });
  it("prevents duplicate Start clicks and edits during persistence", async () => {
    const adapter = mockMetadataAdapter();
    let resolve!: (value: { selectionKey: string; serverRevision: string }) => void;
    adapter.persistSelections = (_id, _input, selectionKey) => new Promise((done) => { resolve = (value) => done({ ...value, selectionKey }); });
    const flow = await ready(adapter); const first = flow.start();
    expect(await flow.start()).toBe(false); expect(flow.selectSheet("current", "Mock alternate sheet")).toBe(false);
    resolve({ selectionKey: "unused", serverRevision: "mock-saved-revision" });
    expect(await first).toBe(true); expect(adapter.start).toHaveBeenCalledOnce();
  });
  it.each([401, 422, 409, 503])("handles backend Start HTTP %s with correlation IDs", async (status) => {
    const adapter = mockMetadataAdapter(); adapter.start = vi.fn(async () => { throw new ApiError("http", "sensitive response", status, "MOCK_START_ERROR", "mock-start-error-request"); });
    const flow = await ready(adapter); expect(await flow.start()).toBe(false);
    expect(flow.getSnapshot().error).toMatchObject({ requestId: "mock-start-error-request", code: "MOCK_START_ERROR" });
    expect(flow.getSnapshot().error?.message).not.toContain("sensitive response");
    expect(flow.getSnapshot().reconcileRequired).toBe(status === 409 || status >= 500);
  });
  it("requires authoritative reconciliation after timeout and never retries automatically", async () => {
    const adapter = mockMetadataAdapter(); adapter.start = vi.fn(async () => { throw new ApiError("timeout", "Timed out."); });
    const flow = await ready(adapter); await flow.start();
    expect(await flow.start()).toBe(false); expect(adapter.start).toHaveBeenCalledOnce();
    adapter.load = async () => ({ ...mockSnapshot(), startState: "unknown" });
    await flow.load(); expect(flow.getReadiness().canStart).toBe(false);
    adapter.load = async () => ({ ...mockSnapshot(), startState: "started", startedJob: { accepted: true, jobId: "mock-job", statusLabel: "Mock running" } });
    await flow.load(); expect(flow.getSnapshot().phase).toBe("started");
    expect(adapter.start).toHaveBeenCalledOnce();
  });
  it("rejects an ambiguous start response without reporting success", async () => {
    const adapter = mockMetadataAdapter(); adapter.start = async () => ({ accepted: true, jobId: "different-job", statusLabel: "Mock unknown" });
    const flow = await ready(adapter); expect(await flow.start()).toBe(false);
    expect(flow.getSnapshot().startedJob).toBeUndefined(); expect(flow.getSnapshot().reconcileRequired).toBe(true);
  });
  it.each([[2_000, true], [2_001, true], [50_000, true], [50_001, false]] as const)("uses authoritative row count %s without treating 2,000 as a ceiling", async (dataRowCount, allowed) => {
    const snapshot = mockSnapshot(); const sheet = { ...mockSheet, dataRowCount };
    const adapter = mockMetadataAdapter({ ...snapshot, workbooks: { current: { ...snapshot.workbooks.current!, sheets: [sheet] } } });
    const flow = createMetadataFlow("mock-job", metadataForm(), adapter); await flow.load(); flow.selectSheet("current", sheet.sheetName);
    flow.setHeader("current", { metadataKey: metadataKey(sheet), row: 3 }); flow.selectKey("current", "mock-key-id");
    expect(flow.getReadiness().canStart).toBe(allowed);
  });
  it.each(["size", "rows", "bounds", "validation", "upload"])("blocks missing/invalid %s evidence", async (missing) => {
    const snapshot = mockSnapshot(); const workbook = snapshot.workbooks.current!;
    const sheet = { ...mockSheet, ...(missing === "rows" ? { dataRowCount: undefined } : {}), ...(missing === "bounds" ? { headerRowBounds: undefined } : {}) };
    const adapter: MetadataAdapter = mockMetadataAdapter({ ...snapshot, workbooks: { current: { ...workbook, sheets: [sheet], sizeBytes: missing === "size" ? undefined : 100, errors: missing === "validation" ? ["Mock blocking backend validation"] : [], uploadConfirmed: missing !== "upload" } } });
    const flow = createMetadataFlow("mock-job", metadataForm(), adapter); await flow.load(); flow.selectSheet("current", sheet.sheetName);
    flow.setHeader("current", { metadataKey: metadataKey(sheet), row: 3 }); flow.selectKey("current", "mock-key-id");
    expect(flow.getReadiness().canStart).toBe(false);
  });
  it("blocks an oversized server-verified workbook even when the selected local file is small", async () => {
    const snapshot = mockSnapshot();
    const adapter = mockMetadataAdapter({ ...snapshot, workbooks: { current: { ...snapshot.workbooks.current!, sizeBytes: 25 * 1024 * 1024 + 1 } } });
    const flow = await ready(adapter);
    expect(flow.getReadiness().canStart).toBe(false);
    expect(flow.getReadiness().blockers.join(" ")).toContain("25 MB hard ceiling");
  });
  it("does not invent key requirements and permits an omitted key only when explicitly optional", async () => {
    const snapshot = mockSnapshot();
    for (const keyRule of ["unknown", "optional"] as const) {
      const adapter = mockMetadataAdapter({ ...snapshot, workbooks: { current: { ...snapshot.workbooks.current!, keyRule } } });
      const flow = await ready(adapter); flow.selectKey("current", null);
      expect(flow.getReadiness().canStart).toBe(keyRule === "optional");
    }
  });
});
