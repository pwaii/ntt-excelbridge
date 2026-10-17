import type { HeaderConfirmation, WorkbookMetadata } from "./workbook";

export interface WorkflowReadinessInput {
  localFormValid: boolean;
  requiresMain: boolean;
  currentMetadata?: WorkbookMetadata;
  mainMetadata?: WorkbookMetadata;
  currentHeader?: HeaderConfirmation | null;
  mainHeader?: HeaderConfirmation | null;
  // Only a real adapter may establish upload/server prerequisites.
  backendReady?: boolean;
}

export interface WorkflowReadiness {
  canPreview: boolean;
  canStartRealJob: boolean;
  blockers: readonly string[];
}
