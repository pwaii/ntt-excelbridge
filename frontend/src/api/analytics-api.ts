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

export function createAnalyticsApi(client: ReturnType<typeof createApiClient>) {
  return {
    async getQuickDashboardEmbedUrl(signal?: AbortSignal) {
      const result = await client.request("/v1/analytics/quick/embed-url", {
        signal,
        timeoutMs: 15_000,
        decode: (value) => {
          try { return embedResponseSchema.parse(value); }
          catch { throw new ApiError("protocol", "The dashboard service returned an invalid embed URL."); }
        },
      });
      return result.data;
    },
  };
}
