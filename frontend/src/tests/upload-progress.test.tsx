import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadProgressPanel } from "@/components/job/upload-progress-panel";
import { UploadError, type UploadWorkflowState } from "@/uploads/types";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const initial: UploadWorkflowState<symbol> = { jobId: "mock-test-job", confirmation: "waiting", files: [{ role: "current", filename: "current.xlsx", size: 100, phase: "waiting", attempts: 0, progress: null }] };
function render(state: UploadWorkflowState<symbol>, retry = false) {
  const onRetry = vi.fn(); const onCancel = vi.fn();
  act(() => root.render(<UploadProgressPanel state={state} canRetry={() => retry} onRetry={onRetry} onCancel={onCancel} />));
  return { onRetry, onCancel };
}

describe("upload status presentation without mock production integration", () => {
  it("shows filename, size and waiting state without inventing progress", () => {
    render(initial);
    expect(container.textContent).toContain("current.xlsx");
    expect(container.textContent).toContain("100 bytes");
    expect(container.textContent).toContain("Waiting");
    expect(container.querySelector("progress")).toBeNull();
    expect(container.textContent).not.toContain("Uploaded");
  });
  it("exposes actual transfer progress and a keyboard-accessible cancel action", () => {
    const { onCancel } = render({ ...initial, files: [{ ...initial.files[0], phase: "uploading", progress: { loaded: 25, total: 100 } }] });
    const progress = container.querySelector("progress")!;
    expect(progress.value).toBe(25); expect(progress.getAttribute("aria-label")).toBe("current workbook transfer");
    expect(container.textContent).toContain("25% transferred");
    const cancel = container.querySelector("button")!; cancel.focus();
    expect(document.activeElement).toBe(cancel);
    act(() => cancel.click()); expect(onCancel).toHaveBeenCalledWith("current");
  });
  it("renders indeterminate progress when native upload totals are unknown", () => {
    render({ ...initial, files: [{ ...initial.files[0], phase: "uploading", progress: { loaded: 25, total: null } }] });
    expect(container.querySelector("progress")?.hasAttribute("value")).toBe(false);
    expect(container.textContent).toContain("Progress percentage unavailable");
  });
  it("does not turn 100% byte progress into server-confirmed success", () => {
    render({ ...initial, files: [{ ...initial.files[0], phase: "awaiting-confirmation", progress: { loaded: 100, total: 100 } }] });
    expect(container.textContent).toContain("Transfer complete. Verifying upload.");
    expect(container.textContent).not.toContain("Uploaded and verified");
  });
  it("shows retry only when permitted, while rendering user filenames as text", () => {
    const state: UploadWorkflowState<symbol> = { ...initial, files: [{ ...initial.files[0], filename: "<img src=x>.xlsx", phase: "failed", error: new UploadError("network", "Upload connection failed.") }] };
    const { onRetry } = render(state, true);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("connection failed");
    act(() => container.querySelector("button")!.click()); expect(onRetry).toHaveBeenCalledWith("current");
    render(state, false); expect(container.querySelector("button")).toBeNull();
  });
  it("distinguishes confirmation failure from transfer failure and shows verified success only from state", () => {
    render({ ...initial, confirmation: "failed", confirmationError: { message: "Backend confirmation failed." }, files: [{ ...initial.files[0], phase: "awaiting-confirmation" }] });
    expect(container.textContent).toContain("Verifying upload");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Backend confirmation failed.");
    render({ ...initial, confirmation: "confirmed", result: { manifest: Symbol("unit-test only"), requestIds: [] }, files: [{ ...initial.files[0], phase: "uploaded" }] });
    expect(container.textContent).toContain("Uploaded and verified");
    expect(container.textContent).toContain("All workbooks uploaded");
  });
});
