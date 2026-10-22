import { ArrowRight, FileCheck2, FileSpreadsheet, LogOut, ScanLine } from "lucide-react";
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
  return <section aria-labelledby="page-title" className="sign-in-layout">
    <div className="sign-in-intro">
      <h2>Clear changes.<br />Confident decisions.</h2>
      <p>Upload an Excel workbook, check the proposed changes, and download a new copy.</p>
      <div className="auth-workflow" aria-label="How your workbook is processed">
        <div><FileSpreadsheet aria-hidden="true" /><span><strong>Your workbook</strong><span>The original stays intact.</span></span></div>
        <span className="auth-connector" aria-hidden="true" />
        <div><ScanLine aria-hidden="true" /><span><strong>Your review</strong><span>Inspect the evidence. Decide what changes.</span></span></div>
        <span className="auth-connector" aria-hidden="true" />
        <div><FileCheck2 aria-hidden="true" /><span><strong>A separate output</strong><span>Only your approved changes.</span></span></div>
      </div>
    </div>
    <div id="sign-in" className="sign-in-form">
      <h1 id="page-title" className="page-title">Sign in</h1>
      {local && <p role="note" className="notice notice-warning mt-3 text-[13px]">Local development workspace. You'll use <strong>local-user</strong>. This is development access, not a production sign-in.</p>}
      {state.status === "authenticated" ? <>
        <h2 className="text-lg font-semibold">You’re signed in</h2>
        <p className="mt-2 break-words text-sm text-muted-foreground">{state.user.name || state.user.email || state.user.subject}</p>
        {state.user.name && state.user.email && <p className="mt-1 break-words text-sm text-muted-foreground">{state.user.email}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild><Link to={returnTo}>Continue to workspace</Link></Button>
          <Button variant="outline" onClick={() => { void logout(); }}><LogOut aria-hidden="true" />Sign out</Button>
        </div>
      </> : <>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{local ? "Open the local workspace. No password is required." : "Sign in to upload workbooks and review your changes."}</p>
        {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Preparing sign in…</p>}
        {state.status === "error" && <p role="alert" className="notice notice-error mt-4">{state.message}</p>}
        <Button className="mt-4 w-full" disabled={loading || !canSignIn} aria-busy={loading} onClick={() => { void login(returnTo); }}>{loading ? "Please wait…" : local ? "Continue in local development" : "Sign in"}<ArrowRight aria-hidden="true" /></Button>
        {!local && <p className="mt-5 border-t pt-5 text-sm leading-relaxed text-muted-foreground">New here? Choose <span className="font-medium text-foreground">Sign up</span> on the next screen to create your account.</p>}
      </>}
      {configurationIssues.length > 0 && <div role="note" className="notice mt-6 text-[13px] text-muted-foreground">
        <p className="font-medium text-foreground">Authentication configuration required</p>
        <ul className="mt-2 list-disc space-y-1 break-words pl-4">{configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        <p className="mt-2">Contact your administrator to complete sign-in setup.</p>
      </div>}
    </div>
  </section>;
}
