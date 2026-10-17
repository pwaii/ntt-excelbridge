# Task 7 — Cognito authentication foundation

Update: the user has enabled an explicit development-only backend fallback.
See [current local access mode](INTEGRATION.md#current-local-access-mode).
It issues no JWT, is labeled as local development, and cannot activate in a
production build. The Cognito architecture below remains the production path.

## Architecture

`AuthProvider` uses an `AuthAdapter` interface. The production adapter uses
`oidc-client-ts` 3.5.0, Authorization Code Flow with PKCE enabled, and library-owned
OAuth state validation. No password form or OAuth cryptography is implemented here.
`SignInPage` redirects only after explicit Sign In. `/auth/callback` delegates code
redemption/state checking to the SDK, strips callback query parameters on success
or failure, and restores only a safe internal job route. Initialization is shared
so React StrictMode cannot redeem a one-use code twice. No auth errors log or render
SDK responses, tokens, codes, or user-supplied exception messages.

The context exposes loading/authenticated/unauthenticated/error state, basic user
subject/name/email, login, logout, and `getValidToken()`. Tokens are held by the SDK
in an **in-memory user store**, never React display state/localStorage. Only OAuth
transaction state (including the PKCE verifier needed across the redirect) uses
tab-scoped sessionStorage, with the `xlsx.oidc.` prefix; SDK consumes successful
transaction state and clears stale entries on initialization/new login.

Tokens do not survive a full reload/tab close. A reopened page requires sign-in
again, potentially using the still-valid Cognito managed-login cookie. This is an
intentional persistence tradeoff, not a claim that the backend session was revoked.
Authenticated UI state is not a security boundary: backend JWT verification and
ownership enforcement remain mandatory.

Near-expiry token requests share one SDK refresh grant. Access-token expiry events
also attempt refresh when a refresh token exists in memory. Cognito's unsupported
`prompt=none` iframe renewal is avoided. Failed/missing refresh clears the SDK user
and requires sign-in again. Logout immediately removes displayed identity, clears
the SDK user and navigates to Cognito `/logout?client_id=…&logout_uri=…`, without a
JWT in the URL. Late refresh completion cannot resurrect a logged-out session.
Logout does not claim global token revocation or sign-out from external social IdPs.

Job routes retain the existing layout/content but require authenticated state:
`/jobs/new`, `/jobs/:id`, `/jobs/:id/quality-review`,
`/jobs/:id/transformation-review`, `/jobs/:id/result`. Loading shows a session check;
unauthenticated/error states redirect to `/login`. Login/callback/not-found routes
are public, and sign-in does not automatically redirect in a loop.

## Public environment configuration

Copy `frontend/.env.example` to **`frontend/.env.local`** and fill public values.
Do not put secrets, AWS keys, passwords, JWTs, or a client secret in any VITE variable.
The existing `.gitignore` excludes `.env.local`. Restart Vite after changing config.

| Variable | Required value |
| --- | --- |
| `VITE_API_BASE_URL` | Existing backend URL; not called by Task 7 |
| `VITE_COGNITO_AUTHORITY` | Full pool issuer, `https://cognito-idp.<region>.amazonaws.com/<pool-id>` |
| `VITE_COGNITO_DOMAIN` | HTTPS Hosted UI/custom domain origin, without a path |
| `VITE_COGNITO_CLIENT_ID` | Public SPA client ID. Existing `VITE_COGNITO_APP_CLIENT_ID` is accepted as an alias |
| `VITE_COGNITO_REDIRECT_URI` | Exact same-origin `/auth/callback` URL registered in Cognito |
| `VITE_COGNITO_LOGOUT_URI` | Exact same-origin `/login` URL registered as an allowed sign-out URL |
| `VITE_COGNITO_SCOPES` | Defaults to `openid profile email`; include BE-confirmed API scopes if needed |
| `VITE_COGNITO_API_TOKEN_TYPE` | **BE must explicitly confirm `access` or `id`; there is no default** |

The example uses `http://127.0.0.1:5173`. If using `localhost`, change both redirect
URLs and the Cognito allowlist consistently. HTTP loopback is accepted only by the
development build; production requires HTTPS. Build artifacts contain public Vite
configuration, so configure each deployment before building. Static hosting must
rewrite `/auth/callback` and other SPA deep links to `index.html`.

AWS must provide a **public SPA app client with no client secret**, an enabled
authorization-code grant, configured scopes/identity providers, and exact callback
and logout allowlists. The frontend requests no AWS IAM credentials.

## Backend contract finding and blockers

`backend/app/auth.py` reads a validated `sub` from API Gateway JWT authorizer claims;
it does not specify `token_use`, access-vs-ID selection, or required API scopes.
`infra/template.yaml` still marks the HTTP API/Cognito JWT authorizer as TODO.
Therefore neither token type is inferred from the backend's generic “Cognito JWT”
wording. Login may work when Cognito is configured, but `getValidToken()` refuses
to provide an API token until `VITE_COGNITO_API_TOKEN_TYPE` is explicitly set.
An ID token is never silently substituted for an access token, or vice versa.

BE/AWS must confirm issuer, audience/client ID, token type, route authorization
scopes, deployed API origin/CORS and JWT verification. Configuring these public
values alone does not prove the deployed backend enforces them.

The checkout has only `.env.example`, no configured frontend environment. Missing
Hosted UI authority/domain/client ID are reported, and sample redirect/logout URLs
must be copied into real configuration. Actual app-client setup, allowlists and
token type remain unverified. **No real Cognito login or backend authorization was
tested.** No bypass is enabled in development or production; the unavailable
adapter returns unauthenticated and cannot mint tokens. Unit-test provider injection
is isolated to test files, not an environment flag or development credential.

The existing Day 1 preview is preserved behind authentication. Without settings,
visiting a job route now redirects to Sign In rather than exposing an anonymous
workspace. The legacy upload feature/API client stays unrouted and unchanged.
No Job Creation API/S3 integration is included in Task 7.

## Tests and handoff

`auth.test.tsx` uses mocked provider adapters; `cognito-adapter.test.ts` stubs SDK
operations. Tests cover all protected routes, loading/errors, login return path,
callback recovery, logout, access/ID selection, missing contract, refresh/expiry,
concurrent requests, and logout-vs-refresh races. Existing route tests use an
explicit authenticated test context; form/ADR/model tests remain intact.

Before marking real integration complete, configure a real pool/client and run:
protected deep link → Hosted UI → callback → intended route → token authorized
by BE → token renewal → sign-out → protected route denied, plus reload and
cancelled/invalid callback recovery. These steps have **not** been executed here.

Source references: [oidc-client-ts and Cognito-specific settings](https://authts.github.io/oidc-client-ts/),
[AWS PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html),
[Cognito logout](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html).
The historical `DAY1-AUDIT.md` records the pre-authentication Day 1 state.

## Implementation files and executed verification

- `src/auth/`: types/config, SDK adapter, browser configuration, React context/provider,
  route guard and shared session actions.
- `src/app/App.tsx`: wrap the existing routes with authentication.
- `src/routes/index.tsx`, `route-config.ts`: protected routes and callback route/title.
- `src/pages/sign-in-page.tsx`, `auth-callback-page.tsx`: sign-in and callback UI.
- `src/components/layout/app-layout.tsx`: shared identity/sign-out action in the footer.
- `src/tests/auth.test.tsx`, `cognito-adapter.test.ts`, `routing.test.tsx`: new auth
  coverage and existing route coverage under an explicit mocked authenticated context.
- `index.html`: no-referrer policy for OAuth callback navigation.
- `package.json`, `package-lock.json`: add `oidc-client-ts` and its locked dependencies.
- `.env.example`, root `../.env.example`: public configuration examples.
- `README.md`, `AUTHENTICATION.md`: setup, boundaries and blockers.

Executed on 2026-10-16:

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed, zero warnings |
| `npm.cmd test -- --reporter=dot` | 128 passed, 0 failed, 7 files (36 new auth cases) |
| `npm.cmd run build` | Passed |
| `npm.cmd ci --dry-run --offline --ignore-scripts …` | Passed; this was a dry run, not a clean reinstall |
| Scoped `git diff --check` | Passed with an existing line-ending notice |
| Local `/login` HTTP request | 200 from the already-running Vite server; not proof of browser/Cognito login |

Existing React Router future-flag and Zod/Rollup annotation notices remain nonblocking.
No backend files or Job Creation API integration were changed. Existing unmerged Git
index entries for App and the backend schema remain; no staging/commit/push was done.
