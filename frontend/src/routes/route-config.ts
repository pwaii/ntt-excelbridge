import { matchPath } from "react-router-dom";

export function getPageTitle(pathname: string) {
  if (matchPath("/auth/callback", pathname)) return "Completing sign in";
  if (matchPath("/login", pathname) || pathname === "/") return "Sign in";
  if (matchPath("/jobs/new", pathname)) return "Create workflow";
  if (matchPath("/jobs/:id/*", pathname)) return "Job progress";
  return "Page not found";
}
