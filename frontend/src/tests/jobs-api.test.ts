import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/api/http-client";
import { createJobsApi } from "@/api/jobs-api";
import { createBackendMetadataAdapter } from "@/metadata/backend-adapter";
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
    expect(JSON.parse(options!.body as string)).toEqual({ config: { comment_name: "Profit", output_header: "profit", standardize: false, update: false }, input_filename: "current.xlsx" });
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

  it("rejects a GET response for a different job", async () => {
    const { api } = setup(fetched);
    await expect(api.getJob("different-job")).rejects.toMatchObject({ kind: "protocol" });
  });
});
