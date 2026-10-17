import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeaderRowConfirmation } from "@/components/job/header-row-confirmation";
import { LargeFileWarning } from "@/components/job/large-file-warning";
import { CellText } from "@/components/ui/cell-text";
import { metadataKey } from "@/lib/workflow-readiness";
import type { HeaderConfirmation, WorkbookMetadata } from "@/types/workbook";

const metadata: WorkbookMetadata = { workbookVersion: "actual-backend-version", sheetName: "Actual sheet", dataRowCount: 100, detectedHeaderRow: 3 };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function Harness({ known }: { known?: WorkbookMetadata }) {
  const [confirmation, setConfirmation] = useState<HeaderConfirmation | null>(null);
  return <HeaderRowConfirmation id="header" label="Current workbook" metadata={known} confirmation={confirmation} onChange={setConfirmation} />;
}

function setRow(value: string) {
  const input = container.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("header row confirmation", () => {
  it("does not invent a detected row before metadata exists", () => {
    act(() => root.render(<Harness />));
    expect(container.textContent).toContain("Awaiting workbook metadata");
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
  it("shows the detected row, accepts correction, and invalidates on edit/version change", () => {
    act(() => root.render(<Harness known={metadata} />));
    expect(container.textContent).toContain("Detected header row: 3");
    setRow("5");
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Row 5 confirmed");
    setRow("6");
    expect(container.querySelector('[role="status"]')).toBeNull();
    setRow("0");
    expect(container.querySelector("button")!.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    setRow("4");
    act(() => container.querySelector("button")!.click());
    act(() => root.render(<Harness known={{ ...metadata, workbookVersion: "replacement-version" }} />));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("input")!.value).toBe("3");
    expect(container.querySelector("button")!.disabled).toBe(false);
  });
  it("restores a previously confirmed corrected row for matching metadata", () => {
    act(() => root.render(<HeaderRowConfirmation id="header" label="Current workbook" metadata={metadata} confirmation={{ metadataKey: metadataKey(metadata), row: 5 }} onChange={() => {}} />));
    expect(container.querySelector("input")!.value).toBe("5");
    expect(container.textContent).toContain("Row 5 confirmed");
  });
});

describe("large file notice", () => {
  it("shows no row-based warning without reliable metadata", () => {
    expect(renderToStaticMarkup(<LargeFileWarning />)).toBe("");
    expect(renderToStaticMarkup(<LargeFileWarning metadata={metadata} />)).toBe("");
  });
  it("warns above working size without rejecting, including explicit backend warnings", () => {
    expect(renderToStaticMarkup(<LargeFileWarning metadata={{ ...metadata, dataRowCount: 2_001 }} />)).toContain("warning, not a rejection");
    expect(renderToStaticMarkup(<LargeFileWarning metadata={{ ...metadata, topIssuesOnly: true }} />)).toContain("top issues only");
  });
  it("rejects confirmed row counts above 50,000", () => {
    const html = renderToStaticMarkup(<LargeFileWarning metadata={{ ...metadata, dataRowCount: 50_001 }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("cannot be processed");
  });
});

describe("formula-vs-data display", () => {
  it.each(["=SUM(A1:A2)", "+1", "-1", "@SUM(A1:A2)", '<img src=x onerror="alert(1)">'])("renders raw data as text: %s", (value) => {
    act(() => root.render(<CellText cell={{ origin: "data", value }} />));
    expect(container.textContent).toBe(value);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
  it("does not corrupt an approved formula by escaping its leading character", () => {
    act(() => root.render(<CellText cell={{ origin: "approved-formula", value: "=SUM(A1:A2)", approvalId: "trusted-review-id" }} />));
    expect(container.textContent).toBe("=SUM(A1:A2)");
  });
});
