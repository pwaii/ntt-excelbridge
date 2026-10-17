import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileSpreadsheet, LogIn, Menu, Plus, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPageTitle, jobNavigation } from "@/routes/route-config";
import { SessionActions } from "@/auth/session-actions";

function Branding() {
  return (
    <Link to="/jobs/new" className="flex min-w-0 items-center gap-3 rounded-md">
      <span className="workflow-identity flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[#081329]">
        <FileSpreadsheet className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm leading-snug font-semibold tracking-tight">XLSX<span className="block font-normal text-muted-foreground">Data Workflow</span></span>
    </Link>
  );
}

function Navigation({ jobId, onNavigate }: { jobId?: string; onNavigate?: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) => cn(
    "flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-offset-2",
    isActive ? "bg-accent font-semibold text-primary shadow-[inset_0_0_0_1px_#8dd3e724]" : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
      <aside className="workspace-sidebar fixed inset-y-0 left-0 hidden w-52 flex-col border-r lg:flex" aria-label="Sidebar">
        <div className="flex h-18 items-center px-5"><Branding /></div>
        <nav aria-label="Desktop navigation" className="flex-1 overflow-y-auto px-3 py-3"><Navigation jobId={jobId} /></nav>
      </aside>
      <div className="flex min-h-svh min-w-0 flex-col lg:pl-52">
        <header className={cn("border-b bg-background/80", pathname === "/jobs/new" && "lg:hidden")} onKeyDown={(event) => {
          if (mobileOpen && event.key === "Escape") {
            setMobileOpen(false);
            menuButton.current?.focus();
          }
        }}>
          <div className="flex min-h-16 items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
            <div className="lg:hidden"><Branding /></div>
            <div className="hidden items-center gap-3 text-sm lg:flex">
              <span className="text-muted-foreground">Workspace</span>
              <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{pageTitle}</span>
            </div>
            <span className="hidden rounded-full border bg-muted px-3 py-1 text-xs text-muted-foreground sm:inline-flex">Frontend preview</span>
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
            </Button>
          </div>
          <nav
            id="mobile-navigation"
            aria-label="Mobile navigation"
            hidden={!mobileOpen}
            className="max-h-[70svh] overflow-y-auto border-t px-5 py-5 lg:hidden"
          >
            <Navigation jobId={jobId} onNavigate={() => setMobileOpen(false)} />
          </nav>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 focus:outline-none sm:px-8 lg:px-10">
          <Outlet />
        </main>
        <footer className="mx-auto w-full max-w-6xl px-5 pb-6 text-xs text-muted-foreground sm:px-8 lg:px-10">
          <SessionActions />
          XLSX Data Workflow · Human-reviewed workbook changes
        </footer>
      </div>
    </div>
  );
}
