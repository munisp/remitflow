/**
 * Keycloak OIDC Adapter
 *
 * Replaces the Manus OAuth provider with a standard Keycloak OIDC flow.
 * All session management (JWT signing/verification) is handled by the existing
 * sdk.ts infrastructure — only the code-exchange and userinfo steps change.
 *
 * Environment variables required:
 *   KEYCLOAK_URL        e.g. https://auth.remitflow.app
 *   KEYCLOAK_REALM      e.g. remitflow
 *   KEYCLOAK_CLIENT_ID  e.g. remitflow-app
 *   KEYCLOAK_CLIENT_SECRET  (optional, for confidential clients)
 */

import axios from "axios";
import crypto from "crypto";

export interface KeycloakConfig {
  url: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}

export interface KeycloakTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface KeycloakUserInfo {
  sub: string;           // Keycloak subject (openId equivalent)
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
}

function getKeycloakConfig(): KeycloakConfig {
  const url = process.env.KEYCLOAK_URL ?? "";
  const realm = process.env.KEYCLOAK_REALM ?? "remitflow";
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "remitflow-app";
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  return { url, realm, clientId, clientSecret };
}

function getBaseUrl(cfg: KeycloakConfig): string {
  return `${cfg.url}/realms/${cfg.realm}/protocol/openid-connect`;
}

/**
 * Build the Keycloak authorization URL (replaces getLoginUrl on the server).
 * The frontend uses the VITE_KEYCLOAK_* env vars directly.
 */
export function buildKeycloakAuthUrl(redirectUri: string, state: string): string {
  const cfg = getKeycloakConfig();
  const base = getBaseUrl(cfg);
  const url = new URL(`${base}/auth`);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchange an authorization code for tokens via Keycloak.
 */
export async function exchangeKeycloakCode(
  code: string,
  redirectUri: string
): Promise<KeycloakTokenResponse> {
  const cfg = getKeycloakConfig();
  const tokenUrl = `${getBaseUrl(cfg)}/token`;

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    code,
    redirect_uri: redirectUri,
  });
  if (cfg.clientSecret) {
    params.set("client_secret", cfg.clientSecret);
  }

  const { data } = await axios.post<KeycloakTokenResponse>(
    tokenUrl,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10_000 }
  );
  return data;
}

/**
 * Fetch user info from Keycloak using an access token.
 */
export async function getKeycloakUserInfo(
  accessToken: string
): Promise<KeycloakUserInfo> {
  const cfg = getKeycloakConfig();
  const userinfoUrl = `${getBaseUrl(cfg)}/userinfo`;
  const { data } = await axios.get<KeycloakUserInfo>(userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10_000,
  });
  return data;
}

/**
 * Generate a PKCE code verifier and challenge (for public clients).
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * Check if Keycloak is configured (has a URL set).
 */
export function isKeycloakConfigured(): boolean {
  return Boolean(process.env.KEYCLOAK_URL);
}
