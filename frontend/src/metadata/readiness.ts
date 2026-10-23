import { workflowConfigurationSchema, type WorkflowConfiguration } from "@/schemas/job-creation";
import { headerConfirmed, validHeaderRow, workbookRowLimit } from "@/lib/workflow-readiness";
import { MAX_WORKBOOK_BYTES } from "@/lib/workbook-limits";
import type { MetadataAdapter, MetadataFlowState } from "./types";
import type { WorkbookRole } from "@/uploads/types";

export function requiredWorkbookRoles(configuration: WorkflowConfiguration, currentRoles: readonly WorkbookRole[] = ["current"]): WorkbookRole[] {
  return [...currentRoles, ...(configuration.standardize || configuration.update ? ["main" as const] : [])];
}

export function getMetadataReadiness(state: MetadataFlowState, configuration: WorkflowConfiguration, jobId: string, adapter?: MetadataAdapter, currentRoles: readonly WorkbookRole[] = ["current"]) {
  const blockers: string[] = [];
  if (!workflowConfigurationSchema.safeParse(configuration).success) blockers.push("Complete the required local configuration.");
  if (!state.snapshot || state.snapshot.jobId !== jobId || !jobId.trim()) blockers.push("A verified backend job and workbook metadata are required.");
  if (!state.snapshot?.serverRevision.trim()) blockers.push("The authoritative server revision is unavailable.");
  if (state.snapshot?.startState !== "not-started") blockers.push("Confirm the backend job has not already started.");
  if (state.reconcileRequired) blockers.push("Reload backend job state before another Start attempt.");
  if (["loading", "saving", "starting", "started"].includes(state.phase)) blockers.push("Wait for the current operation to finish.");
  if (!adapter?.persistSelections || !adapter.start) blockers.push("A documented selection-persistence and workflow-start contract is required.");
  blockers.push(...state.snapshot?.errors ?? []);
  for (const role of requiredWorkbookRoles(configuration, currentRoles)) {
    const workbook = state.snapshot?.workbooks[role];
    if (!workbook) { blockers.push(`${role}: awaiting backend metadata.`); continue; }
    if (!workbook.uploadConfirmed) blockers.push(`${role}: upload must be server-confirmed.`);
    if (!workbook.workbookVersion.trim()) blockers.push(`${role}: workbook version is missing.`);
    if (typeof workbook.sizeBytes !== "number" || !Number.isSafeInteger(workbook.sizeBytes) || workbook.sizeBytes < 0) blockers.push(`${role}: verified file size is unavailable.`);
    else if (workbook.sizeBytes > MAX_WORKBOOK_BYTES) blockers.push(`${role}: exceeds the 25 MB hard ceiling.`);
    blockers.push(...workbook.errors.map((error) => `${role}: ${error}`));
    const choice = state.choices[role] ?? { sheetName: null, keyColumnId: null, header: null };
    if (role !== "current" && role !== "main") {
      const primary = state.choices.current;
      // Each workbook is a separate file with its own single sheet, so sheet names legitimately differ; the backend reads each slot's own sheet_name.
      if (primary?.header && choice.header && choice.header.row !== primary.header.row) blockers.push(`${role}: use the primary current workbook's header row; the processing pipeline shares that setting.`);
      if (configuration.update && primary?.keyColumnId && choice.keyColumnId && choice.keyColumnId !== primary.keyColumnId) blockers.push(`${role}: use the primary current workbook's key column; the processing pipeline shares that setting.`);
    }
    const sheets = workbook.sheets.filter((sheet) => sheet.sheetName === choice.sheetName);
    if (sheets.length !== 1) { blockers.push(`${role}: select an available worksheet.`); continue; }
    const sheet = sheets[0];
    if (sheet.columns?.length === 0) blockers.push(`${role}: no nonempty headers were found.`);
    if (choice.header && sheet.columnsHeaderRow !== undefined && sheet.columnsHeaderRow !== choice.header.row) blockers.push(`${role}: reload metadata for the corrected header row.`);
    if (sheet.workbookVersion !== workbook.workbookVersion) blockers.push(`${role}: worksheet metadata belongs to a different workbook version.`);
    const limit = workbookRowLimit(sheet);
    if (limit === "unknown") blockers.push(`${role}: verified row count is unavailable.`);
    if (limit === "rejected") blockers.push(`${role}: exceeds the 50,000-row hard ceiling.`);
    if (!sheet.headerRowBounds || !validHeaderRow(sheet.headerRowBounds.min, sheet.headerRowBounds)) blockers.push(`${role}: backend header bounds and indexing are unavailable or unsupported.`);
    if (!headerConfirmed(sheet, choice.header)) blockers.push(`${role}: explicitly confirm the header row.`);
    if (workbook.keyRule === "unknown") blockers.push(`${role}: backend key-selection requirements are unknown.`);
    if (workbook.keyRule === "required" && !choice.keyColumnId) blockers.push(`${role}: select a required key column.`);
    if (workbook.keyRule !== "not-applicable" && (workbook.keyRule === "required" || choice.keyColumnId)) {
      if (!choice.header || sheet.columnsHeaderRow !== choice.header.row || !sheet.columns) blockers.push(`${role}: reload backend columns for the confirmed header.`);
      if (choice.keyColumnId && sheet.columns?.filter((column) => column.id === choice.keyColumnId).length !== 1) blockers.push(`${role}: select an available key column.`);
    }
  }
  return { canStart: blockers.length === 0, blockers };
}
