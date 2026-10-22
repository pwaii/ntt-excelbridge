import { useEffect, useRef, useState } from "react";
import { Menu, Plus, ShieldCheck, UserRound, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { WorkbookMark } from "@/components/ui/workbook-mark";
import { cn } from "@/lib/utils";
import { jobNavigation } from "@/routes/route-config";
import { SessionActions } from "@/auth/session-actions";

function Branding() {
  return <Link to="/jobs/new" aria-label="Pilotxl home" className="brand-link"><WorkbookMark className="brand-mark" /><strong>Pilotxl</strong></Link>;
}
function Navigation({ jobId, onNavigate }: { jobId?: string; onNavigate?: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) => cn("nav-link", isActive && "nav-link-active");
  return <>
    <NavLink to="/jobs/new" end className={linkClass} onClick={onNavigate}><Plus aria-hidden="true" />Create workflow</NavLink>
    {jobId && <div className="job-navigation"><p className="nav-group-label">Current workflow</p>{jobNavigation.map(({ suffix, label, icon: Icon }) => <NavLink key={suffix} to={`/jobs/${encodeURIComponent(jobId)}${suffix}`} end className={linkClass} onClick={onNavigate}><Icon aria-hidden="true" />{label}</NavLink>)}</div>}
    <NavLink to="/login" end className={(state) => cn(linkClass(state), "account-link")} onClick={onNavigate}><UserRound aria-hidden="true" />Account</NavLink>
  </>;
}
export function AppLayout() {
  const { pathname } = useLocation();
  const publicPage = pathname === "/login" || pathname === "/auth/callback";
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { id: jobId } = useParams<"id">();
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  return <div className="app-shell" data-public={publicPage}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    {!publicPage && <aside className="app-sidebar">
      <Branding />
      <nav aria-label="Desktop navigation" className="desktop-navigation"><Navigation jobId={jobId} /></nav>
      <div className="sidebar-context"><ShieldCheck aria-hidden="true" /><p>Review first.<br /><span>Keep your originals.</span></p></div>
      <div className="sidebar-session"><SessionActions /></div>
    </aside>}
    <div className="app-body">
      <header className="app-header" onKeyDown={(event) => { if (mobileOpen && event.key === "Escape") { setMobileOpen(false); menuButton.current?.focus(); } }}>
        <div className="app-header-inner">
          <div className="compact-brand"><Branding /></div>
          {!publicPage && <div className="workspace-scope"><span>Workbook workspace</span>{jobId && <><span aria-hidden="true">/</span><span className="scope-id" title={jobId}>Workflow {jobId.slice(0, 8)}</span></>}</div>}
          {!publicPage && <Button ref={menuButton} variant="ghost" size="icon" className="mobile-menu-button lg:hidden" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</Button>}
          {publicPage && <span className="public-context">Spreadsheet review workspace</span>}
        </div>
        {!publicPage && <nav id="mobile-navigation" aria-label="Mobile navigation" hidden={!mobileOpen} className="mobile-navigation"><Navigation jobId={jobId} onNavigate={() => setMobileOpen(false)} /><div className="mobile-session"><SessionActions /></div></nav>}
      </header>
      <div className="app-sheet">
        <main id="main-content" tabIndex={-1} className="app-main"><Outlet /></main>
        <footer className="app-footer"><ShieldCheck aria-hidden="true" /><span>Original workbooks are preserved.</span></footer>
      </div>
    </div>
  </div>;
}
