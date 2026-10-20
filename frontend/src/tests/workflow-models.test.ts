import { describe, expect, it } from "vitest";
import { getExpectedArtifacts, getHeaderConfirmationViewModel, updateMatchGuidance } from "@/lib/workflow-view-models";
import { metadataKey } from "@/lib/workflow-readiness";
import { proposalStatusLabels } from "@/types/review";
import type { WorkbookMetadata } from "@/types/workbook";
import { mockCellContents, mockPatternRules, mockUpdateMatches, mockPendingReview, mockRevisionConflict } from "@/mocks/workflow-fixtures";

// Explicit synthetic metadata, never used by the application.
const metadata: WorkbookMetadata = {
  workbookVersion: "mock-version-1", sheetName: "Mock selected sheet", dataRowCount: 100, detectedHeaderRow: 3,
};

describe("header view model (ADR D10)", () => {
  it("has no detected or selected row while awaiting metadata", () => {
    expect(getHeaderConfirmationViewModel()).toEqual({ state: "pending-metadata", detectedRow: null, selectedRow: null });
  });
  it("does not silently confirm a backend guess", () => {
    expect(getHeaderConfirmationViewModel(metadata)).toMatchObject({ state: "awaiting-confirmation", detectedRow: 3, selectedRow: null });
  });
  it("preserves a human correction, but invalidates it when the detected row changes", () => {
    const confirmation = { metadataKey: metadataKey(metadata), row: 4 };
    expect(getHeaderConfirmationViewModel(metadata, confirmation)).toMatchObject({ state: "confirmed", detectedRow: 3, selectedRow: 4 });
    expect(getHeaderConfirmationViewModel({ ...metadata, detectedHeaderRow: 5 }, confirmation)).toMatchObject({ state: "awaiting-confirmation", detectedRow: 5, selectedRow: null });
  });
  it("allows correction when detection returned no guess", () => {
    const noGuess = { ...metadata, detectedHeaderRow: null };
    expect(getHeaderConfirmationViewModel(noGuess)).toMatchObject({ detectedRow: null, state: "awaiting-confirmation" });
    expect(getHeaderConfirmationViewModel(noGuess, { metadataKey: metadataKey(noGuess), row: 2 })).toMatchObject({ state: "confirmed", selectedRow: 2 });
  });
});

describe("future artifact presentation (ADR D2)", () => {
  it.each([
    ["neither", "current-derived"], ["standardize_only", "current-derived"],
    ["update_only", "main-derived"], ["both", "main-derived"],
  ] as const)("%s uses %s without claiming a downloadable artifact", (policy, base) => {
    const artifacts = getExpectedArtifacts(policy);
    expect(artifacts[0]).toEqual({ kind: "final-xlsx", base, availability: "awaiting-backend" });
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["final-xlsx", "change-report-json", "review-summary-markdown"]);
    expect(artifacts.every((artifact) => !("url" in artifact))).toBe(true);
  });
});

describe("ADR-aware mock coverage", () => {
  it("covers each persisted human-review state with pattern-level rules", () => {
    expect(new Set(mockPatternRules.map((rule) => rule.status))).toEqual(new Set(Object.keys(proposalStatusLabels)));
    expect(mockPatternRules.every((rule) => rule.kind === "value-pattern-rule")).toBe(true);
    expect(mockPatternRules[0].affectedCellCount).toBeGreaterThan(mockPatternRules[0].examples.length);
  });
  it("covers all six match labels without confidence-based acceptance", () => {
    expect(new Set(mockUpdateMatches.map((match) => match.matchType))).toEqual(new Set(Object.keys(updateMatchGuidance)));
    expect(mockUpdateMatches[0].confidence).toBe(0.99);
    expect(mockUpdateMatches[0].status).toBe("proposed");
    expect(mockUpdateMatches[2].status).toBe("proposed");
    expect(updateMatchGuidance.ambiguous).toContain("Never auto-apply");
    expect(updateMatchGuidance.unmatched).toContain("do not insert");
  });
  it("does not infer formula approval from the first character", () => {
    expect(mockCellContents[0].value.startsWith("=")).toBe(true);
    expect(mockCellContents[0].origin).toBe("data");
    expect(mockCellContents[2].origin).toBe("approved-formula");
    expect(mockCellContents[2].approvalId).toContain("mock-");
  });
  it("retains the submitted server revision and decisions on a conflict, requiring reload", () => {
    expect(mockRevisionConflict.state).toBe("reload-required");
    expect(mockRevisionConflict.httpStatus).toBe(409);
    expect(mockRevisionConflict.code).toBe("REVIEW_REVISION_CONFLICT");
    expect(mockRevisionConflict.submission).toBe(mockPendingReview.submission);
    expect(mockRevisionConflict.submission.revision.serverToken).toBe("mock-server-revision-A");
  });
});
