import { useAuth } from "./context";
import { Button } from "@/components/ui/button";

export function SessionActions() {
  const { state, mode, logout } = useAuth();
  if (state.status !== "authenticated") return null;
  return <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
    <span className="max-w-full break-words">{mode === "local-development" ? "Local development · local-user" : `Signed in as ${state.user.name || state.user.email || state.user.subject}`}</span>
    <Button variant="ghost" size="sm" onClick={() => { void logout(); }}>{mode === "local-development" ? "Exit local workspace" : "Sign out"}</Button>
  </div>;
}
