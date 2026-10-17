import { createContext, useContext } from "react";
import type { AuthAdapter, AuthState } from "./types";

export interface AuthContextValue {
  mode?: "cognito" | "local-development";
  canSignIn: boolean;
  state: AuthState;
  configurationIssues: readonly string[];
  login(returnTo?: string): Promise<void>;
  logout(): Promise<void>;
  getValidToken(): Promise<string>;
  getReturnTo: AuthAdapter["getReturnTo"];
}

export const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is required.");
  return value;
}
