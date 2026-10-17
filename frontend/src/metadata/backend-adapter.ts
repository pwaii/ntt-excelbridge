import { ApiError } from "@/api/errors";
import type { JobsApi } from "@/api/jobs-api";
import type { components } from "@/api/generated/backend";
import { metadataKey } from "@/lib/workflow-readiness";
import type { MetadataAdapter, WorkbookChoices, WorkbookInspection } from "./types";

export function createBackendMetadataAdapter(api: JobsApi): MetadataAdapter {
  return {
    async load(id, choices, signal) {
      const { job, request_id } = await api.getJob(id, signal);
      const workbooks: Partial<Record<"current" | "main", WorkbookInspection>> = {};
      const persisted: Partial<Record<"current" | "main", WorkbookChoices["current"]>> = {};
      for (const role of (job.config.standardize || job.config.update ? ["current", "main"] : ["current"]) as ("current" | "main")[]) {
        const slot = role === "current" ? "input" : "main";
        if (!job.files?.[slot]?.uploaded) continue;
        const saved = job.workbook_selections?.[slot];
        const choice = choices[role];
        const name = choice.sheetName ?? saved?.sheet_name;
        const row = choice.header?.row ?? (!choice.sheetName ? saved?.header_row : undefined);
        const data = await api.getMetadata(id, slot, { ...(name ? { sheet_name: name } : {}), ...(row ? { header_row: row } : {}) }, signal);
        const sheets = data.sheets.map((sheet) => ({ workbookVersion: data.workbook_version, sheetName: sheet.name, dataRowCount: sheet.data_row_count, detectedHeaderRow: sheet.detected_header_row, columnsHeaderRow: sheet.header_row ?? undefined, columns: sheet.columns, headerRowBounds: { min: data.header_min, max: data.header_max, indexBase: data.index_base } }));
        workbooks[role] = { workbookVersion: data.workbook_version, sizeBytes: data.size_bytes, uploadConfirmed: true, sheets, keyRule: data.key_required ? "required" : "optional", warnings: [], errors: data.sheets.filter((sheet) => sheet.name === name).flatMap((sheet) => sheet.errors ?? []) };
        const sheet = sheets.find((item) => item.sheetName === saved?.sheet_name);
        if (job.configuration_confirmed && saved && sheet && saved.workbook_version === data.workbook_version && saved.header_confirmed && sheet.columnsHeaderRow === saved.header_row) persisted[role] = { sheetName: saved.sheet_name, header: { metadataKey: metadataKey(sheet), row: saved.header_row }, keyColumnId: saved.key_column ?? null };
      }
      const started = !["DRAFT", "UPLOADING", "UPLOADED"].includes(job.status);
      return { jobId: id, serverRevision: String(job.revision), requestId: request_id, workbooks, errors: [], persistedChoices: persisted as WorkbookChoices,
        startState: started ? "started" : "not-started", ...(started ? { startedJob: { accepted: true as const, jobId: id, statusLabel: job.status, requestId: request_id } } : {}) };
    },
    async persistSelections(id, input, selectionKey, serverRevision, signal) {
      const selections: components["schemas"]["SaveWorkbookConfiguration"]["selections"] = {};
      for (const role of (input.configuration.standardize || input.configuration.update ? ["current", "main"] : ["current"]) as ("current" | "main")[]) {
        const choice = input.choices[role];
        if (!choice.sheetName || !choice.header) throw new ApiError("configuration", "Confirm the worksheet header first.");
        const metadata = await api.getMetadata(id, role === "current" ? "input" : "main", { sheet_name: choice.sheetName, header_row: choice.header.row }, signal);
        const sheet = metadata.sheets.find((item) => item.name === choice.sheetName);
        const bound = { workbookVersion: metadata.workbook_version, sheetName: choice.sheetName, dataRowCount: sheet?.data_row_count, detectedHeaderRow: sheet?.detected_header_row, columnsHeaderRow: sheet?.header_row ?? undefined, columns: sheet?.columns, headerRowBounds: { min: metadata.header_min, max: metadata.header_max, indexBase: metadata.index_base } };
        if (metadataKey(bound) !== choice.header.metadataKey) throw new ApiError("protocol", "Workbook metadata changed. Confirm the header again.");
        selections[role === "current" ? "input" : "main"] = { sheet_name: choice.sheetName, header_row: choice.header.row, header_confirmed: true, key_column: choice.keyColumnId, workbook_version: metadata.workbook_version };
      }
      const revision = Number(serverRevision);
      if (!Number.isSafeInteger(revision)) throw new ApiError("protocol", "Invalid server revision.");
      const response = await api.saveConfiguration(id, { expected_revision: revision, selections }, signal);
      for (const [slot, value] of Object.entries(selections)) {
        const saved = response.job.workbook_selections?.[slot];
        if (!response.job.configuration_confirmed || !saved || saved.sheet_name !== value.sheet_name || saved.header_row !== value.header_row || saved.key_column !== value.key_column || saved.workbook_version !== value.workbook_version || !saved.header_confirmed) throw new ApiError("protocol", "Backend did not persist the confirmed choices.");
      }
      return { selectionKey, serverRevision: String(response.job.revision), requestId: response.request_id };
    },
    async start(id, revision, signal) {
      const response = await api.startJob(id, Number(revision), signal);
      if (["DRAFT", "UPLOADING", "UPLOADED", "FAILED", "CANCELLED"].includes(response.job.status)) throw new ApiError("protocol", "Workflow start was not accepted.");
      return { accepted: true, jobId: id, statusLabel: response.job.status, requestId: response.request_id };
    },
  };
}
