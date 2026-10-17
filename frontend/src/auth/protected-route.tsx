import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./context";
import { safeReturnTo } from "./types";

export function ProtectedRoute() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <p role="status" className="text-sm text-muted-foreground">Checking your session…</p>;
  if (state.status !== "authenticated") return <Navigate to="/login" replace state={{ returnTo: safeReturnTo(location.pathname) }} />;
  return <Outlet />;
}
