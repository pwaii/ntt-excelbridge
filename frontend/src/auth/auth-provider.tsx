import { useEffect, useRef, useState, type ReactNode } from "react";
import { AuthContext } from "./context";
import { AuthError, safeReturnTo, type AuthAdapter, type AuthState } from "./types";

export function AuthProvider({ adapter, children }: { adapter: AuthAdapter; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const version = useRef(0);
  const loggedOut = useRef(false);
  const safeError = (error: unknown, fallback: string) => error instanceof AuthError ? error.message : fallback;
  useEffect(() => {
    let active = true;
    const initialVersion = version.current;
    const unsubscribe = adapter.subscribe((user) => {
      if (active && !loggedOut.current) setState(user ? { status: "authenticated", user } : { status: "unauthenticated" });
    });
    void adapter.initialize().then((user) => {
      if (active && version.current === initialVersion) setState(user ? { status: "authenticated", user } : { status: "unauthenticated" });
    }).catch(() => { if (active && version.current === initialVersion) setState({ status: "error", message: "Authentication could not be initialized. Sign in again." }); });
    return () => { active = false; unsubscribe(); };
  }, [adapter]);

  return <AuthContext.Provider value={{
    state, mode: adapter.mode ?? "cognito", canSignIn: adapter.canSignIn, configurationIssues: adapter.configurationIssues, getReturnTo: () => adapter.getReturnTo(),
    async login(target) {
      version.current += 1;
      loggedOut.current = false;
      setState({ status: "loading" });
      try { await adapter.login(safeReturnTo(target)); }
      catch (error) { setState({ status: "error", message: safeError(error, "Unable to sign in. Please try again.") }); }
    },
    async logout() {
      version.current += 1;
      loggedOut.current = true;
      // Clear all displayed identity before awaiting any remote navigation.
      setState({ status: "unauthenticated" });
      try { await adapter.logout(); }
      catch { setState({ status: "error", message: "Signed out locally. Cognito sign-out could not be completed; close this tab or retry sign in." }); }
    },
    async getValidToken() {
      if (loggedOut.current || state.status !== "authenticated") throw new AuthError("Sign in before requesting an API token.");
      const requestedVersion = version.current;
      try {
        const token = await adapter.getValidToken();
        if (loggedOut.current || version.current !== requestedVersion) throw new AuthError("Sign in before requesting an API token.");
        return token;
      }
      catch (error) {
        // A token/configuration failure never exposes a token or an SDK response.
        if (!loggedOut.current && version.current === requestedVersion) setState({ status: "error", message: safeError(error, "Unable to retrieve an API token. Sign in again.") });
        throw new AuthError("A valid API token is unavailable.");
      }
    },
  }}>{children}</AuthContext.Provider>;
}
