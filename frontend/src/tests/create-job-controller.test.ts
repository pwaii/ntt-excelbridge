import { describe, expect, it, vi } from "vitest";
import { createJobController } from "@/api/create-job-controller";
import { ApiError } from "@/api/errors";
import type { CreateJobReceipt } from "@/api/create-job-types";

// Frontend-only state tests with opaque toy receipts; no BE payload or presigned
// instruction schema is claimed. Real POST /v1/jobs integration tests are blocked.
const form = () => ({ currentFile: new File(["local"], "current.xlsx"), comment_name: "Profit", outputHeader: "profit", standardize: false, update: false, mainFile: null });

describe("contract-independent create-job state boundary", () => {
  it("blocks invalid local forms before invoking an adapter", async () => {
    const create = vi.fn();
    const controller = createJobController({ create });
    expect(await controller.create({ ...form(), comment_name: "   " })).toBe(false);
    expect(await controller.create({ ...form(), update: true })).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it("fails honestly without a published-contract adapter", async () => {
    const controller = createJobController();
    expect(await controller.create(form())).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: "create-error", outcomeUnknown: false, error: { kind: "configuration" } });
    expect(controller.prepareUpload()).toBe(false);
  });
  it("prevents rapid duplicate creation and retains the same Files and opaque receipt", async () => {
    const configuration = { ...form(), update: true, mainFile: new File(["main"], "main.xlsx") };
    const opaqueInstructions = Symbol("test-only opaque upload instructions");
    let resolve!: (value: CreateJobReceipt<symbol>) => void;
    const create = vi.fn(() => new Promise<CreateJobReceipt<symbol>>((done) => { resolve = done; }));
    const controller = createJobController({ create });
    const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.getSnapshot().phase));
    const first = controller.create(configuration);
    expect(await controller.create(configuration)).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    const receipt = { jobId: "unit-test-receipt-id", uploadInstructions: opaqueInstructions, requestId: "test-request-id" };
    resolve(receipt);
    expect(await first).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "upload-instructions-received", receipt });
    const snapshot = controller.getSnapshot();
    if (snapshot.phase !== "upload-instructions-received") throw new Error("Expected receipt");
    expect(snapshot.configuration.currentFile).toBe(configuration.currentFile);
    expect(snapshot.configuration.mainFile).toBe(configuration.mainFile);
    expect(snapshot.receipt).toBe(receipt);
    expect(controller.prepareUpload()).toBe(true);
    expect(phases).toEqual(["creating-job", "job-created", "upload-instructions-received", "ready-for-upload"]);
    expect(await controller.create(configuration)).toBe(false);
  });
  it("preserves safe server diagnostics on a rejected request", async () => {
    const controller = createJobController({ create: async () => { throw new ApiError("http", "Validation failed.", 400, "TEST_VALIDATION", "test-request"); } });
    expect(await controller.create(form())).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: "create-error", outcomeUnknown: false, error: { code: "TEST_VALIDATION", requestId: "test-request" } });
    expect(controller.reset()).toBe(true);
  });
  it.each(["network", "timeout", "cancelled", "protocol"] as const)("blocks blind retry/reset after an unknown %s outcome", async (kind) => {
    const create = vi.fn(async () => { throw new ApiError(kind, "Test failure."); });
    const controller = createJobController({ create });
    const configuration = form();
    await controller.create(configuration);
    expect(controller.getSnapshot()).toMatchObject({ phase: "create-error", outcomeUnknown: true });
    const state = controller.getSnapshot();
    if (state.phase !== "create-error") throw new Error("Expected an error state");
    expect(state.configuration?.currentFile).toBe(configuration.currentFile);
    expect(controller.reset()).toBe(false);
    expect(await controller.create(form())).toBe(false);
    expect(create).toHaveBeenCalledOnce();
  });
  it("does not allow reset while creating and propagates explicit cancellation", async () => {
    const controller = createJobController({ create: (_form, signal) => new Promise<never>((_resolve, reject) => { signal.addEventListener("abort", () => reject(new ApiError("cancelled", "Cancelled.")), { once: true }); }) });
    const request = controller.create(form());
    expect(controller.reset()).toBe(false);
    controller.cancel();
    expect(await request).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: "create-error", outcomeUnknown: true });
  });
});
