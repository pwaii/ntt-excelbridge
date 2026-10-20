import { AuthError, safeReturnTo, type AuthAdapter, type AuthUser } from "./types";

const loopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
export function localDevelopmentAllowed(env: Record<string, string | undefined>, origin: string, development: boolean) {
  if (!development || env.VITE_AUTH_MODE !== "local-development") return false;
  try {
    const frontend = new URL(origin); const backend = new URL(env.VITE_API_BASE_URL ?? "");
    return loopback(frontend) && loopback(backend) && ["http:", "https:"].includes(frontend.protocol)
      && ["http:", "https:"].includes(backend.protocol) && !backend.username && !backend.password;
  } catch { return false; }
}

// Explicit local workspace access, NOT Cognito authentication. This marker only
// remembers the developer's choice for this tab; no token/credential is issued.
export function createLocalDevelopmentAdapter(env: Record<string, string | undefined>, origin: string, development: boolean, storage: Storage): AuthAdapter {
  if (!localDevelopmentAllowed(env, origin, development)) throw new AuthError("Local development access requires a development server and loopback frontend/backend URLs.");
  const key = "xlsx.local-development-access";
  const user: AuthUser = { subject: "local-user", name: "Local development user" };
  const listeners = new Set<(user: AuthUser | null) => void>();
  let returnTo = "/jobs/new";
  return {
    mode: "local-development", canSignIn: true, configurationIssues: [],
    initialize: async () => storage.getItem(key) === "enabled" ? user : null,
    async login(target) { returnTo = safeReturnTo(target); storage.setItem(key, "enabled"); listeners.forEach((listener) => listener(user)); },
    async logout() { storage.removeItem(key); listeners.forEach((listener) => listener(null)); },
    getValidToken: async () => { throw new AuthError("Local development access does not issue a Cognito JWT."); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getReturnTo: () => returnTo,
  };
}
