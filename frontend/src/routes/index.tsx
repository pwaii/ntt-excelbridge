import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { JobProgressPage } from "@/pages/job-progress-page";
import { CreateJobPage } from "@/pages/create-job-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { SignInPage } from "@/pages/sign-in-page";
import { getPageTitle } from "@/routes/route-config";
import { ProtectedRoute } from "@/auth/protected-route";
import { AuthCallbackPage } from "@/pages/auth-callback-page";

function RedirectToJob() {
  const { id } = useParams<"id">();
  return <Navigate to={`/jobs/${encodeURIComponent(id!)}`} replace />;
}

function FreshCreateJobPage() {
  const { key } = useLocation();
  return <CreateJobPage key={key} />;
}

export function AppRoutes() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${getPageTitle(pathname)} | Pilotxl`;
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<SignInPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/jobs/new" element={<FreshCreateJobPage />} />
          <Route path="/jobs/:id/quality-review" element={<RedirectToJob />} />
          <Route path="/jobs/:id/transformation-review" element={<RedirectToJob />} />
          <Route path="/jobs/:id/result" element={<RedirectToJob />} />
          <Route path="/jobs/:id/*" element={<JobProgressPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
