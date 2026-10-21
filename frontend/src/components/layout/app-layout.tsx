import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileSpreadsheet, LogIn, Menu, Plus, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPageTitle, jobNavigation } from "@/routes/route-config";
import { SessionActions } from "@/auth/session-actions";

function Branding() {
  return (
    <Link to="/jobs/new" aria-label="XLSX Data Workflow home" className="flex min-w-0 items-center gap-3 rounded-md">
      <span className="workflow-identity flex size-9 shrink-0 items-center justify-center rounded-md">
        <FileSpreadsheet className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm leading-snug font-semibold tracking-tight">XLSX<span className="block text-xs font-normal text-muted-foreground">Data Workflow</span></span>
    </Link>
  );
}

function Navigation({ jobId, onNavigate }: { jobId?: string; onNavigate?: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) => cn(
    "flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-offset-2",
    isActive ? "bg-accent font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
  return (
    <>
      <p className="mb-2 px-2.5 text-[11px] font-medium text-muted-foreground">Workspace</p>
      <div className="space-y-1">
        <NavLink to="/jobs/new" end className={linkClass} onClick={onNavigate}>
          <Plus className="size-4 shrink-0" aria-hidden="true" />Create workflow
        </NavLink>
        <NavLink to="/login" end className={linkClass} onClick={onNavigate}>
          <LogIn className="size-4 shrink-0" aria-hidden="true" />Sign in
        </NavLink>
      </div>
      {jobId && (
        <div className="mt-5 border-t pt-4">
          <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">Current job</p>
          <p className="mb-4 truncate px-3 text-xs text-muted-foreground" title={jobId}>{jobId}</p>
          <div className="space-y-1">
            {jobNavigation.map(({ suffix, label, icon: Icon }) => (
              <NavLink key={suffix} to={`/jobs/${encodeURIComponent(jobId)}${suffix}`} end className={linkClass} onClick={onNavigate}>
                <Icon className="size-4 shrink-0" aria-hidden="true" />{label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const publicPage = pathname === "/login";
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { id: jobId } = useParams<"id">();
  const pageTitle = getPageTitle(pathname);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <div className="app-shell min-h-svh bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-card focus:p-4">
        Skip to content
      </a>
      {!publicPage && <aside className="workspace-sidebar fixed inset-y-0 left-0 hidden w-56 flex-col border-r lg:flex" aria-label="Sidebar">
        <div className="flex h-18 items-center border-b px-5"><Branding /></div>
        <nav aria-label="Desktop navigation" className="flex-1 overflow-y-auto px-3 py-3"><Navigation jobId={jobId} /></nav>
      </aside>}
      <div className={cn("flex min-h-svh min-w-0 flex-col", !publicPage && "lg:pl-56")}>
        <header className="border-b bg-card" onKeyDown={(event) => {
          if (mobileOpen && event.key === "Escape") {
            setMobileOpen(false);
            menuButton.current?.focus();
          }
        }}>
          <div className={cn("flex min-h-16 items-center justify-between gap-4 px-4 sm:px-8", publicPage && "mx-auto w-full max-w-7xl")}>
            <div className={publicPage ? "py-3" : "lg:hidden"}><Branding /></div>
            {publicPage ? <a href="#sign-in" className="rounded-md px-3 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline">Sign in</a> : <><div className="hidden items-center gap-3 text-sm lg:flex">
              <span className="text-muted-foreground">Workspace</span>
              <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{pageTitle}</span>
            </div>
            <Button
              ref={menuButton}
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </Button></>}
          </div>
          {!publicPage && <nav
            id="mobile-navigation"
            aria-label="Mobile navigation"
            hidden={!mobileOpen}
            className="max-h-[70svh] overflow-y-auto border-t px-5 py-5 lg:hidden"
          >
            <Navigation jobId={jobId} onNavigate={() => setMobileOpen(false)} />
          </nav>}
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6 focus:outline-none sm:px-8 sm:py-8">
          <Outlet />
        </main>
        <footer className="mx-auto w-full min-w-0 max-w-7xl border-t px-4 py-5 text-xs text-muted-foreground sm:px-8">
          <SessionActions />
          XLSX Data Workflow · Human-reviewed workbook changes
        </footer>
      </div>
    </div>
  );
}
