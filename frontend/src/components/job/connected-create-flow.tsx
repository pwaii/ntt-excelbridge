import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { createJobController } from "@/api/create-job-controller";
import { createUploadWorkflow } from "@/uploads/workflow";
import { createMetadataFlow } from "@/metadata/controller";
import { createBackendMetadataAdapter } from "@/metadata/backend-adapter";
import { jobCreationSchema, type JobFormInput } from "@/schemas/job-creation";
import type { BackendJob } from "@/api/jobs-api";
import { UploadProgressPanel } from "./upload-progress-panel";
import { PostUploadConfiguration } from "./post-upload-configuration";
import { rememberJob, rememberedJob } from "@/lib/pending-job";

type UploadFlow = ReturnType<typeof createUploadWorkflow<BackendJob>>;
function UploadedJob({ flow }: { flow: UploadFlow }) {
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  // Configuration is passed separately by the parent once confirmation succeeds.
  return <UploadProgressPanel state={state} onCancel={flow.cancel} canRetry={flow.canRetry} onRetry={(role) => { void flow.upload(role).then(() => flow.confirm()); }} />;
}

export function ConnectedCreateFlow({ configuration, canCreate, onLockedChange, actionRef, onAvailabilityChange }: { configuration: JobFormInput; canCreate: boolean; onLockedChange: (value: boolean) => void; actionRef: MutableRefObject<(() => Promise<void>) | undefined>; onAvailabilityChange: (value: boolean) => void }) {
  const auth = useAuth();
  const getToken = useRef(auth.getValidToken); getToken.current = auth.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => getToken.current(), import.meta.env.DEV), []);
  const controller = useMemo(() => createJobController(services.api?.createAdapter), [services]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [flow, setFlow] = useState<UploadFlow>();
  const [metadataFlow, setMetadataFlow] = useState<ReturnType<typeof createMetadataFlow>>();
  useEffect(() => {
    if (!flow || !services.api) return;
    const inspect = () => {
      const created = controller.getSnapshot();
      if (flow.getSnapshot().confirmation === "confirmed" && "receipt" in created) {
        setMetadataFlow((previous) => previous ?? createMetadataFlow(created.receipt.jobId, created.configuration, createBackendMetadataAdapter(services.api!)));
      }
    };
    inspect(); return flow.subscribe(inspect);
  }, [flow, services, controller]);
  const [resumeId] = useState(rememberedJob);
  const mounted = useRef(true);
  const activeUpload = useRef<UploadFlow>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.cancel();
      activeUpload.current?.cancel("current");
      activeUpload.current?.cancel("main");
    };
  }, [controller]);
  const locked = state.phase !== "editing-configuration" && !(state.phase === "create-error" && !state.outcomeUnknown);
  useEffect(() => { onLockedChange(locked); }, [locked, onLockedChange]);
  const busy = useRef(false);
  async function create() {
    if (!canCreate || busy.current || locked || !services.api || !services.uploader || services.issues.length || auth.configurationIssues.length || auth.state.status !== "authenticated") return;
    const parsed = jobCreationSchema.safeParse(configuration);
    if (!parsed.success) return;
    busy.current = true;
    try {
      if (!await controller.create(parsed.data)) return;
      const created = controller.getSnapshot();
      if (!("receipt" in created)) return;
      rememberJob(created.receipt.jobId);
      if (!mounted.current) return;
      controller.prepareUpload();
      const next = createUploadWorkflow({ jobId: created.receipt.jobId, configuration: created.configuration, instructions: created.receipt.uploadInstructions, uploader: services.uploader, confirmationAdapter: services.api.confirmationAdapter });
      activeUpload.current = next;
      setFlow(next);
      await next.uploadAll();
    } finally { busy.current = false; }
  }
  const issues = [...services.issues, ...auth.configurationIssues];
  actionRef.current = create;
  const available = issues.length === 0 && auth.state.status === "authenticated";
  useEffect(() => { onAvailabilityChange(available); }, [available, onAvailabilityChange]);
  const id = "receipt" in state ? state.receipt.jobId : undefined;
  return <section aria-labelledby="backend-create-title" className="mt-5 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
    <h2 id="backend-create-title" className="text-sm font-semibold">Create job and upload</h2>
    <p className="text-xs leading-relaxed text-muted-foreground">Creates a real backend job and sends workbook files directly to S3. This does not start the workflow.</p>
    <p className="text-xs leading-relaxed text-muted-foreground">Enabled AI steps send workbook data to Amazon Bedrock after the required review and start steps.</p>
    {issues.length > 0 && <ul role="note" className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    {state.phase === "creating-job" && <p role="status" className="text-sm">Creating backend job…</p>}
    {state.phase === "create-error" && <p role="alert" className="text-sm text-destructive">{state.error.message}{state.error.requestId && <span className="block break-all text-xs">Request ID: {state.error.requestId}</span>}{state.outcomeUnknown && <span className="block">The outcome is unknown. Reconcile existing jobs with the backend before creating another job.</span>}</p>}
    {id && <p className="break-all text-sm">Job ID: <Link className="text-primary underline underline-offset-4" to={`/jobs/${encodeURIComponent(id)}`}>{id}</Link></p>}
    {!id && resumeId && <p className="text-xs"><Link className="text-primary underline underline-offset-4" to={`/jobs/${encodeURIComponent(resumeId)}`}>Read the last created job status</Link>. Refreshing does not restore local file selections.</p>}
    {flow && <UploadedJob flow={flow} />}
    {metadataFlow && <PostUploadConfiguration flow={metadataFlow} />}
  </section>;
}
