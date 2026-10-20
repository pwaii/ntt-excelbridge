import { useAuth } from "./context";
import { Button } from "@/components/ui/button";

export function SessionActions() {
  const { state, mode, logout } = useAuth();
  if (state.status !== "authenticated") return null;
  return <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
    <span className="max-w-full break-words">{mode === "local-development" ? "Local fallback: local-user · No Cognito authentication" : `Signed in as ${state.user.name || state.user.email || state.user.subject}`}</span>
    <Button variant="outline" size="sm" onClick={() => { void logout(); }}>{mode === "local-development" ? "Exit local workspace" : "Sign out"}</Button>
  </div>;
}
