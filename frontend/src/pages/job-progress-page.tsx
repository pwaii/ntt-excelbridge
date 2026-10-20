import { useContext } from "react";
import { useParams } from "react-router-dom";
import { AuthContext } from "@/auth/context";
import { ConnectedJobStatus } from "@/components/job/connected-job-status";

export function JobProgressPage() {
  const auth = useContext(AuthContext);
  const { id } = useParams();
  return <section className="mx-auto max-w-4xl">
    <h1 className="text-3xl font-semibold tracking-tight">Job progress</h1>
    <p className="mt-3 text-sm text-muted-foreground">Follow backend progress, complete workbook configuration or open the required review.</p>
    {auth && id ? <ConnectedJobStatus jobId={id} /> : <p className="mt-5 text-sm text-muted-foreground">Sign in to read the backend job status.</p>}
  </section>;
}
