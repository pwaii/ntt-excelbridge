import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateJobPage } from "@/pages/create-job-page";
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

async function selectTask(name: "addColumn" | "standardize" | "update") {
  await act(async () => { get<HTMLInputElement>(`input[name="${name}"]`).click(); });
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
  it("uses a real multi-file picker and supports selecting and removing current workbooks", async () => {
    const input = get<HTMLInputElement>("#current-file");
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain(".xlsx");
    const browse = vi.spyOn(input, "click");
    await click('[aria-label="Browse files"]');
    expect(browse).toHaveBeenCalledOnce();
    await selectFile("current-file", "current.xlsx");
    expect(container.textContent).toContain("current.xlsx");
    expect(container.textContent).toContain("12 bytes");
    await selectFile("current-file", "current-2.xlsx");
    expect(container.textContent).toContain("current-2.xlsx");
    await click('[aria-label="Remove current-2.xlsx"]');
    expect(container.textContent).not.toContain("current-2.xlsx");
    await click('[aria-label="Remove current.xlsx"]');
    expect(container.textContent).not.toContain("current.xlsx");
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

  it("shows master file section only when standardize or update is selected", async () => {
    expect(container.querySelector("#main-file")).toBeNull();
    await selectTask("standardize");
    expect(container.querySelector("#main-file")).not.toBeNull();
    await selectTask("standardize");
    expect(container.querySelector("#main-file")).toBeNull();
    await selectTask("update");
    expect(container.querySelector("#main-file")).not.toBeNull();
    await selectTask("update");
    expect(container.querySelector("#main-file")).toBeNull();
  });

  it("shows what-to-add section only when addColumn is selected", async () => {
    expect(container.querySelector("#prompt")).toBeNull();
    await selectTask("addColumn");
    expect(container.querySelector("#prompt")).not.toBeNull();
    await selectTask("addColumn");
    expect(container.querySelector("#prompt")).toBeNull();
  });

  it("blocks submit when no task is selected", async () => {
    await selectFile("current-file", "current.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(container.textContent).toContain("a task above");
    await selectTask("addColumn");
    expect(container.textContent).not.toContain("a task above");
  });

  it("requires master file when standardize or update is selected and removes it when deselected", async () => {
    expect(container.querySelector("#main-file")).toBeNull();
    await selectFile("current-file", "current.xlsx");
    await selectTask("standardize");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await selectFile("main-file", "reference.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    await selectTask("update");
    await selectTask("standardize");
    expect(container.querySelector("#main-file")).not.toBeNull();
    await selectTask("update");
    expect(container.querySelector("#main-file")).toBeNull();
  });

  it("uses one real creation action and preserves reset", async () => {
    await selectTask("addColumn");
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Customer segment");
    expect(get<HTMLButtonElement>('button[type="submit"]').textContent).toContain("Upload files");
    expect(container.textContent).not.toContain("Preview configuration");
    const resetButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Reset")!;
    await act(async () => { resetButton.click(); });
    expect(container.querySelector("#prompt")).toBeNull();
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never invents workbook metadata", async () => {
    await selectTask("update");
    const selectors = [...container.querySelectorAll("select")];
    expect(selectors).toHaveLength(0);
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });

  it("preserves the output header when task selections change", async () => {
    await selectTask("addColumn");
    await enterHeader("profit");
    await selectTask("standardize");
    await selectTask("update");
    expect(get<HTMLInputElement>("#output-header").value).toBe("profit");
    expect(container.querySelector("#advanced-settings")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects oversized files and clears errors on reset", async () => {
    const input = get<HTMLInputElement>("#current-file");
    const tooLarge = new File(["bytes"], "large.xlsx");
    Object.defineProperty(tooLarge, "size", { value: 25 * 1024 * 1024 + 1 });
    Object.defineProperty(input, "files", { configurable: true, value: [tooLarge] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(get('[role="alert"]').textContent).toContain("25 MB limit");
    const resetButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Reset");
    await act(async () => { resetButton?.click(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("explains prerequisites and disables incomplete creation", () => {
    act(() => root.render(<JobFormActions canStart={false} onReset={() => {}} missingRequirements="Choose a current workbook." />));
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(container.textContent).toContain("Choose a current workbook");
    expect(container.textContent).not.toContain("Preview configuration");
  });

  it("shows the current setup step", async () => {
    expect(container.querySelector('[role="tablist"][aria-label="Workflow stages"] [aria-selected="true"]')?.getAttribute("aria-label")).toBe("Set up: active");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears the master file and task selections on reset", async () => {
    await selectTask("standardize");
    await selectTask("update");
    await selectFile("main-file", "master.xlsx");
    expect(container.textContent).toContain("master.xlsx");
    const reset = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Reset");
    await act(async () => { reset?.click(); });
    expect(container.querySelector("#main-file")).toBeNull();
    expect(get<HTMLInputElement>('input[name="standardize"]').checked).toBe(false);
    expect(get<HTMLInputElement>('input[name="update"]').checked).toBe(false);
    expect(container.textContent).not.toContain("master.xlsx");
  });

  it("shows a touched prompt error and clears it when instructions are entered", async () => {
    await selectTask("addColumn");
    const prompt = get<HTMLTextAreaElement>("#prompt");
    await act(async () => {
      prompt.focus();
      prompt.blur();
    });
    await enterPrompt("Calculate Profit as Revenue minus Cost.");
    expect(prompt.value).toBe("Calculate Profit as Revenue minus Cost.");
    expect(prompt.getAttribute("aria-invalid")).toBe("false");
    expect(container.querySelector("#prompt-error")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revalidates master removal/replacement and preserves valid inputs after rejection", async () => {
    await selectFile("current-file", "current.xlsx");
    await selectTask("update");
    expect(container.querySelector('[role="note"]')?.textContent).toContain("not inserted automatically");
    await selectFile("main-file", "main-one.xlsx");
    await selectFile("main-file", "bad.xls");
    expect(container.textContent).toContain("main-one.xlsx");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await selectFile("main-file", "main-two.xlsx");
    expect(container.textContent).not.toContain("main-one.xlsx");
    await click('[aria-label="Remove master file"]');
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(container.textContent).not.toContain("main-two.xlsx");
  });

  it("accepts formula-looking prompt/header as untrusted text without executing anything", async () => {
    await selectTask("addColumn");
    await selectFile("current-file", "current.xlsx");
    await enterPrompt('<img src=x onerror="alert(1)">');
    await enterHeader("=SUM(A1:A2)");
    expect(get<HTMLInputElement>("#output-header").value).toBe("=SUM(A1:A2)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns keyboard focus to Browse after removing a workbook", async () => {
    await selectFile("current-file", "current.xlsx");
    get<HTMLButtonElement>('[aria-label="Remove current.xlsx"]').focus();
    await click('[aria-label="Remove current.xlsx"]');
    expect(document.activeElement).toBe(get('[aria-label="Browse files"]'));
    await selectTask("standardize");
    await selectFile("main-file", "main.xlsx");
    get<HTMLButtonElement>('[aria-label="Remove master file"]').focus();
    await click('[aria-label="Remove master file"]');
    expect(document.activeElement).toBe(get('[aria-label="Browse master file"]'));
  });

  it("exposes rejected selection feedback without losing valid current workbooks", async () => {
    await selectFile("current-file", "valid.xlsx");
    await selectFile("current-file", "invalid.csv");
    expect(get("#current-file-error").textContent).toContain("Choose an .xlsx workbook");
    await selectFile("current-file", "fixed.xlsx");
    expect(container.textContent).toContain("valid.xlsx");
    expect(container.textContent).toContain("fixed.xlsx");
    expect(container.querySelector("#current-file-error")).toBeNull();
  });

  it("blocks a forced submit when form is invalid", async () => {
    await selectTask("addColumn");
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    const submit = async () => act(async () => { get<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await selectFile("current-file", "bad.csv");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await submit();
    expect(container.textContent).toContain("current.xlsx");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts multiple dropped current workbooks", async () => {
    await selectFile("current-file", "keep.xlsx");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["a"], "a.xlsx"), new File(["b"], "b.xlsx")] } });
    await act(async () => { get(".workbook-dropzone").dispatchEvent(event); });
    expect(container.querySelector("#current-file-error")).toBeNull();
    expect(container.textContent).toContain("keep.xlsx");
    expect(container.textContent).toContain("a.xlsx");
    expect(container.textContent).toContain("b.xlsx");
  });

  it("removes stale main-file selection errors when no operation requires a main file", async () => {
    await selectFile("current-file", "current.xlsx");
    await selectTask("update");
    await selectFile("main-file", "main.xlsx");
    await selectFile("main-file", "bad.xls");
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await selectTask("update");
    expect(container.querySelector("#main-file-error")).toBeNull();
    expect(container.querySelector("#main-file")).toBeNull();
  });

  it("resets all local values and selection errors", async () => {
    await selectTask("addColumn");
    await selectFile("current-file", "current.xlsx");
    await enterPrompt("Profit");
    await enterHeader("profit");
    const reset = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Reset")!;
    await act(async () => { reset.click(); });
    expect(container.querySelector("#prompt")).toBeNull();
    expect(container.textContent).not.toContain("current.xlsx");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
  });
});
