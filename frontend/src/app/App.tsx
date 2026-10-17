import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "@/routes";
import { AuthProvider } from "@/auth/auth-provider";
import { browserAuthAdapter } from "@/auth/browser-adapter";

// Preserve the Day 1 router and add authentication around its existing pages.
// The separate legacy upload feature/API client remains inactive.
export function App() {
  return <BrowserRouter><AuthProvider adapter={browserAuthAdapter}><AppRoutes /></AuthProvider></BrowserRouter>;
}
