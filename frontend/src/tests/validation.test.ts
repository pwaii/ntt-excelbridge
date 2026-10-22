import { describe, expect, it } from "vitest";
import { jobCreationSchema, workbookFileSchema } from "@/schemas/job-creation";
import { MAX_WORKBOOK_BYTES } from "@/lib/workbook-limits";
import { getOutputPolicy, outputPolicies } from "@/lib/output-policy";
import { getWorkflowReadiness, headerConfirmed, metadataKey, workbookRowLimit } from "@/lib/workflow-readiness";
import type { WorkbookMetadata } from "@/types/workbook";

function workbook(name = "current.xlsx", size?: number) {
  const file = new File(["test workbook bytes"], name);
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

const valid = () => ({ currentFile: workbook(), comment_name: "Profit", outputHeader: "profit", mainFile: null, standardize: false, update: false });
const metadata: WorkbookMetadata = { workbookVersion: "s3-version-1", sheetName: "Actual sheet from backend", dataRowCount: 2_000, detectedHeaderRow: 3 };

describe("job configuration schema", () => {
  it("enforces the backend OpenAPI comment_name length while keeping Prompt as the display label", () => {
    expect(jobCreationSchema.safeParse({ ...valid(), comment_name: "x".repeat(200) }).success).toBe(true);
    const result = jobCreationSchema.safeParse({ ...valid(), comment_name: "x".repeat(201) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["comment_name"], message: "Prompt must contain at most 200 characters." })]));
  });
  it.each([
    ["missing current file", { currentFile: null }, "currentFile"],
    ["empty prompt", { comment_name: "  \t " }, "comment_name"],
    ["empty header", { outputHeader: "   " }, "outputHeader"],
    ["a filename string instead of a File", { currentFile: "current.xlsx" }, "currentFile"],
    ["a file-shaped object", { currentFile: { name: "current.xlsx", size: 12 } }, "currentFile"],
  ])("rejects %s", (_name, patch, field) => {
    const result = jobCreationSchema.safeParse({ ...valid(), ...patch });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });

  it("trims required text without interpreting it or rewriting formulas", () => {
    const result = jobCreationSchema.parse({ ...valid(), comment_name: "  =SUM(A1:A2)  ", outputHeader: "  +Profit  " });
    expect(result.comment_name).toBe("=SUM(A1:A2)");
    expect(result.outputHeader).toBe("+Profit");
    expect(result).not.toHaveProperty("prompt");
  });

  it("defaults omitted optional booleans to false", () => {
    const { standardize: _standardize, update: _update, ...values } = valid();
    const result = jobCreationSchema.parse(values);
    expect(result.standardize).toBe(false);
    expect(result.update).toBe(false);
  });

  it.each(["input.xls", "input.xlsm", "input.csv", "input.xlsx.exe"])("rejects %s", (name) => {
    expect(workbookFileSchema.safeParse(workbook(name)).success).toBe(false);
  });

  it("accepts the exact byte ceiling and uppercase XLSX, rejecting only above it", () => {
    expect(workbookFileSchema.safeParse(workbook("input.XLSX", MAX_WORKBOOK_BYTES)).success).toBe(true);
    expect(workbookFileSchema.safeParse(workbook("input.xlsx", MAX_WORKBOOK_BYTES + 1)).success).toBe(false);
  });

  it.each([[false, false, "neither"], [true, false, "standardize_only"], [false, true, "update_only"], [true, true, "both"]] as const)(
    "supports standardize=%s / update=%s with the correct main-file requirement", (standardize, update, policy) => {
      const values = { ...valid(), standardize, update };
      expect(getOutputPolicy(standardize, update)).toBe(policy);
      expect(jobCreationSchema.safeParse(values).success).toBe(!standardize && !update);
      expect(jobCreationSchema.safeParse({ ...values, mainFile: workbook("main.xlsx") }).success).toBe(true);
    },
  );

  it("validates a supplied main file even when operations are disabled", () => {
    expect(jobCreationSchema.safeParse({ ...valid(), mainFile: workbook("bad.xls") }).success).toBe(false);
    expect(jobCreationSchema.safeParse({ ...valid(), mainFile: workbook("main.xlsx", MAX_WORKBOOK_BYTES + 1) }).success).toBe(false);
    expect(jobCreationSchema.safeParse({ ...valid(), mainFile: "main.xlsx" }).success).toBe(false);
  });
});

describe("ADR D2/D7 policy semantics", () => {
  it.each(["neither", "standardize_only"] as const)("%s names the current-derived output", (mode) => {
    expect(outputPolicies[mode].description).toContain("new current workbook");
  });
  it.each(["update_only", "both"] as const)("%s names a new main workbook and explains skipped rows", (mode) => {
    const description = outputPolicies[mode].description;
    expect(description).toContain("new main workbook");
    expect(description).toContain("skipped and reported");
    expect(description).not.toContain("overwrite");
  });
  it("specifies standardization before matching", () => {
    expect(outputPolicies.both.description).toContain("Standardize current data, then");
    expect(outputPolicies.both.description).toContain("use those values to match");
  });
});

describe("ADR D1/D10 readiness", () => {
  const confirmation = { metadataKey: metadataKey(metadata), row: 3 };
  it("allows local validation without claiming real-job readiness", () => {
    const result = getWorkflowReadiness({ localFormValid: true, requiresMain: false });
    expect(result.canPreview).toBe(true);
    expect(result.canStartRealJob).toBe(false);
    expect(result.blockers.join(" ")).toContain("awaiting reliable workbook metadata");
  });
  it("requires current and main header confirmations when both workbooks are used", () => {
    const base = { localFormValid: true, requiresMain: true, currentMetadata: metadata, mainMetadata: metadata, backendReady: true };
    expect(getWorkflowReadiness(base).canStartRealJob).toBe(false);
    expect(getWorkflowReadiness({ ...base, currentHeader: confirmation }).canStartRealJob).toBe(false);
    expect(getWorkflowReadiness({ ...base, currentHeader: confirmation, mainHeader: confirmation }).canStartRealJob).toBe(true);
  });
  it.each(["workbookVersion", "sheetName"] as const)("rejects metadata without a nonblank %s binding", (field) => {
    const unbound = { ...metadata, [field]: "   " };
    const header = { metadataKey: metadataKey(unbound), row: 3 };
    expect(headerConfirmed(unbound, header)).toBe(false);
    const readiness = getWorkflowReadiness({ localFormValid: true, requiresMain: false, currentMetadata: unbound, currentHeader: header, backendReady: true });
    expect(readiness.canStartRealJob).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("workbook version and selected sheet");
  });
  it("invalidates a confirmation on version, sheet, or metadata changes", () => {
    expect(headerConfirmed(metadata, confirmation)).toBe(true);
    expect(headerConfirmed({ ...metadata, workbookVersion: "new-version" }, confirmation)).toBe(false);
    expect(headerConfirmed({ ...metadata, sheetName: "Different sheet" }, confirmation)).toBe(false);
    expect(headerConfirmed(metadata, { ...confirmation, row: 0 })).toBe(false);
    expect(headerConfirmed(metadata, { ...confirmation, row: 21 })).toBe(false);
  });
  it.each([[2_000, "supported"], [2_001, "large"], [50_000, "large"], [50_001, "rejected"]] as const)(
    "handles %s data rows as %s", (dataRowCount, status) => {
      const known = { ...metadata, dataRowCount };
      expect(workbookRowLimit(known)).toBe(status);
      const result = getWorkflowReadiness({ localFormValid: true, requiresMain: false, currentMetadata: known, currentHeader: { metadataKey: metadataKey(known), row: 3 }, backendReady: true });
      expect(result.canStartRealJob).toBe(status !== "rejected");
    },
  );
  it("blocks the main workbook above the hard ceiling, but never guesses row counts", () => {
    expect(workbookRowLimit()).toBe("unknown");
    expect(workbookRowLimit({ ...metadata, dataRowCount: NaN })).toBe("unknown");
    const result = getWorkflowReadiness({ localFormValid: true, requiresMain: true, currentMetadata: metadata, mainMetadata: { ...metadata, dataRowCount: 50_001 }, backendReady: true });
    expect(result.canPreview).toBe(false);
    expect(result.canStartRealJob).toBe(false);
  });
});
