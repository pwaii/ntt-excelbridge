export interface AuthUser {
  readonly subject: string;
  readonly name?: string;
  readonly email?: string;
}

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

// Injection boundary for unit tests; no development/production bypass is provided.
export interface AuthAdapter {
  readonly mode?: "cognito" | "local-development";
  readonly canSignIn: boolean;
  readonly configurationIssues: readonly string[];
  initialize(): Promise<AuthUser | null>;
  login(returnTo: string): Promise<void>;
  logout(): Promise<void>;
  getValidToken(): Promise<string>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  getReturnTo(): string;
}

export class AuthError extends Error {}

export function safeReturnTo(value: unknown): string {
  // Only job routes; no external redirects, callback loops, query data or fragments.
  return typeof value === "string" && /^\/jobs\/(?:new|[^/]+)(?:\/(?:quality-review|transformation-review|result))?$/.test(value)
    && !/[\\?#\r\n]/.test(value) ? value : "/jobs/new";
}
