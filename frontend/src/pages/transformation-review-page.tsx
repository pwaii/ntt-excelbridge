import { useContext, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { AuthContext } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { createQualityReviewFlow } from "@/quality/controller";
import { createBackendQualityAdapter, createQualityReportSource } from "@/quality/backend-adapter";
import { QualityReviewWorkspace } from "@/components/job/quality-review-workspace";

export function TransformationReviewPage() {
  const { id } = useParams();
  const auth = useContext(AuthContext);
  const token = useRef(auth?.getValidToken); token.current = auth?.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => token.current ? token.current() : Promise.reject(new Error("Sign in required")), import.meta.env.DEV), []);
  const ready = auth?.state.status === "authenticated" && !auth.configurationIssues.length && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));
  const flow = useMemo(() => id && ready && services.api ? createQualityReviewFlow(id, createBackendQualityAdapter(services.api, createQualityReportSource(services.api, "transformation"), "Transformation"), "transformation") : undefined, [id, ready, services]);
  return flow && id
    ? <QualityReviewWorkspace key={id} flow={flow} jobId={id} />
    : <p role="note" className="notice mt-6 text-muted-foreground">This review is unavailable. Sign in again or ask your administrator to check the connection.</p>;
}
