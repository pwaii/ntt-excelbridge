import { useContext, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { AuthContext } from "@/auth/context";
import { createJobServices } from "@/api/job-services";
import { ResultWorkspace } from "@/components/job/result-workspace";
import { PageHeader } from "@/components/layout/page-header";

export function ResultPage() {
  const { id } = useParams();
  const auth = useContext(AuthContext);
  const token = useRef(auth?.getValidToken); token.current = auth?.getValidToken;
  const services = useMemo(() => createJobServices(import.meta.env, () => token.current ? token.current() : Promise.reject(new Error("Sign in required")), import.meta.env.DEV), []);
  const ready = auth?.state.status === "authenticated" && !auth.configurationIssues.length && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));
  return <section className="workspace-page"><PageHeader title="Result" />
    {ready && services.api && id ? <ResultWorkspace key={id} api={services.api} jobId={id} /> : <p role="note" className="notice mt-6 text-muted-foreground">Results are unavailable. Sign in again or ask your administrator to check the connection.</p>}
  </section>;
}
