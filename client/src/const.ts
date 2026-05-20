export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Build the login URL at runtime.
 *
 * Priority:
 *  1. Keycloak OIDC  — when VITE_KEYCLOAK_URL is set
 *  2. Dev-login bypass — when running in development (no Keycloak configured)
 *  3. Manus OAuth fallback — legacy
 */
export const getLoginUrl = (returnPath?: string) => {
  const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL as string | undefined;
  const keycloakRealm =
    (import.meta.env.VITE_KEYCLOAK_REALM as string | undefined) ?? "remitflow";
  const keycloakClientId =
    (import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string | undefined) ??
    "remitflow-app";

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  if (keycloakUrl) {
    // ── Keycloak OIDC authorization endpoint ──────────────────────────────
    const authUrl = new URL(
      `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/auth`
    );
    authUrl.searchParams.set("client_id", keycloakClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    return authUrl.toString();
  }

  // ── Dev-login bypass (sandbox / no Keycloak configured) ─────────────────
  // The server exposes /api/dev-login only in non-production mode.
  if (import.meta.env.DEV) {
    const returnTo = returnPath ?? "/dashboard";
    return `/api/dev-login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  // ── Legacy Manus OAuth fallback ─────────────────────────────────────────
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL as string;
  const appId = import.meta.env.VITE_APP_ID as string;
  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");
  return url.toString();
};
