import { useContext } from "react";
import { useParams } from "react-router-dom";
import { AuthContext } from "@/auth/context";
import { ConnectedJobStatus } from "@/components/job/connected-job-status";

export function JobProgressPage() {
  const auth = useContext(AuthContext);
  const { id } = useParams();
  return <section aria-labelledby="workflow-timeline" className="engagement-progress">
    {auth && id ? <ConnectedJobStatus jobId={id} /> : <p className="mt-5 text-sm text-muted-foreground">Sign in to read the backend job status.</p>}
  </section>;
}
