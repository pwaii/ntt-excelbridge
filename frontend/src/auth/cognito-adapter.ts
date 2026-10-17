import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { CognitoConfig } from "./config";
import { AuthError, safeReturnTo, type AuthAdapter, type AuthUser } from "./types";

type OidcManager = Pick<UserManager, "getUser" | "removeUser" | "signinRedirect" | "signinRedirectCallback" | "signinSilent" | "clearStaleState" | "events">;

function basicUser(user: User): AuthUser {
  return { subject: user.profile.sub, name: user.profile.name, email: user.profile.email };
}

export function createCognitoAdapter(
  config: CognitoConfig,
  manager: OidcManager = new UserManager({
    authority: config.authority, client_id: config.clientId,
    redirect_uri: config.redirectUri, response_type: "code", scope: config.scope,
    disablePKCE: false, automaticSilentRenew: false, loadUserInfo: false,
    revokeTokenTypes: ["refresh_token"],
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage, prefix: "xlsx.oidc." }),
    metadataSeed: {
      authorization_endpoint: `${config.domain.replace(/\/$/, "")}/oauth2/authorize`,
      token_endpoint: `${config.domain.replace(/\/$/, "")}/oauth2/token`,
    },
  }),
  browser = {
    href: () => window.location.href,
    cleanCallback: () => window.history.replaceState(null, "", "/auth/callback"),
    redirect: (url: string) => window.location.assign(url),
  },
): AuthAdapter {
  let initialization: Promise<AuthUser | null> | undefined;
  let renewal: Promise<User> | undefined;
  let returnTo = "/jobs/new";
  let generation = 0;
  let signedOut = false;
  let handlingCallback = false;
  const listeners = new Set<(user: AuthUser | null) => void>();
  const emit = (user: AuthUser | null) => listeners.forEach((listener) => listener(user));
  manager.events.addUserLoaded((user) => { if (!signedOut && !handlingCallback) emit(basicUser(user)); });
  manager.events.addUserUnloaded(() => emit(null));

  async function renew(): Promise<User> {
    if (renewal) return renewal;
    const started = generation;
    renewal = (async () => {
      try {
        const user = await manager.getUser();
        // Cognito does not support prompt=none iframe renew. Use the refresh grant.
        if (signedOut || !user?.refresh_token) throw new Error();
        const refreshed = await manager.signinSilent();
        if (started !== generation || !refreshed || refreshed.expired) throw new Error();
        return refreshed;
      } catch {
        await manager.removeUser();
        emit(null);
        throw new AuthError("Your session has expired. Sign in again.");
      } finally { renewal = undefined; }
    })();
    return renewal;
  }
  manager.events.addAccessTokenExpired(() => { void renew().catch(() => { /* Safe unauthenticated state is emitted by renew. */ }); });

  return {
    canSignIn: true,
    configurationIssues: config.apiTokenType ? [] : ["Backend must confirm VITE_COGNITO_API_TOKEN_TYPE: access or id. API token retrieval is blocked until configured."],
    initialize() {
      // StrictMode must not redeem the same one-use authorization code twice.
      initialization ??= (async () => {
        const url = new URL(browser.href());
        if (url.pathname === "/auth/callback") {
          handlingCallback = true;
          try {
            const user = await manager.signinRedirectCallback(url.href);
            returnTo = safeReturnTo(user.state && typeof user.state === "object" && "returnTo" in user.state ? user.state.returnTo : null);
            if (user.expired) throw new Error();
            return basicUser(user);
          } catch {
            await manager.removeUser();
            throw new AuthError("Sign-in could not be completed. Return to sign in and try again.");
          } finally { browser.cleanCallback(); handlingCallback = false; }
        }
        await manager.clearStaleState();
        const user = await manager.getUser();
        return user ? basicUser(user.expired ? await renew() : user) : null;
      })();
      return initialization;
    },
    async login(target) {
      try { await manager.clearStaleState(); await manager.signinRedirect({ state: { returnTo: safeReturnTo(target) } }); }
      catch { throw new AuthError("Unable to open Cognito sign in. Please try again."); }
    },
    async logout() {
      signedOut = true;
      generation += 1;
      initialization = undefined;
      await manager.removeUser();
      emit(null);
      const url = new URL("/logout", config.domain);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("logout_uri", config.logoutUri);
      // Cognito logout is not OIDC end-session; do not put tokens in this URL.
      browser.redirect(url.href);
    },
    async getValidToken() {
      // Logout invalidates access immediately, before asynchronous SDK cleanup.
      if (signedOut) throw new AuthError("Sign in before requesting an API token.");
      if (!config.apiTokenType) throw new AuthError("The backend API token type has not been configured.");
      const started = generation;
      let user = await manager.getUser();
      const expiry = (value: User) => config.apiTokenType === "id" ? value.profile.exp : value.expires_at;
      if (!user) throw new AuthError("Sign in before requesting an API token.");
      if (!Number.isFinite(expiry(user)) || expiry(user)! <= Date.now() / 1000 + 30) user = await renew();
      const token = config.apiTokenType === "id" ? user?.id_token : user?.access_token;
      if (started !== generation || !user || !token || !Number.isFinite(expiry(user)) || expiry(user)! <= Date.now() / 1000) {
        await manager.removeUser();
        throw new AuthError("Your session has expired. Sign in again.");
      }
      return token;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getReturnTo: () => returnTo,
  };
}

export function createUnavailableAuthAdapter(issues: readonly string[]): AuthAdapter {
  const unavailable = async (): Promise<never> => { throw new AuthError("Cognito is not configured. Contact the application administrator."); };
  return {
    canSignIn: false, configurationIssues: issues,
    initialize: async () => {
      if (window.location.pathname === "/auth/callback") window.history.replaceState(null, "", "/auth/callback");
      return null;
    },
    login: unavailable, logout: async () => {}, getValidToken: unavailable,
    subscribe: () => () => {}, getReturnTo: () => "/jobs/new",
  };
}
