import { z } from "zod";
import type { createApiClient } from "./http-client";
import { ApiError } from "./errors";

const embedResponseSchema = z.object({
  embed_url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.quicksight\.aws\.amazon\.com$/.test(url.hostname);
  }),
  embed_url_valid_for_seconds: z.literal(300),
  session_lifetime_minutes: z.number().int().min(15).max(600),
});

const excelSourceSchema = z.object({
  source_id: z.string().regex(/^[a-f0-9]{32}$/),
  workbook_name: z.string(),
  created_at: z.string(),
});

const excelColumnSchema = z.object({
  name: z.string(),
  kind: z.enum(["number", "date", "category"]),
  non_empty_count: z.number().int().nonnegative(),
  unique_count: z.number().int().nonnegative(),
});

const excelRowSchema = z.object({
  row_number: z.number().int().positive(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  value_types: z.record(z.string(), z.enum(["number", "date", "category"])),
});

const sourcesResponseSchema = z.object({
  sources: z.array(excelSourceSchema),
  request_id: z.string(),
});

const rowsResponseSchema = z.object({
  source: excelSourceSchema,
  sheets: z.array(z.object({ name: z.string(), row_count: z.number().int().nonnegative() })),
  sheet: z.string(),
  columns: z.array(excelColumnSchema),
  rows: z.array(excelRowSchema),
  total_rows: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  has_more: z.boolean(),
  request_id: z.string(),
});

export type ExcelDataSource = z.infer<typeof excelSourceSchema>;
export type ExcelDataColumn = z.infer<typeof excelColumnSchema>;
export type ExcelDataRow = z.infer<typeof excelRowSchema>;
export type ExcelRowsPage = z.infer<typeof rowsResponseSchema>;

export function createAnalyticsApi(client: ReturnType<typeof createApiClient>) {
  return {
    async getQuickDashboardEmbedUrl(signal?: AbortSignal) {
      const result = await client.request("/v1/analytics/quick/embed-url", {
        signal,
        timeoutMs: 15_000,
        decode: (value) => {
          try { return embedResponseSchema.parse(value); }
          catch (failure) {
            const fields = failure instanceof z.ZodError
              ? failure.issues.map((issue) => issue.path.join(".") || "response").join(", ")
              : "response";
            throw new ApiError("protocol", `The dashboard service returned invalid embed fields: ${fields}.`);
          }
        },
      });
      return result.data;
    },
    async getExcelDataSources(signal?: AbortSignal) {
      const result = await client.request("/v1/analytics/quick/data/sources", {
        signal,
        timeoutMs: 20_000,
        decode: (value) => {
          try { return sourcesResponseSchema.parse(value); }
          catch { throw new ApiError("protocol", "The workbook service returned an invalid source list."); }
        },
      });
      return result.data.sources;
    },
    async getExcelRows(sourceId: string, options: { sheet?: string; offset?: number; limit?: number; signal?: AbortSignal } = {}) {
      const result = await client.request("/v1/analytics/quick/data/rows", {
        signal: options.signal,
        timeoutMs: 60_000,
        query: {
          source_id: sourceId,
          ...(options.sheet ? { sheet: options.sheet } : {}),
          offset: options.offset ?? 0,
          limit: options.limit ?? 2000,
        },
        decode: (value) => {
          try { return rowsResponseSchema.parse(value); }
          catch { throw new ApiError("protocol", "The workbook service returned invalid row data."); }
        },
      });
      return result.data;
    },
  };
}
