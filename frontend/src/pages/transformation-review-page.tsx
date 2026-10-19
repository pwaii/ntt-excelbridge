import { useContext, useMemo, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { AuthContext } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { createQualityReviewFlow } from "@/quality/controller";
import { createBackendQualityAdapter } from "@/quality/backend-adapter";
import { QualityReviewWorkspace } from "@/components/job/quality-review-workspace";

export function TransformationReviewPage() {
  const { id } = useParams();
  const auth = useContext(AuthContext);
  const token = useRef(auth?.getValidToken); token.current = auth?.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => token.current ? token.current() : Promise.reject(new Error("Sign in required")), import.meta.env.DEV), []);
  const ready = auth?.state.status === "authenticated" && !auth.configurationIssues.length && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));
  const flow = useMemo(() => id && ready && services.api ? createQualityReviewFlow(id, createBackendQualityAdapter(services.api, undefined, "Transformation"), "transformation") : undefined, [id, ready, services]);
  return <section className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Transformation review</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Review formula syntax, standardization mappings and update matches before approved changes can be applied.</p></div>
      {id && <Link className="text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" to={`/jobs/${encodeURIComponent(id)}`}>Back to job progress</Link>}
    </div>
    {flow && id ? <QualityReviewWorkspace key={id} flow={flow} jobId={id} /> : <p role="note" className="mt-6 rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Sign in and configure the backend API and authentication token type to load transformation review. No sample findings are shown.</p>}
  </section>;
}
