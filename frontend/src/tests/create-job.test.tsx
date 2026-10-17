import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateJobPage } from "@/pages/create-job-page";
import { outputPolicies } from "@/lib/output-policy";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "@/auth/context";
import { JobFormActions } from "@/components/job/job-form-actions";

const testAuth: AuthContextValue = { state: { status: "authenticated", user: { subject: "test" } }, configurationIssues: [], canSignIn: true, login: async () => {}, logout: async () => {}, getValidToken: async () => "test-token", getReturnTo: () => "/jobs/new" };
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("VITE_AUTH_MODE", "cognito");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid");
  vi.stubEnv("VITE_S3_UPLOAD_ORIGINS", "https://contract-fixture.s3.us-east-1.amazonaws.com");
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={testAuth}><CreateJobPage /></AuthContext.Provider></MemoryRouter>); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function get<T extends Element>(selector: string): T {
  const result = container.querySelector<T>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
}

async function click(selector: string) {
  await act(async () => { get<HTMLElement>(selector).click(); });
}

async function selectFile(id: string, name: string) {
  const file = new File(["sample bytes"], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const input = get<HTMLInputElement>(`#${id}`);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

async function enterPrompt(value: string) {
  const field = get<HTMLTextAreaElement>("#prompt");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enterHeader(value: string) {
  const field = get<HTMLInputElement>("#output-header");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}


describe("job creation UI", () => {
  it("uses a real file picker and supports browse, replace, and remove", async () => {
    const input = get<HTMLInputElement>("#current-file");
    expect(input.type).toBe("file");
    expect(input.accept).toContain(".xlsx");
    const browse = vi.spyOn(input, "click");
    await click('[aria-label="Browse current workbook"]');
    expect(browse).toHaveBeenCalledOnce();
    await selectFile("current-file", "current.xlsx");
    expect(container.textContent).toContain("current.xlsx");
    expect(container.textContent).toContain("12 bytes");
    await click('[aria-label="Replace current workbook"]');
    expect(browse).toHaveBeenCalledTimes(2);
    await selectFile("current-file", "replacement.xlsx");
    expect(container.textContent).toContain("replacement.xlsx");
    expect(container.textContent).not.toContain("current.xlsx");
    await click('[aria-label="Remove current workbook"]');
    expect(container.textContent).not.toContain("replacement.xlsx");
    expect(container.textContent).toContain("No file selected");
  });

  it("accepts dropped XLSX files and rejects unsupported formats", async () => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["xlsx"], "dropped.xlsx")] } });
    await act(async () => { get<HTMLInputElement>("#current-file").nextElementSibling?.dispatchEvent(event); });
    expect(container.textContent).toContain("dropped.xlsx");
    await selectFile("current-file", "unsupported.xlsm");
    expect(get('[role="alert"]').textContent).toContain("Choose an .xlsx workbook");
    expect(container.textContent).toContain("dropped.xlsx");
  });

  it("updates all four output policies and conditionally requires a main file", async () => {
    const policy = () => get('[aria-labelledby="output-policy-title"]').textContent;
    expect(policy()).toContain(outputPolicies.neither.description);
    expect(container.querySelector("#main-file")).toBeNull();
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Customer segment");
    await enterHeader("customer_segment");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    await click('input[name="standardize"]');
    expect(policy()).toContain(outputPolicies.standardize_only.description);
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await selectFile("main-file", "reference.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    await click('input[name="update"]');
    expect(policy()).toContain(outputPolicies.both.description);
    await click('input[name="standardize"]');
    expect(policy()).toContain(outputPolicies.update_only.description);
    await click('input[name="update"]');
    expect(policy()).toContain(outputPolicies.neither.description);
    expect(container.querySelector("#main-file")).toBeNull();
    await click('input[name="update"]');
    expect(container.textContent).not.toContain("reference.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
  });

  it("uses one real creation action, removes the old preview and preserves reset", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Customer segment");
    await enterHeader("customer_segment");
    expect(get<HTMLButtonElement>('button[type="submit"]').textContent).toContain("Create job and upload files");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    expect(container.textContent).not.toContain("Preview configuration");
    const resetButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Reset form")!;
    await act(async () => { resetButton.click(); });
    expect(get<HTMLTextAreaElement>("#prompt").value).toBe("");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never invents workbook metadata", async () => {
    await click('input[name="update"]');
    const selectors = [...container.querySelectorAll("select")];
    expect(selectors).toHaveLength(3);
    expect(selectors.every((select) => select.disabled)).toBe(true);
    expect(selectors.every((select) => select.options.length === 1)).toBe(true);
    expect(container.textContent).toContain("No workbook has been inspected");
  });

  it("discloses advanced fields without losing an entered output header", async () => {
    const advanced = get<HTMLDetailsElement>("#advanced-settings");
    expect(advanced.open).toBe(false);
    await click("#advanced-settings > summary");
    expect(advanced.open).toBe(true);
    const header = get<HTMLInputElement>("#output-header");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(header, "profit");
      header.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("#advanced-settings > summary");
    await click('input[name="standardize"]');
    await click("#advanced-settings > summary");
    expect(header.value).toBe("profit");
    expect(get<HTMLSelectElement>("#main-sheet").disabled).toBe(true);
  });

  it("keeps the policy summary compact and exposes the exact behavior on demand", async () => {
    const policy = get('[aria-labelledby="output-policy-title"]');
    const summary = policy.querySelector('[aria-live="polite"]');
    expect(summary?.textContent).toContain("Current workbook copy");
    expect(policy.textContent).toContain("Approval required");
    expect(summary?.textContent).toContain("Preserved");
    const details = policy.querySelector("details");
    expect(details?.open).toBe(false);
    await click('input[name="update"]');
    expect(summary?.textContent).toContain("Master workbook copy");
    await click('[aria-labelledby="output-policy-title"] summary');
    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain(outputPolicies.update_only.description);
    expect(get<HTMLButtonElement>('button[type="submit"]').textContent).toContain("Create job and upload files");
  });

  it("rejects oversized files, clears errors on reset, and blocks blank prompts", async () => {
    const input = get<HTMLInputElement>("#current-file");
    const tooLarge = new File(["bytes"], "large.xlsx");
    Object.defineProperty(tooLarge, "size", { value: 25 * 1024 * 1024 + 1 });
    Object.defineProperty(input, "files", { configurable: true, value: [tooLarge] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(get('[role="alert"]').textContent).toContain("25 MB limit");
    const resetButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Reset form");
    await act(async () => { resetButton?.click(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("   ");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(container.textContent).toContain("a column prompt");
  });

  it("explains prerequisites and disables incomplete creation", () => {
    act(() => root.render(<JobFormActions canStart={false} onReset={() => {}} missingRequirements="Choose a current workbook." />));
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(container.textContent).toContain("Choose a current workbook");
    expect(container.textContent).not.toContain("Preview configuration");
  });

  it("populates the prompt from example chips and returns focus to the composer", async () => {
    const examples = get('[aria-label="Example column prompts"]');
    for (const text of ["Profit", "Growth Rate", "Net Revenue", "Profit Margin"]) {
      const chip = [...examples.querySelectorAll("button")].find((button) => button.textContent === text);
      await act(async () => { chip?.click(); });
      expect(get<HTMLTextAreaElement>("#prompt").value).toBe(text);
      await vi.waitFor(() => expect(document.activeElement?.id, text).toBe("prompt"));
      expect(chip?.getAttribute("aria-pressed")).toBe("true");
      expect(examples.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    }
    expect(container.textContent).not.toContain("Frontend-only preview ready");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps creation focused on the form without a workflow timeline or step navigation", async () => {
    expect(container.querySelector('[aria-labelledby="workflow-preview-title"]')).toBeNull();
    expect(container.querySelector('[aria-label="Workflow setup"]')).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    await enterHeader("profit");
    expect(container.textContent).not.toContain("Frontend-only preview ready");
    expect(container.textContent).not.toContain("No job has been created");
    expect(container.querySelector('[aria-labelledby="workflow-preview-title"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears the master workbook and processing selections on reset", async () => {
    await click('input[name="standardize"]');
    await click('input[name="update"]');
    await selectFile("main-file", "master.xlsx");
    expect(container.textContent).toContain("master.xlsx");
    const reset = [...container.querySelectorAll("button")].find((button) => button.textContent === "Reset form");
    await act(async () => { reset?.click(); });
    expect(container.querySelector("#main-file")).toBeNull();
    expect(get<HTMLInputElement>('input[name="standardize"]').checked).toBe(false);
    expect(get<HTMLInputElement>('input[name="update"]').checked).toBe(false);
    expect(container.textContent).not.toContain("master.xlsx");
    expect(get('[aria-labelledby="output-policy-title"]').textContent).toContain(outputPolicies.neither.description);
  });

  it("shows a touched prompt error and clears it when an example is chosen", async () => {
    const prompt = get<HTMLTextAreaElement>("#prompt");
    await act(async () => {
      prompt.focus();
      prompt.blur();
    });
    expect(prompt.getAttribute("aria-invalid")).toBe("true");
    expect(get('#prompt-error').textContent).toBe("Describe the column you want to add.");
    const example = [...container.querySelectorAll('[aria-label="Example column prompts"] button')].find((button) => button.textContent === "Profit");
    await act(async () => { (example as HTMLButtonElement).click(); });
    expect(prompt.value).toBe("Profit");
    expect(prompt.getAttribute("aria-invalid")).toBe("false");
    expect(container.querySelector("#prompt-error")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the output header and separates local validity from real job readiness", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    const header = get<HTMLInputElement>("#output-header");
    await act(async () => { header.focus(); header.blur(); });
    expect(get("#output-header-error").textContent).toBe("Enter the output column header.");
    await enterHeader("profit");
    expect(header.getAttribute("aria-invalid")).toBe("false");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    expect(get("#real-job-readiness").textContent).toContain("After upload, select the worksheet");
    expect(container.textContent).toContain("Awaiting workbook metadata");
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain("large file");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revalidates master removal/replacement and preserves valid inputs after rejection", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    await enterHeader("profit");
    await click('input[name="update"]');
    expect(container.querySelector('[role="note"]')?.textContent).toContain("not inserted automatically");
    await selectFile("main-file", "main-one.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    await selectFile("main-file", "bad.xls");
    expect(container.textContent).toContain("main-one.xlsx");
    expect(get<HTMLTextAreaElement>("#prompt").value).toBe("Profit");
    expect(get<HTMLInputElement>("#output-header").value).toBe("profit");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await selectFile("main-file", "main-two.xlsx");
    expect(container.textContent).not.toContain("main-one.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    await click('[aria-label="Remove master workbook"]');
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(get("#main-file-error").textContent).toContain("Select a master workbook");
  });

  it("accepts formula-looking prompt/header as untrusted text without executing anything", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt('<img src=x onerror="alert(1)">');
    await enterHeader("=SUM(A1:A2)");
    expect(get<HTMLInputElement>("#output-header").value).toBe("=SUM(A1:A2)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("No job has been created");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns keyboard focus to Browse after removing either workbook", async () => {
    await selectFile("current-file", "current.xlsx");
    get<HTMLButtonElement>('[aria-label="Remove current workbook"]').focus();
    await click('[aria-label="Remove current workbook"]');
    expect(document.activeElement).toBe(get('[aria-label="Browse current workbook"]'));
    await click('input[name="standardize"]');
    await selectFile("main-file", "main.xlsx");
    get<HTMLButtonElement>('[aria-label="Remove master workbook"]').focus();
    await click('[aria-label="Remove master workbook"]');
    expect(document.activeElement).toBe(get('[aria-label="Browse master workbook"]'));
  });

  it("exposes rejected replacement feedback to the keyboard-accessible Replace action", async () => {
    await selectFile("current-file", "valid.xlsx");
    await selectFile("current-file", "invalid.csv");
    const replace = get<HTMLButtonElement>('[aria-label="Replace current workbook"]');
    expect(replace.getAttribute("aria-describedby")).toContain("current-file-error");
    expect(get("#current-file-error").textContent).toContain("previous workbook is retained");
    await selectFile("current-file", "fixed.xlsx");
    expect(replace.getAttribute("aria-describedby")).toBe("current-file-hint");
    expect(container.querySelector("#current-file-error")).toBeNull();
  });

  it("blocks a forced submit after an invalid replacement and clears the previous preview", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    await enterHeader("profit");
    const submit = async () => act(async () => { get<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.textContent).not.toContain("Frontend-only preview ready");
    await selectFile("current-file", "bad.csv");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await submit();
    expect(container.textContent).not.toContain("Frontend-only preview ready");
    expect(container.textContent).toContain("current.xlsx");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects multiple dropped workbooks without losing the selected file", async () => {
    await selectFile("current-file", "keep.xlsx");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["a"], "a.xlsx"), new File(["b"], "b.xlsx")] } });
    await act(async () => { get(".workbook-dropzone").dispatchEvent(event); });
    expect(get("#current-file-error").textContent).toContain("Choose one workbook at a time");
    expect(container.textContent).toContain("keep.xlsx");
  });

  it("requires a non-whitespace output header and associates its feedback with the input", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    await enterHeader(" \t ");
    const header = get<HTMLInputElement>("#output-header");
    await act(async () => { header.focus(); header.blur(); });
    expect(header.required).toBe(true);
    expect(header.getAttribute("aria-invalid")).toBe("true");
    expect(header.getAttribute("aria-describedby")).toBe("output-header-error");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
  });

  it("removes stale main-file selection errors when neither operation requires a main file", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    await enterHeader("profit");
    await click('input[name="update"]');
    await selectFile("main-file", "main.xlsx");
    await selectFile("main-file", "bad.xls");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await click('input[name="update"]');
    expect(container.querySelector("#main-file-error")).toBeNull();
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    await click('input[name="update"]');
    expect(container.textContent).not.toContain("main.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
  });

  it("resets all local values, selection errors, and the preview confirmation", async () => {
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    await enterHeader("profit");
    const reset = [...container.querySelectorAll("button")].find((button) => button.textContent === "Reset form")!;
    await act(async () => { reset.click(); });
    expect(get<HTMLTextAreaElement>("#prompt").value).toBe("");
    expect(get<HTMLInputElement>("#output-header").value).toBe("");
    expect(container.textContent).not.toContain("current.xlsx");
    expect(container.textContent).not.toContain("Frontend-only preview ready");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
  });
});
