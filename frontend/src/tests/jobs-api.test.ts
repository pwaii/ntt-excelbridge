import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/api/http-client";
import { createJobsApi } from "@/api/jobs-api";
import { createBackendMetadataAdapter } from "@/metadata/backend-adapter";
import { metadataKey } from "@/lib/workflow-readiness";
import { metadataForm } from "./metadata-fixtures";
import current from "./fixtures/backend/current-create.json";
import both from "./fixtures/backend/both-create.json";
import confirmedInput from "./fixtures/backend/both-confirm-input.json";
import confirmedMain from "./fixtures/backend/both-confirm-main.json";
import meta from "./fixtures/backend/both-metadata-input.json";
import fetched from "./fixtures/backend/both-get.json";

const origin = "https://contract-fixture.s3.us-east-1.amazonaws.com";
const signal = () => new AbortController().signal;
function setup(payload: unknown = current) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }));
  const client = createApiClient({ baseUrl: "https://api.example.invalid", getValidToken: async () => "mock-test-token", fetcher });
  return { api: createJobsApi(client, [origin]), fetcher };
}

describe("jobs API using FastAPI-exported synthetic contract fixtures", () => {
  it("sends comment_name JSON declarations and maps input slot to current upload", async () => {
    const { api, fetcher } = setup();
    const started = Date.now();
    const receipt = await api.createAdapter.create(metadataForm(), signal());
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.example.invalid/v1/jobs");
    expect(JSON.parse(options!.body as string)).toEqual({ config: { comment_name: "Profit", output_header: "profit", standardize: false, update: false, conflict_policy: "reject_all" }, input_filename: "current.xlsx" });
    expect(options!.headers).toMatchObject({ Authorization: "Bearer mock-test-token" });
    expect(receipt.jobId).toBe(current.job.job_id);
    expect(receipt.uploadInstructions.current).toMatchObject({ method: "PUT", url: current.uploads[0].url, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    expect(receipt.uploadInstructions.current!.expiresAt).toBeGreaterThanOrEqual(started + 300_000);
    expect(receipt.uploadInstructions.main).toBeUndefined();
  });
  it("uses the pinned OpenAPI 200-character comment_name limit before sending", async () => {
    const { api, fetcher } = setup();
    await expect(api.createAdapter.create({ ...metadataForm(), comment_name: "x".repeat(201) }, signal())).rejects.toThrow("at most 200");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("maps multiple current workbooks to input upload slots", async () => {
    const second = { filename: "current-2.xlsx", key: "jobs/job-1/input/input_2/current-2.xlsx", uploaded: false };
    const payload = {
      ...current,
      job: { ...current.job, files: { ...current.job.files, input_2: second } },
      uploads: [...current.uploads, { slot: "input_2", filename: "current-2.xlsx", key: second.key, url: `${origin}/job-1/input_2`, expires_in: 300 }],
    };
    const { api, fetcher } = setup(payload);
    const configuration = { ...metadataForm(), currentFile: new File(["current"], "current.xlsx"), currentFiles: [new File(["current"], "current.xlsx"), new File(["current-2"], "current-2.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] };
    const receipt = await api.createAdapter.create(configuration, signal());
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).input_filenames).toEqual(["current.xlsx", "current-2.xlsx"]);
    expect(receipt.uploadInstructions.current_2).toMatchObject({ method: "PUT", url: `${origin}/job-1/input_2` });
  });
  it("accepts a global S3 URL alias for a multi-workbook response from the configured bucket", async () => {
    const second = { filename: "current-2.xlsx", key: "jobs/job-1/input/input_2/current-2.xlsx", uploaded: false };
    const payload = {
      ...current,
      job: { ...current.job, files: { ...current.job.files, input_2: second } },
      uploads: [...current.uploads, { slot: "input_2", filename: "current-2.xlsx", key: second.key, url: "https://contract-fixture.s3.amazonaws.com/job-1/input_2", expires_in: 300 }],
    };
    const { api } = setup(payload);
    const configuration = { ...metadataForm(), currentFile: new File(["current"], "current.xlsx"), currentFiles: [new File(["current"], "current.xlsx"), new File(["current-2"], "current-2.xlsx")] };
    const receipt = await api.createAdapter.create(configuration, signal());
    expect(receipt.uploadInstructions.current_2?.url).toBe("https://contract-fixture.s3.amazonaws.com/job-1/input_2");
  });
  it.each(["slot", "origin", "identity", "config"])("rejects invalid %s without trusting upload instructions", async (kind) => {
    const payload = structuredClone(current);
    if (kind === "slot") payload.uploads.push(payload.uploads[0]);
    if (kind === "origin") payload.uploads[0].url = "https://untrusted.example.invalid/file";
    if (kind === "identity") payload.uploads[0].key = "wrong-file";
    if (kind === "config") payload.job.config.comment_name = "different";
    const { api } = setup(payload);
    await expect(api.createAdapter.create(metadataForm(), signal())).rejects.toMatchObject({ kind: "protocol" });
  });
  it("confirms required slots sequentially through revision-advancing backend calls", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(both)))
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmedInput)))
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmedMain)));
    const result = await api.confirmationAdapter.confirm(both.job.job_id, ["current", "main"], {}, signal());
    expect(fetcher.mock.calls.map(([, options]) => options!.method)).toEqual(["GET", "POST", "POST"]);
    expect(fetcher.mock.calls.slice(1).map(([, options]) => JSON.parse(options!.body as string))).toEqual([{ slot: "input" }, { slot: "main" }]);
    expect(result.manifest.status).toBe("UPLOADED");
    expect(result.requestIds).toHaveLength(2);
  });
  it("reconciles already-confirmed slots without duplicate confirmation POSTs", async () => {
    const { api, fetcher } = setup(fetched);
    expect((await api.confirmationAdapter.confirm(fetched.job.job_id, ["current", "main"], {}, signal())).manifest.status).toBe("UPLOADED");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]!.method).toBe("GET");
  });
  it("does not confirm success when backend acknowledges a different slot", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(both)))
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmedMain)));
    await expect(api.confirmationAdapter.confirm(both.job.job_id, ["current", "main"], {}, signal())).rejects.toMatchObject({ kind: "protocol" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("maps actual backend metadata and provides configuration/start adapters", async () => {
    const { api, fetcher } = setup(fetched);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(fetched)))
      .mockResolvedValueOnce(new Response(JSON.stringify(meta)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...meta, slot: "main" })));
    const adapter = createBackendMetadataAdapter(api);
    const snapshot = await adapter.load(fetched.job.job_id, { current: { sheetName: null, header: null, keyColumnId: null }, main: { sheetName: null, header: null, keyColumnId: null } }, signal());
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.workbooks.current).toMatchObject({ uploadConfirmed: true, keyRule: "required", sheets: [expect.objectContaining({ sheetName: "Data", detectedHeaderRow: 3 })] });
    expect(adapter.persistSelections).toBeTypeOf("function");
    expect(adapter.start).toBeTypeOf("function");
  });

  it("loads and persists metadata selections for secondary current slots", async () => {
    const multi = structuredClone(fetched);
    const secondFile = { ...multi.job.files.input, filename: "current-2.xlsx", key: "jobs/job-1/input/input_2/current-2.xlsx" };
    (multi.job.files as Record<string, typeof secondFile>).input_2 = secondFile;
    const { api, fetcher } = setup(multi);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(multi)))
      .mockResolvedValueOnce(new Response(JSON.stringify(meta)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...meta, slot: "input_2" })));
    const adapter = createBackendMetadataAdapter(api);
    const choices = {
      current: { sheetName: null, header: null, keyColumnId: null },
      current_2: { sheetName: null, header: null, keyColumnId: null },
    };
    const snapshot = await adapter.load(multi.job.job_id, choices, signal());
    expect(snapshot.workbooks.current_2).toMatchObject({ filename: "current-2.xlsx", uploadConfirmed: true });
    expect(fetcher.mock.calls.slice(1).map(([url]) => String(url))).toEqual([
      expect.stringContaining("/workbooks/input/metadata"), expect.stringContaining("/workbooks/input_2/metadata"),
    ]);

    const selected = () => ({ sheetName: "Data", header: { metadataKey: metadataKey({ workbookVersion: meta.workbook_version, sheetName: "Data", dataRowCount: 1, detectedHeaderRow: 3, columnsHeaderRow: 3, columns: meta.sheets[0].columns, headerRowBounds: { min: 1, max: 20, indexBase: 1 } }), row: 3 }, keyColumnId: null });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...meta, slot: "input" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...meta, slot: "input_2" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...fetched, job: { ...multi.job, configuration_confirmed: true, workbook_selections: { input: { sheet_name: "Data", header_row: 3, header_confirmed: true, key_column: null, workbook_version: meta.workbook_version }, input_2: { sheet_name: "Data", header_row: 3, header_confirmed: true, key_column: null, workbook_version: meta.workbook_version } } } })));
    await expect(adapter.persistSelections!(multi.job.job_id, { configuration: { comment_name: "Profit", outputHeader: "profit", standardize: false, update: false }, choices: { ...choices, current: selected(), current_2: selected() } }, "selection-key", String(multi.job.revision), signal())).resolves.toMatchObject({ selectionKey: "selection-key" });
    const saveBody = JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string);
    expect(Object.keys(saveBody.selections)).toEqual(["input", "input_2"]);
  });

  it("rejects a GET response for a different job", async () => {
    const { api } = setup(fetched);
    await expect(api.getJob("different-job")).rejects.toMatchObject({ kind: "protocol" });
  });
});
