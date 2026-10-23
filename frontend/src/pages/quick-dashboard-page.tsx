import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/auth/context";
import { createAnalyticsApi } from "@/api/analytics-api";
import { createApiClient } from "@/api/http-client";
import { ApiError } from "@/api/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export function QuickDashboardPage() {
  const auth = useAuth();
  const token = useRef(auth.getValidToken);
  token.current = auth.getValidToken;
  const api = useMemo(() => createAnalyticsApi(createApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
    getValidToken: () => token.current(),
    development: import.meta.env.DEV,
    localDevelopment: auth.mode === "local-development",
  })), []);
  const [embedUrl, setEmbedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ready = auth.state.status === "authenticated"
    && !auth.configurationIssues.length
    && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    setEmbedUrl("");
    try {
      const result = await api.getQuickDashboardEmbedUrl(signal);
      if (!signal?.aborted) setEmbedUrl(result.embed_url);
    } catch (failure) {
      if (signal?.aborted) return;
      const status = failure instanceof ApiError ? failure.status : undefined;
      setError(status === 503 && failure instanceof ApiError && failure.code === "QUICKSIGHT_CAPACITY_REQUIRED"
        ? "QuickSight needs an active Capacity Pricing plan before it can open embedded dashboards. Ask an administrator to enable a plan for this account."
        : status === 503
        ? "Quick dashboard access is not ready yet. The published dashboard and owner-level data security must both be configured before the app can show any data."
        : failure instanceof ApiError && failure.code === "QUICKSIGHT_ORIGIN_NOT_ALLOWED"
          ? "This website is not approved to embed the Quick dashboard. Ask an administrator to add this site’s origin."
          : status === 403
            ? "Quick blocked the embed request. Ask an administrator to check Quick permissions and anonymous session capacity."
          : "The Quick dashboard could not be loaded. Retry, or ask an administrator to check the QuickSight integration.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [ready, loadDashboard]);

  return <section className="workspace-page">
    <PageHeader
      title="Analytics dashboard"
      description="Explore your quality findings in Quick. The dashboard is scoped to your account."
      actions={<Button variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={!ready || loading}><RefreshCw aria-hidden="true" className={loading ? "animate-spin" : ""} />{embedUrl ? "Refresh dashboard" : "Try again"}</Button>}
    />

    <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <p>Quick filters this dashboard to rows owned by your signed-in account. The app obtains a short-lived Quick embed session when you open this page.</p>
    </div>

    {!ready && <p role="note" className="notice mt-4">Sign in with a configured account to open the analytics dashboard.</p>}
    {loading && <p role="status" className="notice mt-4">Connecting to Quick…</p>}
    {error && <div role="alert" className="notice notice-error mt-4 flex items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void loadDashboard()} disabled={loading}>Retry</Button></div></div>}
    {embedUrl && <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">Quick dashboard · secured for your account</div>
      <iframe
        title="Quick quality and inspection analytics dashboard"
        src={embedUrl}
        className="block h-[min(78vh,900px)] min-h-[560px] w-full border-0 bg-background"
        allow="fullscreen"
        referrerPolicy="no-referrer"
      />
    </div>}
  </section>;
}
