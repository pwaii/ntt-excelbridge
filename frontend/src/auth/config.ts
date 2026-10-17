export interface CognitoConfig {
  authority: string;
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  scope: string;
  apiTokenType: "access" | "id" | null;
}

export function readAuthConfig(env: Record<string, string | undefined>, origin: string, development: boolean) {
  const values = {
    authority: env.VITE_COGNITO_AUTHORITY?.trim() ?? "",
    domain: env.VITE_COGNITO_DOMAIN?.trim() ?? "",
    clientId: (env.VITE_COGNITO_CLIENT_ID || env.VITE_COGNITO_APP_CLIENT_ID)?.trim() ?? "",
    redirectUri: env.VITE_COGNITO_REDIRECT_URI?.trim() ?? "",
    logoutUri: env.VITE_COGNITO_LOGOUT_URI?.trim() ?? "",
  };
  const names = { authority: "VITE_COGNITO_AUTHORITY", domain: "VITE_COGNITO_DOMAIN", clientId: "VITE_COGNITO_CLIENT_ID (or VITE_COGNITO_APP_CLIENT_ID)", redirectUri: "VITE_COGNITO_REDIRECT_URI", logoutUri: "VITE_COGNITO_LOGOUT_URI" };
  const issues: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const name = names[key as keyof typeof names];
    if (!value) { issues.push(`Missing ${name}.`); continue; }
    if (key === "clientId") continue;
    try {
      const url = new URL(value);
      const local = development && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error();
      if (key === "domain" && url.pathname !== "/") throw new Error();
      if (key === "redirectUri" && (url.origin !== origin || url.pathname !== "/auth/callback")) throw new Error();
      if (key === "logoutUri" && (url.origin !== origin || url.pathname !== "/login")) throw new Error();
    } catch { issues.push(`Invalid ${name}; use the documented HTTPS URL (HTTP loopback is allowed only in development).`); }
  }
  const tokenType = env.VITE_COGNITO_API_TOKEN_TYPE;
  const apiTokenType = tokenType === "access" || tokenType === "id" ? tokenType : null;
  const scope = env.VITE_COGNITO_SCOPES?.trim() || "openid profile email";
  if (!scope.split(/\s+/).includes("openid")) issues.push("VITE_COGNITO_SCOPES must include openid.");
  return { config: issues.length ? null : { ...values, scope, apiTokenType } satisfies CognitoConfig, issues };
}
