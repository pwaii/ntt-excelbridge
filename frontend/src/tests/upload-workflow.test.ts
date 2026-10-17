import { describe, expect, it, vi } from "vitest";
import { createUploadWorkflow } from "@/uploads/workflow";
import { UploadError, type PutUploader, type TransferReceipt } from "@/uploads/types";
import { ApiError } from "@/api/errors";

const form = () => ({ currentFile: new File(["current"], "current.xlsx"), mainFile: new File(["main"], "main.xlsx"), comment_name: "Profit", outputHeader: "profit", standardize: false, update: false });
// Internal toy instructions/opaque manifest, not an official server contract.
const instruction = { method: "PUT", url: "https://mock.s3.us-east-1.amazonaws.com/test-only", headers: {} } as const;
const instructions = { current: instruction, main: instruction };
const receipt: TransferReceipt = { status: 200, etag: null };
const result = { manifest: Symbol("test-only backend manifest boundary"), requestIds: ["mock-request-id"] };

describe("upload and confirmation coordinator (adapter mocks)", () => {
  it("does not reconstruct upload success from a job ID after controller recreation", async () => {
    const upload = vi.fn<PutUploader["upload"]>().mockResolvedValue(receipt);
    const confirm = vi.fn(async () => result);
    const options = { jobId: "mock-job", configuration: form(), instructions, uploader: { upload }, confirmationAdapter: { confirm } };
    await createUploadWorkflow(options).uploadAll();
    const fresh = createUploadWorkflow(options);
    expect(fresh.getSnapshot()).toMatchObject({ confirmation: "waiting", files: [{ phase: "waiting", attempts: 0 }] });
    expect(fresh.getSnapshot().result).toBeUndefined();
    expect(await fresh.confirm()).toBe(false);
    expect(upload).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
  });
  it.each([[false, false, 1], [true, false, 2], [false, true, 2], [true, true, 2]] as const)("selects required files for standardize=%s update=%s", async (standardize, update, count) => {
    const configuration = { ...form(), standardize, update };
    const upload = vi.fn<PutUploader["upload"]>().mockResolvedValue(receipt);
    const confirm = vi.fn(async () => result);
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration, instructions, uploader: { upload }, confirmationAdapter: { confirm } });
    expect(await workflow.uploadAll()).toBe(true);
    expect(upload).toHaveBeenCalledTimes(count);
    expect(upload.mock.calls[0][0]).toBe(configuration.currentFile);
    if (count === 2) expect(upload.mock.calls[1][0]).toBe(configuration.mainFile);
    expect(workflow.getSnapshot().files.every((file) => file.phase === "uploaded")).toBe(true);
    expect(workflow.getSnapshot().result).toBe(result);
    expect(confirm.mock.calls).toHaveLength(1);
  });
  it("preserves partial success and never confirms before every required transfer succeeds", async () => {
    const configuration = { ...form(), update: true };
    const upload = vi.fn<PutUploader["upload"]>().mockImplementation(async (file) => { if (file === configuration.mainFile) throw new UploadError("network", "Connection interrupted."); return receipt; });
    const confirm = vi.fn(async () => result);
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration, instructions, uploader: { upload }, confirmationAdapter: { confirm } });
    expect(await workflow.uploadAll()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(workflow.getSnapshot().files.map((file) => file.phase)).toEqual(["awaiting-confirmation", "failed"]);
    upload.mockResolvedValue(receipt);
    expect(await workflow.upload("main")).toBe(true);
    expect(upload.mock.calls.filter(([file]) => file === configuration.currentFile)).toHaveLength(1);
    expect(await workflow.confirm()).toBe(true);
    expect(workflow.getSnapshot().result?.requestIds).toEqual(["mock-request-id"]);
  });
  it("preserves transfer success when confirmation fails and blocks unsafe resubmission", async () => {
    const upload = vi.fn<PutUploader["upload"]>().mockResolvedValue(receipt);
    const confirm = vi.fn(async () => { throw new ApiError("http", "safe test error", 409, "TEST_CONFLICT", "test-correlation"); });
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration: form(), instructions, uploader: { upload }, confirmationAdapter: { confirm } });
    await workflow.uploadAll();
    expect(workflow.getSnapshot()).toMatchObject({ confirmation: "failed", confirmationError: { requestId: "test-correlation", code: "TEST_CONFLICT" } });
    expect(workflow.getSnapshot().files[0].phase).toBe("awaiting-confirmation");
    expect(await workflow.upload("current")).toBe(false);
    expect(await workflow.confirm()).toBe(false);
    expect(upload).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledOnce();
  });
  it("allows only one manual confirmation retry if the adapter explicitly marks it safe", async () => {
    const confirm = vi.fn(async () => { throw new Error("private server message"); });
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration: form(), instructions, uploader: { upload: async () => receipt }, confirmationAdapter: { confirm, retrySafe: true } });
    await workflow.uploadAll(); await workflow.confirm(); await workflow.confirm();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(workflow.getSnapshot().confirmationError?.message).not.toContain("private server message");
  });
  it("never turns missing confirmation adapter into server-confirmed success", async () => {
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration: form(), instructions, uploader: { upload: async () => receipt } });
    expect(await workflow.uploadAll()).toBe(false);
    expect(workflow.getSnapshot().confirmation).toBe("failed");
    expect(workflow.getSnapshot().result).toBeUndefined();
  });
  it("prevents a second confirmation while the first submission is in flight", async () => {
    let resolve!: (value: typeof result) => void;
    const confirm = vi.fn(() => new Promise<typeof result>((done) => { resolve = done; }));
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration: form(), instructions, uploader: { upload: async () => receipt }, confirmationAdapter: { confirm } });
    await workflow.upload("current");
    const first = workflow.confirm();
    expect(await workflow.confirm()).toBe(false);
    resolve(result); expect(await first).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });
  it.each(["forbidden", "expired"] as const)("does not retry %s instructions", async (kind) => {
    const upload = vi.fn<PutUploader["upload"]>().mockRejectedValue(new UploadError(kind, "Fresh backend instructions required."));
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration: form(), instructions, uploader: { upload } });
    await workflow.upload("current");
    expect(workflow.canRetry("current")).toBe(false);
    expect(await workflow.upload("current")).toBe(false);
    expect(upload).toHaveBeenCalledOnce();
  });
  it("limits ordinary transfer retries and does not recreate a job", async () => {
    const upload = vi.fn<PutUploader["upload"]>().mockRejectedValue(new UploadError("network", "Network failed."));
    const workflow = createUploadWorkflow({ jobId: "same-existing-job", configuration: form(), instructions, uploader: { upload } });
    await workflow.upload("current"); expect(workflow.canRetry("current")).toBe(true);
    await workflow.upload("current"); expect(workflow.canRetry("current")).toBe(false);
    await workflow.upload("current"); expect(upload).toHaveBeenCalledTimes(2);
    expect(workflow.getSnapshot().jobId).toBe("same-existing-job");
  });
  it("prevents simultaneous upload/confirmation duplicates and supports cancellation", async () => {
    let resolve!: (value: TransferReceipt) => void;
    const upload = vi.fn<PutUploader["upload"]>().mockImplementation((_file, _instruction, options) => new Promise((done, reject) => { resolve = done; options?.signal?.addEventListener("abort", () => reject(new UploadError("cancelled", "Cancelled."))); }));
    const confirm = vi.fn(async () => result);
    const workflow = createUploadWorkflow({ jobId: "mock-job", configuration: form(), instructions, uploader: { upload }, confirmationAdapter: { confirm } });
    const first = workflow.upload("current");
    expect(await workflow.upload("current")).toBe(false);
    expect(await workflow.confirm()).toBe(false);
    workflow.cancel("current"); expect(await first).toBe(false);
    expect(workflow.getSnapshot().files[0].phase).toBe("cancelled");
    const second = workflow.upload("current"); resolve(receipt); await second;
    expect(await workflow.confirm()).toBe(true); expect(await workflow.confirm()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
