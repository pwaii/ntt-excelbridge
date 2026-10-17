import { jobCreationSchema } from "@/schemas/job-creation";
import { ApiError } from "./errors";
import type { CreateJobAdapter, CreateJobState } from "./create-job-types";

// Not wired into the local form until a real OpenAPI-backed adapter exists.
// No URLs, server field names, upload operations or workflow start are assumed.
export function createJobController<T>(adapter?: CreateJobAdapter<T>) {
  let state: CreateJobState<T> = { phase: "editing-configuration" };
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const setState = (next: CreateJobState<T>) => { state = next; listeners.forEach((listener) => listener()); };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async create(input: unknown): Promise<boolean> {
      if (state.phase !== "editing-configuration" && !(state.phase === "create-error" && !state.outcomeUnknown)) return false;
      const parsed = jobCreationSchema.safeParse(input);
      if (!parsed.success) {
        setState({ phase: "create-error", error: new ApiError("configuration", "Complete the required local configuration before creating a job."), outcomeUnknown: false });
        return false;
      }
      if (!adapter) {
        setState({ phase: "create-error", error: new ApiError("configuration", "Job creation is unavailable until the backend publishes OpenAPI and the request/response adapter is connected."), outcomeUnknown: false, configuration: parsed.data });
        return false;
      }
      controller = new AbortController();
      setState({ phase: "creating-job", configuration: parsed.data });
      try {
        const receipt = await adapter.create(parsed.data, controller.signal);
        // The adapter owns full response/instruction validation. Guard the minimum
        // receipt identity here before exposing a created state to a future UI.
        if (!receipt.jobId.trim()) throw new ApiError("protocol", "The backend did not provide a valid job identity.");
        setState({ phase: "job-created", configuration: parsed.data, receipt });
        setState({ phase: "upload-instructions-received", configuration: parsed.data, receipt });
        return true;
      } catch (error) {
        const failure = error instanceof ApiError ? error : new ApiError("network", "Job creation could not be confirmed. Check existing jobs before trying again.");
        const outcomeUnknown = ["network", "timeout", "cancelled", "protocol"].includes(failure.kind) || (failure.status ?? 0) >= 500;
        setState({ phase: "create-error", error: failure, outcomeUnknown, configuration: parsed.data });
        return false;
      } finally { controller = undefined; }
    },
    prepareUpload() {
      if (state.phase !== "upload-instructions-received") return false;
      setState({ ...state, phase: "ready-for-upload" });
      return true;
    },
    cancel() { controller?.abort(); },
    reset() {
      // A timed-out/aborted POST might still create a server job. A future UI must
      // reconcile it against server status, not silently retry/create a duplicate.
      if (state.phase === "creating-job" || (state.phase === "create-error" && state.outcomeUnknown)) return false;
      setState({ phase: "editing-configuration" });
      return true;
    },
  };
}
