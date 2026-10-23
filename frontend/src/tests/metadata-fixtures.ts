// Synthetic normalized UI fixtures only, not backend DTOs or actual inspection.
import { vi } from "vitest";
import type { MetadataAdapter, MetadataSnapshot } from "@/metadata/types";
import type { WorkbookMetadata } from "@/types/workbook";

export const metadataForm = (update = false) => ({ currentFile: new File(["mock"], "current.xlsx"), currentFiles: [new File(["mock"], "current.xlsx")], mainFile: update ? new File(["mock"], "main.xlsx") : null, comment_name: "Profit", outputHeader: "profit", addColumn: false, standardize: false, update });
export const mockSheet: WorkbookMetadata = {
  workbookVersion: "mock-version", sheetName: "Mock source sheet", dataRowCount: 100, detectedHeaderRow: 3,
  headerRowBounds: { min: 1, max: 20, indexBase: 1 }, columnsHeaderRow: 3,
  columns: [{ id: "mock-key-id", label: "Mock business key" }],
};
export function mockSnapshot(): MetadataSnapshot {
  const workbook = { workbookVersion: "mock-version", uploadConfirmed: true, sizeBytes: 100, sheets: [mockSheet, { ...mockSheet, sheetName: "Mock alternate sheet" }], keyRule: "required" as const, warnings: [], errors: [] };
  return { jobId: "mock-job", serverRevision: "mock-server-revision", startState: "not-started", workbooks: { current: workbook, main: workbook }, errors: [] };
}
export function mockMetadataAdapter(snapshot = mockSnapshot()): MetadataAdapter {
  return {
    load: vi.fn(async () => snapshot),
    persistSelections: vi.fn(async (_id, _input, selectionKey) => ({ selectionKey, serverRevision: "mock-saved-revision", requestId: "mock-save-request" })),
    start: vi.fn(async () => ({ accepted: true as const, jobId: "mock-job", statusLabel: "Mock backend-started status", requestId: "mock-start-request" })),
  };
}
