import { LogIn, LogOut } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/context";
import { safeReturnTo } from "@/auth/types";
import { Button } from "@/components/ui/button";

export function SignInPage() {
  const { state, mode, canSignIn, configurationIssues, login, logout } = useAuth();
  const local = mode === "local-development";
  const navigate = useNavigate();
  const location = useLocation();
  const routeState: unknown = location.state;
  const returnTo = safeReturnTo(routeState && typeof routeState === "object" && "returnTo" in routeState ? routeState.returnTo : null);
  const loading = state.status === "loading";
  useEffect(() => { if (local && state.status === "authenticated") navigate(returnTo, { replace: true }); }, [local, state.status, navigate, returnTo]);
  return <section aria-labelledby="page-title" className="mx-auto max-w-xl">
    <h1 id="page-title" className="text-3xl font-semibold tracking-tight">Sign in</h1>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Access your workbook jobs and review decisions.</p>
    <div className="mt-8 rounded-2xl border bg-card p-6 shadow-xs sm:p-10">
      {local && <p role="note" className="mb-5 rounded-xl border bg-muted/50 p-4 text-sm leading-relaxed">Local development mode. Uses the backend fallback user <strong>local-user</strong>. No Cognito login or JWT verification is performed.</p>}
      <span className="workflow-identity flex size-12 items-center justify-center rounded-xl"><LogIn className="size-5" aria-hidden="true" /></span>
      {state.status === "authenticated" ? <>
        <h2 className="mt-6 text-xl font-semibold">You’re signed in</h2>
        <p className="mt-2 break-words text-sm text-muted-foreground">{state.user.name || state.user.email || state.user.subject}</p>
        {state.user.name && state.user.email && <p className="mt-1 break-words text-sm text-muted-foreground">{state.user.email}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild className="workflow-primary text-[#081329]"><Link to={returnTo}>Continue to workspace</Link></Button>
          <Button variant="outline" onClick={() => { void logout(); }}><LogOut aria-hidden="true" />Sign out</Button>
        </div>
      </> : <>
        <h2 className="mt-6 text-xl font-semibold">Your workbook workspace</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{local ? "Continue to the local backend workspace for development. No password is required." : "Continue securely with Amazon Cognito. Your password is entered only on the Cognito sign-in page."}</p>
        {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Preparing sign in…</p>}
        {state.status === "error" && <p role="alert" className="mt-4 text-sm text-destructive">{state.message}</p>}
        <Button className="workflow-primary mt-6 w-full text-[#081329]" disabled={loading || !canSignIn} aria-busy={loading} onClick={() => { void login(returnTo); }}><LogIn aria-hidden="true" />{loading ? "Please wait…" : local ? "Continue in local development" : "Sign in with Cognito"}</Button>
      </>}
      {configurationIssues.length > 0 && <div role="note" className="mt-6 rounded-xl border bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">Authentication configuration required</p>
        <ul className="mt-2 list-disc space-y-1 break-words pl-4">{configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        <p className="mt-2">No development bypass or simulated session is enabled.</p>
      </div>}
    </div>
  </section>;
}
