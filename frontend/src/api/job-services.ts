import { createApiClient } from "./http-client";
import { createJobsApi } from "./jobs-api";
import { createPresignedPutUploader } from "@/uploads/presigned-put";
import { localDevelopmentAllowed } from "@/auth/local-development";

export function createJobServices(env: Record<string, string | undefined>, getValidToken: () => Promise<string>, development: boolean) {
  const issues: string[] = [];
  const origins = (env.VITE_S3_UPLOAD_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  try {
    const localDevelopment = localDevelopmentAllowed(env, window.location.origin, development);
    if (env.VITE_AUTH_MODE === "local-development" && !localDevelopment) throw new Error();
    const client = createApiClient({ baseUrl: env.VITE_API_BASE_URL ?? "", getValidToken, development, localDevelopment });
    const downloadOrigins = (env.VITE_S3_DOWNLOAD_ORIGINS?.trim() || env.VITE_S3_UPLOAD_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
    const api = createJobsApi(client, origins, downloadOrigins);
    for (const origin of [...origins, ...downloadOrigins]) {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin) throw new Error();
    }
    if (!origins.length) issues.push("Configure VITE_S3_UPLOAD_ORIGINS before creating a job for direct upload.");
    return { api, uploader: createPresignedPutUploader({ allowedOrigins: origins, backendOrigin: env.VITE_API_BASE_URL! }), issues };
  } catch {
    return { issues: ["Configure a valid API URL and HTTPS S3 upload origins before connecting to the backend."] };
  }
}
export type JobServices = ReturnType<typeof createJobServices>;
