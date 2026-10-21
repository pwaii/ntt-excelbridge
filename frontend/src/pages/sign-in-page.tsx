import { ArrowRight, Download, FileUp, LogOut, ShieldCheck, ListChecks } from "lucide-react";
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
  return <section aria-labelledby="page-title" className="mx-auto grid w-full max-w-6xl items-center gap-10 py-4 sm:py-10 lg:min-h-[calc(100svh-220px)] lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:gap-16">
    <div className="min-w-0">
      <h2 className="max-w-lg text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">XLSX Data Workflow</h2>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">Prepare your Excel workbooks, review proposed changes, and download a new copy. One workspace, with you in control.</p>
      <ol aria-label="How it works" className="mt-8 hidden max-w-lg divide-y border-y sm:block">
        {[
          { icon: FileUp, title: "Upload your workbook", description: "Choose an Excel file and describe the column you need." },
          { icon: ListChecks, title: "Review the proposed changes", description: "Inspect the evidence and decide what to approve." },
          { icon: Download, title: "Download your results", description: "Get your output workbook and available reports." },
        ].map(({ icon: Icon, title, description }) => <li key={title} className="flex items-start gap-4 py-4"><Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p></div></li>)}
      </ol>
      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="size-4 shrink-0" aria-hidden="true" />Your original workbooks stay unchanged. Approved changes are saved to a new file.</p>
    </div>
    <div id="sign-in" className="panel scroll-mt-6 p-6 sm:p-8">
      <h1 id="page-title" className="text-2xl font-semibold tracking-tight">Sign in</h1>
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
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{local ? "Continue to the local backend workspace for development. No password is required." : "Welcome back. Sign in to create a workflow and review your workbook changes."}</p>
        {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Preparing sign in…</p>}
        {state.status === "error" && <p role="alert" className="notice notice-error mt-4">{state.message}</p>}
        <Button className="mt-6 w-full" disabled={loading || !canSignIn} aria-busy={loading} onClick={() => { void login(returnTo); }}>{loading ? "Please wait…" : local ? "Continue in local development" : "Sign in"}<ArrowRight aria-hidden="true" /></Button>
        {!local && <p className="mt-5 border-t pt-5 text-sm leading-relaxed text-muted-foreground">New here? Choose <span className="font-medium text-foreground">Sign up</span> on the next screen to create your account.</p>}
      </>}
      {configurationIssues.length > 0 && <div role="note" className="notice mt-6 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Authentication configuration required</p>
        <ul className="mt-2 list-disc space-y-1 break-words pl-4">{configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        <p className="mt-2">No development bypass or simulated session is enabled.</p>
      </div>}
    </div>
  </section>;
}
