import { DEMO_WORKING_ROWS, MAX_DATA_ROWS, MAX_HEADER_ROW } from "@/lib/workbook-limits";
import type { HeaderConfirmation, HeaderRowBounds, WorkbookMetadata } from "@/types/workbook";
import type { WorkflowReadiness, WorkflowReadinessInput } from "@/types/workflow-readiness";

export function metadataKey(metadata: WorkbookMetadata) {
  return JSON.stringify([metadata.workbookVersion, metadata.sheetName, metadata.dataRowCount, metadata.detectedHeaderRow, metadata.headerRowBounds, metadata.columnsHeaderRow, metadata.columns]);
}

export function validHeaderRow(row: number, bounds?: HeaderRowBounds) {
  const { min, max, indexBase } = bounds ?? { min: 1, max: MAX_HEADER_ROW, indexBase: 1 };
  return (indexBase === 0 || indexBase === 1) && Number.isInteger(min) && Number.isInteger(max)
    && min >= indexBase && max >= min && max <= MAX_HEADER_ROW - 1 + indexBase
    && Number.isInteger(row) && row >= min && row <= max;
}

function hasWorkbookIdentity(metadata: WorkbookMetadata) {
  return typeof metadata.workbookVersion === "string" && metadata.workbookVersion.trim() !== ""
    && typeof metadata.sheetName === "string" && metadata.sheetName.trim() !== "";
}

export function headerConfirmed(metadata?: WorkbookMetadata, confirmation?: HeaderConfirmation | null) {
  return Boolean(metadata && hasWorkbookIdentity(metadata) && confirmation && confirmation.metadataKey === metadataKey(metadata) && validHeaderRow(confirmation.row, metadata.headerRowBounds));
}

export function workbookRowLimit(metadata?: WorkbookMetadata): "unknown" | "supported" | "large" | "rejected" {
  if (!metadata || typeof metadata.dataRowCount !== "number" || !Number.isSafeInteger(metadata.dataRowCount) || metadata.dataRowCount < 0) return "unknown";
  if (metadata.dataRowCount > MAX_DATA_ROWS) return "rejected";
  if (metadata.dataRowCount > DEMO_WORKING_ROWS || metadata.topIssuesOnly) return "large";
  return "supported";
}

export function getWorkflowReadiness(input: WorkflowReadinessInput): WorkflowReadiness {
  const blockers: string[] = [];
  if (!input.localFormValid) blockers.push("Complete the required configuration.");
  const files = [{ label: "Current workbook", metadata: input.currentMetadata, header: input.currentHeader }];
  if (input.requiresMain) files.push({ label: "Master workbook", metadata: input.mainMetadata, header: input.mainHeader });
  let rejected = false;
  for (const file of files) {
    const limit = workbookRowLimit(file.metadata);
    if (limit === "unknown") blockers.push(`${file.label}: awaiting reliable workbook metadata.`);
    if (file.metadata && !hasWorkbookIdentity(file.metadata)) blockers.push(`${file.label}: metadata must identify the workbook version and selected sheet.`);
    if (limit === "rejected") {
      rejected = true;
      blockers.push(`${file.label}: exceeds the 50,000-row hard ceiling.`);
    }
    if (!headerConfirmed(file.metadata, file.header)) blockers.push(`${file.label}: confirm its header row before starting.`);
  }
  if (!input.backendReady) blockers.push("Backend integration is not connected.");
  return {
    canPreview: input.localFormValid && !rejected,
    canStartRealJob: blockers.length === 0,
    blockers,
  };
}
