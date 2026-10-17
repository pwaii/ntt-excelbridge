import { InMemoryWebStorage, User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCognitoAdapter } from "@/auth/cognito-adapter";
import type { CognitoConfig } from "@/auth/config";

const config: CognitoConfig = {
  authority: "https://cognito-idp.us-east-1.amazonaws.com/mock-pool",
  domain: "https://mock.auth.us-east-1.amazoncognito.com", clientId: "mock-client",
  redirectUri: "https://app.example.invalid/auth/callback", logoutUri: "https://app.example.invalid/login",
  scope: "openid profile email", apiTokenType: "access",
};
function testUser(offset = 3600, refresh = true) {
  const exp = Math.floor(Date.now() / 1000) + offset;
  return new User({ access_token: "mock-access-value", id_token: "mock-id-value", refresh_token: refresh ? "mock-refresh-value" : undefined,
    token_type: "Bearer", expires_at: exp, profile: { sub: "mock-sub", iss: config.authority, aud: config.clientId, iat: exp - 3600, exp }, userState: { returnTo: "/jobs/mock/result" } });
}
function harness(user: User | null = testUser(), settings: CognitoConfig = config, href = "https://app.example.invalid/login") {
  const manager = new UserManager({ authority: config.authority, client_id: config.clientId, redirect_uri: config.redirectUri, automaticSilentRenew: false,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }), stateStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }) });
  const getUser = vi.spyOn(manager, "getUser").mockResolvedValue(user);
  const remove = vi.spyOn(manager, "removeUser").mockImplementation(async () => { getUser.mockResolvedValue(null); });
  const silent = vi.spyOn(manager, "signinSilent").mockResolvedValue(testUser());
  const callback = vi.spyOn(manager, "signinRedirectCallback").mockResolvedValue(testUser());
  const login = vi.spyOn(manager, "signinRedirect").mockResolvedValue();
  vi.spyOn(manager, "clearStaleState").mockResolvedValue();
  const browser = { href: () => href, cleanCallback: vi.fn(), redirect: vi.fn() };
  const auth = createCognitoAdapter(settings, manager, browser);
  return { auth, manager, getUser, remove, silent, callback, login, browser };
}
afterEach(() => vi.restoreAllMocks());

describe("Cognito SDK adapter", () => {
  it("blocks token retrieval immediately while logout is still clearing SDK storage", async () => {
    const { auth, remove, getUser } = harness();
    let finish!: () => void;
    remove.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const logout = auth.logout();
    await expect(auth.getValidToken()).rejects.toThrow("Sign in");
    expect(getUser).not.toHaveBeenCalled();
    finish();
    await logout;
  });
  it("requires reauthentication after a fresh page has no in-memory SDK user", async () => {
    const { auth, silent, login } = harness(null);
    expect(await auth.initialize()).toBeNull();
    await expect(auth.getValidToken()).rejects.toThrow("Sign in");
    expect(silent).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
  it.each(["access", "id"] as const)("returns only the explicitly configured %s token", async (apiTokenType) => {
    const { auth } = harness(testUser(), { ...config, apiTokenType });
    expect(await auth.getValidToken()).toBe(apiTokenType === "access" ? "mock-access-value" : "mock-id-value");
  });
  it("blocks API tokens when the backend token contract is unspecified", async () => {
    const { auth } = harness(testUser(), { ...config, apiTokenType: null });
    await expect(auth.getValidToken()).rejects.toThrow("token type has not been configured");
    expect(auth.canSignIn).toBe(true);
  });
  it("refreshes near expiry using the SDK refresh grant once for concurrent calls", async () => {
    const { auth, silent } = harness(testUser(10));
    expect(await Promise.all([auth.getValidToken(), auth.getValidToken()])).toEqual(["mock-access-value", "mock-access-value"]);
    expect(silent).toHaveBeenCalledOnce();
  });
  it("clears expired sessions without attempting unsupported iframe renew when refresh is missing", async () => {
    const { auth, silent, remove } = harness(testUser(-1, false));
    const listener = vi.fn(); auth.subscribe(listener);
    await expect(auth.getValidToken()).rejects.toThrow("session has expired");
    expect(silent).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledOnce(); expect(listener).toHaveBeenCalledWith(null);
  });
  it("sanitizes refresh failures and clears the SDK user", async () => {
    const { auth, silent, remove } = harness(testUser(-1));
    silent.mockRejectedValue(new Error("private-provider-response-with-token"));
    await expect(auth.getValidToken()).rejects.toThrow("Your session has expired. Sign in again.");
    expect(remove).toHaveBeenCalledOnce();
  });
  it("redeems callback once and preserves the safe return route", async () => {
    const { auth, callback, browser } = harness(null, config, `${config.redirectUri}?code=mock-one-use-code&state=mock-state`);
    await Promise.all([auth.initialize(), auth.initialize()]);
    expect(callback).toHaveBeenCalledOnce(); expect(browser.cleanCallback).toHaveBeenCalledOnce();
    expect(auth.getReturnTo()).toBe("/jobs/mock/result");
  });
  it("cleans callback parameters and does not authenticate an SDK-rejected callback", async () => {
    const { auth, callback, browser, remove } = harness(null, config, `${config.redirectUri}?code=mock&state=wrong`);
    callback.mockRejectedValue(new Error("State validation failed with sensitive response"));
    await expect(auth.initialize()).rejects.toThrow("Sign-in could not be completed");
    expect(browser.cleanCallback).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
  });
  it("does not publish an early user-loaded event before the callback return target is known", async () => {
    const { auth, manager, callback } = harness(null, config, `${config.redirectUri}?code=mock&state=mock`);
    const listener = vi.fn(); auth.subscribe(listener);
    callback.mockImplementation(async () => { await manager.events.load(testUser()); return testUser(); });
    await auth.initialize();
    expect(listener).not.toHaveBeenCalled();
    await manager.events.unload();
  });
  it("uses Cognito logout with public parameters only and clears local state", async () => {
    const { auth, browser, remove } = harness();
    const listener = vi.fn(); auth.subscribe(listener);
    await auth.logout();
    expect(remove).toHaveBeenCalledOnce(); expect(listener).toHaveBeenCalledWith(null);
    const url = new URL(browser.redirect.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(`${config.domain}/logout`);
    expect([...url.searchParams.keys()].sort()).toEqual(["client_id", "logout_uri"]);
    expect(url.searchParams.get("logout_uri")).toBe(config.logoutUri);
    await expect(auth.getValidToken()).rejects.toThrow("Sign in");
  });
  it("does not resurrect a session when a refresh finishes after logout", async () => {
    const { auth, silent, manager } = harness(testUser(-1));
    let resolve!: (value: User) => void;
    silent.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const listener = vi.fn(); auth.subscribe(listener);
    const token = auth.getValidToken();
    const rejected = expect(token).rejects.toThrow("session has expired");
    await vi.waitFor(() => expect(silent).toHaveBeenCalledOnce());
    await auth.logout();
    await manager.events.load(testUser());
    resolve(testUser());
    await rejected;
    expect(listener.mock.calls.every(([value]) => value === null)).toBe(true);
    await manager.events.unload();
  });
  it("delegates login and safe app state to the SDK", async () => {
    const { auth, login } = harness(null);
    await auth.login("https://evil.invalid");
    expect(login).toHaveBeenCalledWith({ state: { returnTo: "/jobs/new" } });
  });
});
