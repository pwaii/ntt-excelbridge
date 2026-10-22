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
  const panel = <UploadProgressPanel state={state} onCancel={flow.cancel} canRetry={flow.canRetry} onRetry={(role) => { void flow.upload(role).then(() => flow.confirm()); }} />;
  return state.confirmation === "confirmed" ? <details className="section-disclosure"><summary>Uploaded files</summary><div className="mt-3">{panel}</div></details> : panel;
}

export function ConnectedCreateFlow({ configuration, canCreate, onLockedChange, actionRef, onAvailabilityChange, onStageChange }: { configuration: JobFormInput; canCreate: boolean; onLockedChange: (value: boolean) => void; actionRef: MutableRefObject<(() => Promise<void>) | undefined>; onAvailabilityChange: (value: boolean) => void; onStageChange?: (step: number) => void }) {
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
      activeUpload.current?.getSnapshot().files.filter((file) => file.role !== "main").forEach((file) => activeUpload.current?.cancel(file.role));
      activeUpload.current?.cancel("main");
    };
  }, [controller]);
  const locked = state.phase !== "editing-configuration" && !(state.phase === "create-error" && !state.outcomeUnknown);
  useEffect(() => { onLockedChange(locked); }, [locked, onLockedChange]);
  useEffect(() => { onStageChange?.(metadataFlow ? 2 : locked ? 1 : 0); }, [metadataFlow, locked, onStageChange]);
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
  return <section aria-labelledby="backend-create-title" className="mt-5 min-w-0 space-y-4">
    <div className="space-y-3 text-sm">
    <h2 id="backend-create-title" className="sr-only">Upload status</h2>

    <details className="mt-3 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer font-medium">How your data is processed</summary><p className="mt-2 max-w-2xl leading-relaxed">When AI analysis is enabled, the backend sends workbook data to Amazon Bedrock. Review proposed changes before approving them.</p></details>
    {issues.length > 0 && <ul role="note" className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    {state.phase === "creating-job" && <p role="status" className="mt-4 text-sm">Preparing upload…</p>}
    {state.phase === "create-error" && <div role="alert" className="notice notice-error mt-4"><p className="font-medium">{state.error.message}</p>{state.error.requestId && <p className="mt-1 break-all text-xs">Request ID: {state.error.requestId}</p>}{state.outcomeUnknown && <p className="mt-2 text-sm">A job may already have been created. Check job progress or contact support before uploading again.</p>}</div>}
    {id && <p className="mt-4 break-all text-xs text-muted-foreground"><Link className="text-primary underline underline-offset-4" to={`/jobs/${encodeURIComponent(id)}`}>View job progress</Link></p>}
    {!id && resumeId && <p className="mt-4 text-xs"><Link className="text-primary underline underline-offset-4" to={`/jobs/${encodeURIComponent(resumeId)}`}>Resume your last workflow</Link>. Refreshing does not restore local file selections.</p>}
    </div>
    {flow && <UploadedJob flow={flow} />}
    {metadataFlow && <PostUploadConfiguration flow={metadataFlow} />}
  </section>;
}
