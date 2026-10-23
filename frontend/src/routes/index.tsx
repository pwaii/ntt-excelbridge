import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { JobTabsLayout } from "@/components/layout/job-tabs-layout";
import { CreateJobPage } from "@/pages/create-job-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { SignInPage } from "@/pages/sign-in-page";
import { getPageTitle } from "@/routes/route-config";
import { ProtectedRoute } from "@/auth/protected-route";
import { AuthCallbackPage } from "@/pages/auth-callback-page";

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
          <Route path="/jobs/new" element={<CreateJobPage />} />
          <Route path="/jobs/:id/*" element={<JobTabsLayout />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
