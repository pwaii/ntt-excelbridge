import { useContext, useMemo, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { AuthContext } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { createQualityReviewFlow } from "@/quality/controller";
import { createBackendQualityAdapter, createQualityReportSource } from "@/quality/backend-adapter";
import { QualityReviewWorkspace } from "@/components/job/quality-review-workspace";
import { PageHeader } from "@/components/layout/page-header";

export function TransformationReviewPage() {
  const { id } = useParams();
  const auth = useContext(AuthContext);
  const token = useRef(auth?.getValidToken); token.current = auth?.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => token.current ? token.current() : Promise.reject(new Error("Sign in required")), import.meta.env.DEV), []);
  const ready = auth?.state.status === "authenticated" && !auth.configurationIssues.length && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));
  const flow = useMemo(() => id && ready && services.api ? createQualityReviewFlow(id, createBackendQualityAdapter(services.api, createQualityReportSource(services.api, "transformation"), "Transformation"), "transformation") : undefined, [id, ready, services]);
  return <section className="workspace-page">
    <PageHeader title="Transformation review" description="Check formulas, value mappings, and row matches before approving." actions={id && <Link className="rounded-md py-2 text-sm font-medium text-primary underline underline-offset-4" to={`/jobs/${encodeURIComponent(id)}`}>Back to job progress</Link>} />
    {flow && id ? <QualityReviewWorkspace key={id} flow={flow} jobId={id} /> : <p role="note" className="notice mt-6 text-muted-foreground">This review is unavailable. Sign in again or ask your administrator to check the connection.</p>}
  </section>;
}
