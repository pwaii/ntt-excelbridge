import type { WorkflowConfiguration } from "@/schemas/job-creation";
import type { WorkbookMetadata, HeaderConfirmation } from "@/types/workbook";
import type { WorkbookRole } from "@/uploads/types";

// TEMPORARY frontend adapter models, NOT a metadata/start API contract.
export interface WorkbookInspection {
  readonly workbookVersion: string;
  readonly uploadConfirmed: boolean;
  readonly sizeBytes?: number;
  readonly sheets: readonly WorkbookMetadata[];
  readonly keyRule: "required" | "optional" | "not-applicable" | "unknown";
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}
export interface StartedJob {
  readonly accepted: true; // Adapter must establish this from an unambiguous BE response.
  readonly jobId: string;
  readonly statusLabel: string;
  readonly requestId?: string;
}
export interface MetadataSnapshot {
  readonly persistedChoices?: WorkbookChoices;
  readonly jobId: string;
  readonly serverRevision: string;
  readonly requestId?: string;
  readonly startState: "not-started" | "started" | "unknown";
  readonly startedJob?: StartedJob;
  readonly workbooks: Readonly<Partial<Record<WorkbookRole, WorkbookInspection>>>;
  readonly errors: readonly string[];
}
export interface WorkbookChoice {
  readonly sheetName: string | null;
  readonly keyColumnId: string | null;
  readonly header: HeaderConfirmation | null;
}
export type WorkbookChoices = Readonly<Record<WorkbookRole, WorkbookChoice>>;
export interface FinalSelections {
  readonly configuration: WorkflowConfiguration;
  readonly choices: WorkbookChoices;
}
export interface MetadataAdapter {
  // load may map an existing documented endpoint. Header-corrected columns must
  // be returned by BE; never inspect files or invent an endpoint in the browser.
  load(jobId: string, choices: WorkbookChoices, signal: AbortSignal): Promise<MetadataSnapshot>;
  persistSelections?(jobId: string, input: FinalSelections, selectionKey: string, serverRevision: string, signal: AbortSignal): Promise<{ selectionKey: string; serverRevision: string; requestId?: string }>;
  start?(jobId: string, serverRevision: string, signal: AbortSignal): Promise<StartedJob>;
}
export interface MetadataFlowState {
  readonly configurationSaved?: boolean;
  readonly phase: "unavailable" | "loading" | "review" | "saving" | "starting" | "started" | "error";
  readonly snapshot?: MetadataSnapshot;
  readonly choices: WorkbookChoices;
  readonly error?: { message: string; requestId?: string; code?: string };
  readonly startedJob?: StartedJob;
  readonly reconcileRequired: boolean;
}
