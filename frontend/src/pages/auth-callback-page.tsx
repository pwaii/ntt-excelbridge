import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/auth/context";
import { safeReturnTo } from "@/auth/types";
import { Button } from "@/components/ui/button";

export function AuthCallbackPage() {
  const { state, getReturnTo } = useAuth();
  if (state.status === "authenticated") return <Navigate to={safeReturnTo(getReturnTo())} replace />;
  return <section aria-labelledby="page-title" className="max-w-xl rounded-2xl border bg-card p-6 sm:p-10">
    <h1 id="page-title" className="text-2xl font-semibold">Completing sign in</h1>
    {state.status === "loading" ? <p role="status" className="mt-4 text-sm text-muted-foreground">Verifying the Cognito sign-in response…</p> : <>
      <p role="alert" className="mt-4 text-sm text-destructive">{state.status === "error" ? state.message : "No sign-in response could be completed. Start again from sign in."}</p>
      <Button asChild className="mt-6"><Link to="/login">Return to sign in</Link></Button>
    </>}
  </section>;
}
