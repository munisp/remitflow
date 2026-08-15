/**
 * Keycloak JWKS Token Verification
 *
 * Verifies realm access tokens locally against the realm's JSON Web Key Set:
 * RS256 signature + issuer + audience + expiry. This replaces remote
 * introspection (which required admin credentials) with standard OIDC
 * asymmetric verification.
 *
 * The JWKS is fetched from
 *   ${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs
 * and cached by jose's createRemoteJWKSet (with built-in cooldown/refetch on
 * unknown kid, so key rotation is handled).
 *
 * Fails loudly when Keycloak is not configured or the JWKS endpoint is
 * unreachable — callers must treat a thrown error as "token invalid" and
 * never fall back to an unverified allow.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface KeycloakTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  preferred_username?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
  scope?: string;
  [key: string]: unknown;
}

interface JwksConfig {
  issuer: string;
  jwksUrl: URL;
  audience: string;
}

let cachedConfig: JwksConfig | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function resolveConfig(): JwksConfig {
  const url = process.env.KEYCLOAK_URL ?? "";
  if (!url) {
    throw new Error(
      "[KeycloakJWKS] KEYCLOAK_URL is not configured — cannot verify Keycloak access tokens",
    );
  }
  const realm = process.env.KEYCLOAK_REALM ?? "remitflow";
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "remitflow-app";
  const issuer = `${url.replace(/\/$/, "")}/realms/${realm}`;
  return {
    issuer,
    jwksUrl: new URL(`${issuer}/protocol/openid-connect/certs`),
    audience: clientId,
  };
}

function getJwks(): { jwks: ReturnType<typeof createRemoteJWKSet>; config: JwksConfig } {
  const config = resolveConfig();
  if (!cachedJwks || !cachedConfig || cachedConfig.issuer !== config.issuer || cachedConfig.audience !== config.audience) {
    cachedJwks = createRemoteJWKSet(config.jwksUrl);
    cachedConfig = config;
  }
  return { jwks: cachedJwks, config };
}

/**
 * Verify a Keycloak realm access token. Resolves to the decoded claims on
 * success; throws on any signature, issuer, audience or expiry failure.
 *
 * Keycloak issues tokens with `aud` containing the client id (and, depending
 * on realm configuration, "account"), so audience matching accepts the
 * configured client id within a multi-valued aud claim.
 */
export async function verifyKeycloakAccessToken(token: string): Promise<KeycloakTokenClaims> {
  const { jwks, config } = await getJwks();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: config.audience,
  });
  return toClaims(payload);
}

function toClaims(payload: JWTPayload): KeycloakTokenClaims {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("[KeycloakJWKS] Verified token is missing a subject (sub) claim");
  }
  return payload as KeycloakTokenClaims;
}

/** Test/support hook: drop the cached JWKS so the next verification refetches. */
export function resetKeycloakJwksCache(): void {
  cachedJwks = null;
  cachedConfig = null;
}
