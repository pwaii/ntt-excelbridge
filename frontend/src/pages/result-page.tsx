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
  return <section className="mx-auto max-w-6xl"><PageHeader title="Result" description="Download your output workbook and review the reports behind its changes." />
    {ready && services.api && id ? <ResultWorkspace key={id} api={services.api} jobId={id} /> : <p role="note" className="notice mt-6 text-muted-foreground">Sign in and configure the backend API and authentication token type to load results.</p>}
  </section>;
}
