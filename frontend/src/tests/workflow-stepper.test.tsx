import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowStepper } from "@/components/job/workflow-stepper";
import type { StageState } from "@/lib/job-stages";

type StepperStage = { label: string; state: StageState };

const fiveStages: StepperStage[] = [
  { label: "Setup", state: "complete" },
  { label: "Data", state: "complete" },
  { label: "Quality", state: "active" },
  { label: "Changes", state: "pending" },
  { label: "Output", state: "pending" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

function render(stages: StepperStage[], selected: number, onSelect = vi.fn()) {
  act(() => root.render(<WorkflowStepper stages={stages} selected={selected} onSelect={onSelect} />));
}

describe("WorkflowStepper", () => {
  it("renders five tabs with correct aria-selected", () => {
    render(fiveStages, 2);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(5);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
  });

  it("complete and active tabs are enabled; pending tabs are disabled", () => {
    render(fiveStages, 2);
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs[0].disabled).toBe(false); // complete
    expect(tabs[1].disabled).toBe(false); // complete
    expect(tabs[2].disabled).toBe(false); // active
    expect(tabs[3].disabled).toBe(true);  // pending
    expect(tabs[4].disabled).toBe(true);  // pending
  });

  it("clicking a complete tab calls onSelect with its index", () => {
    const onSelect = vi.fn();
    render(fiveStages, 2, onSelect);
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => tabs[0].click());
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("clicking the active tab calls onSelect with its index", () => {
    const onSelect = vi.fn();
    render(fiveStages, 2, onSelect);
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => tabs[2].click());
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("renders 4 connectors for 5 stages", () => {
    render(fiveStages, 2);
    expect(container.querySelectorAll(".step-connector")).toHaveLength(4);
  });

  it("connectors carry data-left from the preceding stage state", () => {
    render(fiveStages, 2);
    const connectors = container.querySelectorAll(".step-connector");
    expect(connectors[0].getAttribute("data-left")).toBe("complete"); // after Setup(complete)
    expect(connectors[1].getAttribute("data-left")).toBe("complete"); // after Data(complete)
    expect(connectors[2].getAttribute("data-left")).toBe("active");   // after Quality(active)
    expect(connectors[3].getAttribute("data-left")).toBe("pending");  // after Changes(pending)
  });

  it("failed stage tab is enabled and has aria-label containing its state", () => {
    const stages: StepperStage[] = [
      { label: "Setup", state: "complete" },
      { label: "Data", state: "failed" },
      { label: "Quality", state: "pending" },
      { label: "Changes", state: "pending" },
      { label: "Output", state: "pending" },
    ];
    render(stages, 1);
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs[1].disabled).toBe(false);
    expect(tabs[1].getAttribute("aria-label")).toContain("failed");
  });
});
