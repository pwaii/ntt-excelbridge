import { readAuthConfig } from "./config";
import { createCognitoAdapter, createUnavailableAuthAdapter } from "./cognito-adapter";
import { createLocalDevelopmentAdapter } from "./local-development";

// Local fallback is explicit, development-only, and restricted to loopback URLs.
// Cognito remains the production authentication mechanism.
const result = readAuthConfig(import.meta.env, window.location.origin, import.meta.env.DEV);
function configureAdapter() {
  if (import.meta.env.VITE_AUTH_MODE === "local-development") {
    if (!import.meta.env.DEV) return createUnavailableAuthAdapter(["Local development access is disabled in production. Configure Cognito."]);
    try { return createLocalDevelopmentAdapter(import.meta.env, window.location.origin, import.meta.env.DEV, window.sessionStorage); }
    catch { return createUnavailableAuthAdapter(["Local development access requires loopback frontend/backend URLs and available session storage."]); }
  }
  if (!result.config) return createUnavailableAuthAdapter(result.issues);
  try { return createCognitoAdapter(result.config); }
  catch { return createUnavailableAuthAdapter(["Browser authentication storage could not be initialized. Allow session storage and reload."]); }
}
export const browserAuthAdapter = configureAdapter();
