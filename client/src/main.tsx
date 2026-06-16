import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import "./i18n"; // Initialize i18next (EN/ES/FR)
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import { createRoot } from "react-dom/client";
import React from "react";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

// ─── CSRF TOKEN HELPER ────────────────────────────────────────────────────────
function getCsrfToken(): string | undefined {
  return document.cookie
    .split("; ")
    .find(row => row.startsWith("csrf_token="))
    ?.split("=")[1];
}

// ─── QUERY CLIENT ─────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 401/403
        if (error instanceof TRPCClientError) {
          const code = error.data?.httpStatus;
          if (code === 401 || code === 403) return false;
        }
        return failureCount < 2;
      },
      staleTime: 30_000,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  // v153: Detect account lockout and redirect to /unlock with userId pre-filled
  if (error.message?.includes("Account temporarily locked")) {
    const unlockMatch = error.message.match(/Unlock: (\/unlock\?userId=\d+)/);
    const unlockPath = unlockMatch?.[1] ?? "/unlock";
    if (!window.location.pathname.startsWith("/unlock")) {
      window.location.href = unlockPath;
    }
    return;
  }

  // v214: Public routes that should not trigger login redirect
  const PUBLIC_ROUTES = ['/presentation'];
  if (PUBLIC_ROUTES.some(r => window.location.pathname.startsWith(r))) return;
  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;
  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// ─── TRPC CLIENT ──────────────────────────────────────────────────────────────
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // @ts-ignore - superjson transformer required to deserialize server responses (Dates, BigInt, etc.)
      transformer: superjson,
      fetch(input, init) {
        // CSRF double-submit: read csrf_token cookie and send as X-CSRF-Token header
        const csrfToken = getCsrfToken();
        const headers = new Headers((init as RequestInit)?.headers);
        if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          headers,
        });
      },
    }),
  ],
});

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[RootErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", gap: "1rem" }}>
          <h2 style={{ color: "#ef4444" }}>Something went wrong</h2>
          <p style={{ color: "#6b7280", maxWidth: 400, textAlign: "center" }}>
            {this.state.error?.message || "An unexpected error occurred. Please refresh the page."}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ padding: "0.5rem 1.5rem", background: "#7c3aed", color: "white", border: "none", borderRadius: "0.5rem", cursor: "pointer" }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── CSRF BOOTSTRAP ─────────────────────────────────────────────────────────
// If the csrf_token cookie is missing (first visit), fetch one from the server.
// This ensures mutations work even before the user logs in via dev-login.
(async () => {
  if (!getCsrfToken()) {
    try {
      await fetch("/api/csrf-token", { credentials: "include" });
    } catch {
      // Non-fatal — CSRF middleware allows missing tokens on first visit
    }
  }
})();

// ─── SERVICE WORKER REGISTRATION ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        if (import.meta.env.PROD) setInterval(() => reg.update(), 60_000);
      })
      .catch(() => { /* SW registration failed — silent */ });
  });
}

// ─── ROOT RENDER ──────────────────────────────────────────────────────────────
createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </RootErrorBoundary>
);
