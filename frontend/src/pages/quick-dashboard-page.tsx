import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, RefreshCw, ShieldCheck } from "lucide-react";
import { createEmbeddingContext } from "amazon-quicksight-embedding-sdk";
import type { ExcelDataColumn, ExcelDataSource, ExcelRowsPage } from "@/api/analytics-api";
import { createAnalyticsApi } from "@/api/analytics-api";
import { createApiClient } from "@/api/http-client";
import { ApiError } from "@/api/errors";
import { useAuth } from "@/auth/context";
import { ExcelRowPlot, countPlotRows } from "@/components/analytics/excel-row-plot";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 2000;
const DEFAULT_AXIS_FIELD = /\b(product|item|brand|category|name|label|region|customer|vendor|supplier)\b/i;
const DEFAULT_MEASURE_FIELD = /\b(price|amount|cost|revenue|sales|quantity|qty|total|value|score|rate|count|weight|volume|balance)\b/i;
const IDENTIFIER_FIELD = /\b(id|uuid|key|index|row|code|number)\b/i;

function defaultPair(columns: ExcelDataColumn[]): [string, string] {
  const category = columns.filter((column) => column.kind === "category" || column.kind === "date");
  const numeric = columns.filter((column) => column.kind === "number" && !IDENTIFIER_FIELD.test(column.name));
  const x = [...category].sort((a, b) => Number(DEFAULT_AXIS_FIELD.test(b.name)) - Number(DEFAULT_AXIS_FIELD.test(a.name)) || Math.min(b.unique_count, 500) - Math.min(a.unique_count, 500))[0];
  const y = [...numeric].sort((a, b) => Number(DEFAULT_MEASURE_FIELD.test(b.name)) - Number(DEFAULT_MEASURE_FIELD.test(a.name)) || b.non_empty_count - a.non_empty_count)[0];
  if (x && y) return [x.name, y.name];
  const numberFields = numeric;
  if (numberFields.length > 1) return [numberFields[0].name, numberFields[1].name];
  if (x && numberFields[0]) return [x.name, numberFields[0].name];
  if (category.length > 1) return [category[0].name, category[1].name];
  return [columns[0]?.name ?? "", columns[1]?.name ?? ""];
}

function cellText(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

function formatSourceDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Completed workbook" : date.toLocaleString();
}

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
  const [sources, setSources] = useState<ExcelDataSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState<ExcelRowsPage | null>(null);
  const [xField, setXField] = useState("");
  const [yField, setYField] = useState("");
  const [offset, setOffset] = useState(0);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorDiagnostics, setErrorDiagnostics] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [quickEmbedUrl, setQuickEmbedUrl] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickLoaded, setQuickLoaded] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickErrorDiagnostics, setQuickErrorDiagnostics] = useState("");
  const quickContainer = useRef<HTMLDivElement>(null);
  const quickContext = useRef<Awaited<ReturnType<typeof createEmbeddingContext>> | null>(null);
  const fieldSourceKey = useRef("");
  const redirectLoopbackIpToLocalhost = import.meta.env.DEV && window.location.hostname === "127.0.0.1";
  const ready = auth.state.status === "authenticated"
    && !redirectLoopbackIpToLocalhost
    && !auth.configurationIssues.length
    && (auth.mode === "local-development" || Boolean(import.meta.env.VITE_COGNITO_API_TOKEN_TYPE));

  useEffect(() => {
    if (!redirectLoopbackIpToLocalhost) return;
    const localUrl = new URL(window.location.href);
    localUrl.hostname = "localhost";
    window.location.replace(localUrl.toString());
  }, [redirectLoopbackIpToLocalhost]);

  const loadSources = useCallback(async (signal?: AbortSignal) => {
    setSourceLoading(true);
    setError(""); setErrorDiagnostics("");
    try {
      const result = await api.getExcelDataSources(signal);
      if (!signal?.aborted) {
        setSources(result);
        setSourceId((current) => result.some((item) => item.source_id === current) ? current : result[0]?.source_id ?? "");
        setSheet(""); setOffset(0); setPage(null); fieldSourceKey.current = "";
        setReloadVersion((version) => version + 1);
      }
    } catch (failure) {
      if (signal?.aborted) return;
      setError("Your Excel data could not be loaded. Retry, or ask an administrator to check the backend connection.");
      if (failure instanceof ApiError) setErrorDiagnostics([failure.status ? `HTTP ${failure.status}` : "", failure.code ? `code ${failure.code}` : "", failure.requestId ? `request ${failure.requestId}` : ""].filter(Boolean).join(" · "));
    } finally {
      if (!signal?.aborted) setSourceLoading(false);
    }
  }, [api]);

  const loadQuickDashboard = useCallback(async () => {
    setQuickLoading(true);
    setQuickLoaded(false);
    setQuickError("");
    setQuickErrorDiagnostics("");
    setQuickEmbedUrl("");
    try {
      const result = await api.getQuickDashboardEmbedUrl();
      setQuickEmbedUrl(result.embed_url);
    } catch (failure) {
      setQuickError("The QuickSight dashboard could not be opened. Retry, or ask an administrator to check the QuickSight connection.");
      if (failure instanceof ApiError) {
        setQuickErrorDiagnostics([failure.status ? `HTTP ${failure.status}` : "", failure.code ? `code ${failure.code}` : "", failure.requestId ? `request ${failure.requestId}` : ""].filter(Boolean).join(" · "));
      }
      setQuickLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void loadSources(controller.signal);
    return () => controller.abort();
  }, [ready, loadSources]);

  useEffect(() => {
    if (!ready || !sourceId) { setPage(null); return; }
    const controller = new AbortController();
    setRowsLoading(true);
    setError(""); setErrorDiagnostics("");
    void api.getExcelRows(sourceId, { ...(sheet ? { sheet } : {}), offset, limit: PAGE_SIZE, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPage(result);
        const key = `${result.source.source_id}\0${result.sheet}`;
        if (fieldSourceKey.current !== key) {
          const [nextX, nextY] = defaultPair(result.columns);
          setXField(nextX); setYField(nextY); fieldSourceKey.current = key;
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setPage(null);
        setError("Rows for this workbook could not be loaded. Retry, or choose another workbook.");
        if (failure instanceof ApiError) setErrorDiagnostics([failure.status ? `HTTP ${failure.status}` : "", failure.code ? `code ${failure.code}` : "", failure.requestId ? `request ${failure.requestId}` : ""].filter(Boolean).join(" · "));
      })
      .finally(() => { if (!controller.signal.aborted) setRowsLoading(false); });
    return () => controller.abort();
  }, [api, ready, sourceId, sheet, offset, reloadVersion]);

  useEffect(() => {
    if (!quickEmbedUrl || !quickContainer.current) return;
    let cancelled = false;
    setQuickLoading(true);
    const embed = async () => {
      try {
        const context = quickContext.current ?? await createEmbeddingContext();
        if (cancelled || !quickContainer.current) return;
        quickContext.current = context;
        await context.embedDashboard({
          url: quickEmbedUrl,
          container: quickContainer.current,
          height: "680px",
          width: "100%",
          onChange: (event) => {
            if (event.eventName === "FRAME_NOT_CREATED" || event.eventName === "INVALID_URL") {
              setQuickError("QuickSight could not initialize this dashboard. Retry, or ask an administrator to check the embedding configuration.");
              setQuickLoading(false);
            }
          },
        }, {
          onMessage: (event) => {
            if (event.eventName === "CONTENT_LOADED") {
              setQuickLoaded(true);
              setQuickLoading(false);
            } else if (event.eventName === "ERROR_OCCURRED") {
              setQuickError("QuickSight could not display this dashboard. Retry, or ask an administrator to check dashboard access and dataset security.");
              setQuickLoading(false);
            }
          },
        });
      } catch {
        if (!cancelled) {
          setQuickError("QuickSight could not initialize this dashboard. Retry, or ask an administrator to check the embedding configuration.");
          setQuickLoading(false);
        }
      }
    };
    void embed();
    return () => {
      cancelled = true;
      quickContainer.current?.replaceChildren();
    };
  }, [quickEmbedUrl]);

  const columns = page?.columns ?? [];
  const rows = page?.rows ?? [];
  const selectedSource = sources.find((source) => source.source_id === sourceId);
  const plotCount = countPlotRows(rows, columns, xField, yField);
  const pageStart = page && page.rows.length ? page.offset + 1 : 0;
  const pageEnd = page ? page.offset + page.rows.length : 0;
  const pageCount = page ? Math.max(1, Math.ceil(page.total_rows / page.limit)) : 1;
  const currentPage = page ? Math.floor(page.offset / page.limit) + 1 : 1;

  const changePage = (nextOffset: number) => {
    if (!sourceId || nextOffset < 0 || nextOffset >= (page?.total_rows ?? 0)) return;
    setOffset(nextOffset);
  };

  return <section className="workspace-page">
    <PageHeader
      title="Excel data explorer"
      description="Choose fields from your completed workbook and explore how their actual row values relate. Each plotted point represents one Excel row."
      actions={<Button variant="outline" size="sm" onClick={() => void loadSources()} disabled={!ready || sourceLoading || rowsLoading}><RefreshCw aria-hidden="true" className={sourceLoading || rowsLoading ? "animate-spin" : ""} />Refresh data</Button>}
    />

    <div className="mb-5 flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <p>Only completed workbooks owned by your signed-in account are available here. Workflow IDs and detected data types are kept out of the chart; your original Excel fields are used instead.</p>
    </div>

    <section aria-labelledby="quicksight-dashboard-heading" className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="quicksight-dashboard-heading" className="text-base font-semibold">QuickSight dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">Open your secure, owner-filtered QuickSight dashboard inside this website. The first open provisions a Reader for this website account.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadQuickDashboard()} disabled={!ready || quickLoading}>
          <RefreshCw aria-hidden="true" className={quickLoading ? "animate-spin" : ""} />
          {quickEmbedUrl ? "Reload dashboard" : "Open dashboard"}
        </Button>
      </div>
      {!quickEmbedUrl && !quickError && <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">The QuickSight dashboard loads here when you open it.</p>}
      {quickError && <div role="alert" className="notice notice-error mt-4 flex items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><p>{quickError}</p>{quickErrorDiagnostics && <p className="mt-1 text-xs text-muted-foreground">{quickErrorDiagnostics}</p>}</div></div>}
      {quickEmbedUrl && <>
        {quickLoading && <p role="status" className="notice mt-4">Connecting to QuickSight…</p>}
        {quickError && <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadQuickDashboard()} disabled={quickLoading}>Retry QuickSight</Button>}
        <div ref={quickContainer} className={`mt-4 min-h-[680px] overflow-hidden rounded-lg border border-border ${quickError ? "hidden" : ""}`} />
        {quickLoaded && <p className="mt-2 text-xs text-muted-foreground">QuickSight Reader access is tied to your website account.</p>}
      </>}
    </section>

    {!ready && <p role="note" className="notice mt-4">Sign in with a configured account to explore your Excel data.</p>}
    {sourceLoading && <p role="status" className="notice mt-4">Finding your completed workbooks…</p>}
    {error && <div role="alert" className="notice notice-error mt-4 flex items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><p>{error}</p>{errorDiagnostics && <p className="mt-1 text-xs text-muted-foreground">{errorDiagnostics}</p>}<Button variant="outline" size="sm" className="mt-3" onClick={() => void loadSources()} disabled={sourceLoading || rowsLoading}>Retry</Button></div></div>}

    {ready && !sourceLoading && !error && sources.length === 0 && <div className="mt-5 rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <BarChart3 aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-semibold">No completed Excel workbooks yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Finish a workbook job first. Its original input rows will appear here automatically, with one graph point per row.</p>
    </div>}

    {selectedSource && <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium">Workbook
            <select className="field-control mt-1" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setSheet(""); setOffset(0); setPage(null); fieldSourceKey.current = ""; }}>
              {sources.map((source) => <option key={source.source_id} value={source.source_id}>{source.workbook_name} · {formatSourceDate(source.created_at)}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Worksheet
            <select className="field-control mt-1" value={page?.sheet ?? sheet} disabled={!page?.sheets.length || rowsLoading} onChange={(event) => { setSheet(event.target.value); setOffset(0); setPage(null); fieldSourceKey.current = ""; }}>
              {(page?.sheets ?? []).map((item) => <option key={item.name} value={item.name}>{item.name} ({item.row_count.toLocaleString()} rows)</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Horizontal axis
            <select className="field-control mt-1" value={xField} disabled={!columns.length || rowsLoading} onChange={(event) => setXField(event.target.value)}>
              {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Vertical axis
            <select className="field-control mt-1" value={yField} disabled={!columns.length || rowsLoading} onChange={(event) => setYField(event.target.value)}>
              {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </label>
        </div>
        {page && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>{page.total_rows.toLocaleString()} source rows · plotting {plotCount.toLocaleString()} rows with both selected values · page {currentPage} of {pageCount}</p>
          <p>One point per row; hover over a point to see all values from that row.</p>
        </div>}
      </div>

      {rowsLoading && <p role="status" className="notice">Reading original Excel rows…</p>}
      {!rowsLoading && page && page.total_rows === 0 && <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">This worksheet has no non-empty data rows.</div>}
      {!rowsLoading && page && page.total_rows > 0 && <>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-3"><h2 className="text-base font-semibold">{yField || "Value"} by {xField || "field"}</h2><p className="mt-1 text-xs text-muted-foreground">Rows with repeated values remain separate points. Nothing is summed or averaged.</p></div>
          <ExcelRowPlot rows={rows} columns={columns} xField={xField} yField={yField} />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div><h2 className="text-sm font-semibold">Original Excel rows</h2><p className="mt-1 text-xs text-muted-foreground">Rows {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {page.total_rows.toLocaleString()}</p></div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={rowsLoading || page.offset === 0} onClick={() => changePage(Math.max(0, page.offset - page.limit))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={rowsLoading || !page.has_more} onClick={() => changePage(page.offset + page.limit)}>Next</Button>
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-muted/95 text-xs text-muted-foreground backdrop-blur"><tr><th className="whitespace-nowrap px-3 py-2 font-medium">Excel row</th>{columns.map((column) => <th key={column.name} className="min-w-32 whitespace-nowrap px-3 py-2 font-medium">{column.name}</th>)}</tr></thead>
              <tbody>{rows.map((row) => <tr key={row.row_number} className="border-t border-border/70 hover:bg-muted/30"><th scope="row" className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">{row.row_number}</th>{columns.map((column) => <td key={column.name} className="max-w-80 px-3 py-2">{cellText(row.values[column.name])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      </>}
    </div>}
  </section>;
}
