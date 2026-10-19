import type { BackendJob, JobsApi } from "@/api/jobs-api";
import { ApiError } from "@/api/errors";
import { qualitySnapshotSchema, type QualityReviewAdapter, type QualitySnapshot } from "./types";

// No GET issues/proposals operation exists in the current OpenAPI. This is an
// internal boundary to implement after a backend-owned report contract is published.
export interface QualityReportSource {
  load(job: BackendJob, signal: AbortSignal): Promise<QualitySnapshot>;
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
