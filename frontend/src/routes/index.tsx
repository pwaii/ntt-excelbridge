import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { CreateJobPage } from "@/pages/create-job-page";
import { JobProgressPage } from "@/pages/job-progress-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { QualityReviewPage } from "@/pages/quality-review-page";
import { ResultPage } from "@/pages/result-page";
import { SignInPage } from "@/pages/sign-in-page";
import { TransformationReviewPage } from "@/pages/transformation-review-page";
import { getPageTitle } from "@/routes/route-config";
import { ProtectedRoute } from "@/auth/protected-route";
import { AuthCallbackPage } from "@/pages/auth-callback-page";

export function AppRoutes() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${getPageTitle(pathname)} | XLSX Data Workflow`;
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
          <Route path="/jobs/:id" element={<JobProgressPage />} />
          <Route path="/jobs/:id/quality-review" element={<QualityReviewPage />} />
          <Route path="/jobs/:id/transformation-review" element={<TransformationReviewPage />} />
          <Route path="/jobs/:id/result" element={<ResultPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
