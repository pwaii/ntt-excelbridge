import { LogIn, LogOut } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/context";
import { safeReturnTo } from "@/auth/types";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";

export function SignInPage() {
  const { state, mode, canSignIn, configurationIssues, login, logout } = useAuth();
  const local = mode === "local-development";
  const navigate = useNavigate();
  const location = useLocation();
  const routeState: unknown = location.state;
  const returnTo = safeReturnTo(routeState && typeof routeState === "object" && "returnTo" in routeState ? routeState.returnTo : null);
  const loading = state.status === "loading";
  useEffect(() => { if (local && state.status === "authenticated") navigate(returnTo, { replace: true }); }, [local, state.status, navigate, returnTo]);
  return <section aria-labelledby="page-title" className="mx-auto w-full max-w-lg py-4 sm:py-10">
    <PageHeader title="Sign in" description="Access your workbook jobs and review decisions." />
    <div className="panel p-6 sm:p-8">
      {local && <p role="note" className="notice notice-warning mb-6 text-xs">Local development mode. Uses the backend fallback user <strong>local-user</strong>. No Cognito login or JWT verification is performed.</p>}
      {state.status === "authenticated" ? <>
        <h2 className="text-lg font-semibold">You’re signed in</h2>
        <p className="mt-2 break-words text-sm text-muted-foreground">{state.user.name || state.user.email || state.user.subject}</p>
        {state.user.name && state.user.email && <p className="mt-1 break-words text-sm text-muted-foreground">{state.user.email}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild><Link to={returnTo}>Continue to workspace</Link></Button>
          <Button variant="outline" onClick={() => { void logout(); }}><LogOut aria-hidden="true" />Sign out</Button>
        </div>
      </> : <>
        <h2 className="text-lg font-semibold">Your workbook workspace</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{local ? "Continue to the local backend workspace for development. No password is required." : "Continue securely with Amazon Cognito. Your password is entered only on the Cognito sign-in page."}</p>
        {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Preparing sign in…</p>}
        {state.status === "error" && <p role="alert" className="notice notice-error mt-4">{state.message}</p>}
        <Button className="mt-6 w-full" disabled={loading || !canSignIn} aria-busy={loading} onClick={() => { void login(returnTo); }}><LogIn aria-hidden="true" />{loading ? "Please wait…" : local ? "Continue in local development" : "Sign in with Cognito"}</Button>
      </>}
      {configurationIssues.length > 0 && <div role="note" className="notice mt-6 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Authentication configuration required</p>
        <ul className="mt-2 list-disc space-y-1 break-words pl-4">{configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        <p className="mt-2">No development bypass or simulated session is enabled.</p>
      </div>}
    </div>
  </section>;
}
