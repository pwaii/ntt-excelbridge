import { matchPath } from "react-router-dom";
import { Activity, ArrowDownToLine, FileCheck2, ListChecks } from "lucide-react";

export const jobNavigation = [
  { suffix: "", label: "Job progress", icon: Activity },
  { suffix: "/quality-review", label: "Quality review", icon: ListChecks },
  { suffix: "/transformation-review", label: "Transformation review", icon: FileCheck2 },
  { suffix: "/result", label: "Result", icon: ArrowDownToLine },
];

export function getPageTitle(pathname: string) {
  if (matchPath("/auth/callback", pathname)) return "Completing sign in";
  if (matchPath("/login", pathname) || pathname === "/") return "Sign in";
  if (matchPath("/jobs/new", pathname)) return "Create workflow";
  return jobNavigation.find(({ suffix }) => matchPath(`/jobs/:id${suffix}`, pathname))?.label
    ?? "Page not found";
}

