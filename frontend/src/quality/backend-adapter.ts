import type { BackendJob, JobsApi } from "@/api/jobs-api";
import { ApiError } from "@/api/errors";
import { qualitySnapshotSchema, type QualityReviewAdapter, type QualitySnapshot } from "./types";

// Each report page is bound to one authoritative job revision and stage.
export interface QualityReportSource {
  load(job: BackendJob, signal: AbortSignal): Promise<QualitySnapshot>;
}
export function createQualityReportSource(api: JobsApi, stage: "quality" | "transformation"): QualityReportSource {
  return { async load(job, signal) {
    const items: unknown[] = [];
    const seen = new Set<number>();
    let cursor = 0;
    let total: number | undefined;
    while (true) {
      const page = await api.getReviewReport(job.job_id, stage, job.revision, cursor, signal);
      if (page.status !== job.status || (total !== undefined && page.total !== total)) throw new ApiError("protocol", "Review coverage changed during load. Reload the job.");
      total = page.total;
      items.push(...page.items);
      if (items.length > total || total > 100_000) throw new ApiError("protocol", "Review report exceeds its declared coverage.");
      if (page.nextCursor === undefined || page.nextCursor === null) {
        if (!page.complete || items.length !== total) throw new ApiError("protocol", "The backend review report is incomplete.");
        return qualitySnapshotSchema.parse({ jobId: job.job_id, revision: job.revision, status: job.status, items, complete: true, requestId: page.requestId });
      }
      if (page.complete || page.nextCursor <= cursor || seen.has(page.nextCursor) || !page.items.length) throw new ApiError("protocol", "Review pagination did not advance.");
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
  } };
}
export function createBackendQualityAdapter(api: JobsApi, source?: QualityReportSource, stage = "Quality"): QualityReviewAdapter {
  return {
    async load(id, signal) {
      const { job } = await api.getJob(id, signal);
      if (!source) throw new ApiError("configuration", `${stage} findings are unavailable: the backend has not published the issues/proposals report contract. No review data or counts have been generated in the browser.`);
      const snapshot = qualitySnapshotSchema.parse(await source.load(job, signal));
      if (snapshot.jobId !== job.job_id || snapshot.revision !== job.revision || snapshot.status !== job.status)
        throw new ApiError("protocol", "The quality report does not match the current backend job. Reload before reviewing.");
      return snapshot;
    },
    async submit(id, revision, decisions, signal) {
      if (!source) throw new ApiError("configuration", "A backend quality report is required before decisions can be submitted.");
      return api.submitReview(id, { expected_revision: revision, decisions }, signal);
    },
  };
}
