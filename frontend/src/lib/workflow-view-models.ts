import { headerConfirmed, metadataKey } from "./workflow-readiness";
import type { HeaderConfirmation, HeaderConfirmationViewModel, WorkbookMetadata } from "@/types/workbook";
import type { ArtifactViewModel } from "@/types/workflow";
import type { MatchType, OutputPolicy } from "@/types/review";

export function getHeaderConfirmationViewModel(
  metadata?: WorkbookMetadata,
  confirmation?: HeaderConfirmation | null,
): HeaderConfirmationViewModel {
  if (!metadata) return { state: "pending-metadata", detectedRow: null, selectedRow: null };
  const confirmed = headerConfirmed(metadata, confirmation);
  return {
    state: confirmed ? "confirmed" : "awaiting-confirmation",
    metadataKey: metadataKey(metadata),
    detectedRow: metadata.detectedHeaderRow ?? null,
    selectedRow: confirmed && confirmation ? confirmation.row : null,
  };
}

// Expected presentation only: no existence claim, URL, or export operation.
export function getExpectedArtifacts(policy: OutputPolicy): readonly ArtifactViewModel[] {
  return [
    { kind: "final-xlsx", base: policy === "both" || policy === "update_only" ? "main-derived" : "current-derived", availability: "awaiting-backend" },
    { kind: "change-report-json", availability: "awaiting-backend" },
    { kind: "review-summary-markdown", availability: "awaiting-backend" },
  ];
}

export const updateMatchGuidance = {
  exact: "Requires explicit human review; confidence is not approval.",
  normalized: "Requires explicit human review; confidence is not approval.",
  ambiguous: "Never auto-apply. A human must resolve the ambiguity.",
  duplicate: "Requires human resolution of duplicate matches.",
  conflict: "Requires human resolution of conflicting values.",
  unmatched: "Skip and report this current row; do not insert it into the main workbook.",
} as const satisfies Record<MatchType, string>;
