/**
 * W10-C1 / SPEC-wave10 — Keycloak OIDC bearer-token verifier.
 *
 * Verifies business-portal bearer tokens (RS256) against the realm JWKS:
 *   1. OIDC discovery: {KEYCLOAK_ISSUER}/.well-known/openid-configuration
 *      → jwks_uri (cached 10 min).
 *   2. JWKS fetch (cached 10 min).
 *   3. RS256 signature verification via node:crypto (createPublicKey from JWK).
 *   4. Claim checks: iss === KEYCLOAK_ISSUER, aud includes KEYCLOAK_CLIENT_ID,
 *      exp not in the past (small leeway for clock skew).
 *
 * Fail closed everywhere:
 *   - KEYCLOAK_ISSUER unset        → verifier throws UNAVAILABLE at use.
 *   - KEYCLOAK_CLIENT_ID unset     → UNAVAILABLE (aud cannot be checked).
 *   - discovery/JWKS fetch failure → UNAVAILABLE (no cached trust anchor).
 *   - any signature/claim failure  → authenticateBearer returns null.
 *
 * `authenticateBearer(token)` maps the verified `sub` claim to a local user
 * (users.openId === sub, or users.openId === `keycloak:${sub}`) and returns
 * the numeric user id, or null when no mapping exists. It NEVER creates
 * users and NEVER returns a user for an unverified token.
 */
import { createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { users } from "../../drizzle/schema.js";
import { logger } from "./logger.js";

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;
const CLOCK_LEEWAY_SECONDS = 30;
const FETCH_TIMEOUT_MS = 5_000;

interface OidcDiscovery {
  jwks_uri?: string;
  issuer?: string;
}

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface CachedEntry<T> {
  value: T;
  expiresAt: number;
}

let discoveryCache: CachedEntry<OidcDiscovery> | null = null;
let jwksCache: CachedEntry<Jwk[]> | null = null;

function unavailable(reason: string): Error {
  return new Error(`UNAVAILABLE: Keycloak OIDC verifier cannot operate — ${reason}`);
}

function issuerUrl(): string {
  const issuer = process.env.KEYCLOAK_ISSUER;
  if (!issuer) throw unavailable("KEYCLOAK_ISSUER is not set");
  return issuer.replace(/\/+$/, "");
}

function requiredAudience(): string {
  const clientId = process.env.KEYCLOAK_CLIENT_ID;
  if (!clientId) throw unavailable("KEYCLOAK_CLIENT_ID is not set — aud claim cannot be verified");
  return clientId;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getDiscovery(): Promise<OidcDiscovery> {
  if (discoveryCache && discoveryCache.expiresAt > Date.now()) return discoveryCache.value;
  const url = `${issuerUrl()}/.well-known/openid-configuration`;
  let doc: OidcDiscovery;
  try {
    doc = (await fetchJson(url)) as OidcDiscovery;
  } catch (err) {
    throw unavailable(`OIDC discovery failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!doc.jwks_uri) throw unavailable("OIDC discovery document has no jwks_uri");
  discoveryCache = { value: doc, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS };
  return doc;
}

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.value;
  const discovery = await getDiscovery();
  let doc: { keys?: Jwk[] };
  try {
    doc = (await fetchJson(discovery.jwks_uri!)) as { keys?: Jwk[] };
  } catch (err) {
    throw unavailable(`JWKS fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(doc.keys) || doc.keys.length === 0) throw unavailable("JWKS document has no keys");
  jwksCache = { value: doc.keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS };
  return doc.keys;
}

function b64urlDecode(segment: string): Buffer {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export interface VerifiedBearerClaims {
  sub: string;
  iss: string;
  aud: string[];
  exp: number;
}

/**
 * Verify an RS256 bearer token against the realm JWKS and check iss/aud/exp.
 * Throws UNAVAILABLE when the trust anchor cannot be established (fail
 * closed); returns null for tokens that simply do not verify.
 */
export async function verifyBearerToken(token: string): Promise<VerifiedBearerClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, signatureSeg] = parts;

  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(headerSeg).toString("utf8"));
    payload = JSON.parse(b64urlDecode(payloadSeg).toString("utf8"));
  } catch {
    return null;
  }

  if (header.alg !== "RS256") {
    logger.warn({ alg: header.alg ?? "none" }, "[KeycloakOidc] rejected token: alg is not RS256");
    return null;
  }

  const keys = await getJwks(); // throws UNAVAILABLE when unfetchable
  const jwk = keys.find((k) => k.kty === "RSA" && k.n && k.e && (!header.kid || k.kid === header.kid));
  if (!jwk) {
    logger.warn({ kid: header.kid ?? "none" }, "[KeycloakOidc] rejected token: no matching JWKS key");
    return null;
  }

  let verified = false;
  try {
    const key = createPublicKey({ key: jwk as never, format: "jwk" });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerSeg}.${payloadSeg}`);
    verifier.end();
    verified = verifier.verify(key, b64urlDecode(signatureSeg));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[KeycloakOidc] signature verification error");
    return null;
  }
  if (!verified) return null;

  // ── Claim checks ──────────────────────────────────────────────────────────
  const expectedIss = issuerUrl();
  const iss = typeof payload.iss === "string" ? payload.iss.replace(/\/+$/, "") : "";
  if (!safeEqual(iss, expectedIss)) {
    logger.warn({ iss, expectedIss }, "[KeycloakOidc] rejected token: iss mismatch");
    return null;
  }

  const expectedAud = requiredAudience();
  const audClaim = payload.aud;
  const audList = Array.isArray(audClaim) ? audClaim.filter((a): a is string => typeof a === "string") : typeof audClaim === "string" ? [audClaim] : [];
  if (!audList.some((a) => safeEqual(a, expectedAud))) {
    logger.warn({ aud: audList }, "[KeycloakOidc] rejected token: aud mismatch");
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp <= 0 || nowSeconds > exp + CLOCK_LEEWAY_SECONDS) {
    logger.warn({ exp, nowSeconds }, "[KeycloakOidc] rejected token: expired or missing exp");
    return null;
  }

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) return null;

  return { sub, iss, aud: audList, exp };
}

/**
 * Authenticate a bearer token to a local user id.
 * Session auth remains primary; this is the alternative path for business-
 * portal API clients. Returns null when the token does not verify or no
 * local user maps to the token subject. Throws UNAVAILABLE when the
 * verifier is not configured (fail closed).
 */
export async function authenticateBearer(token: string): Promise<number | null> {
  if (!token || typeof token !== "string") return null;
  const claims = await verifyBearerToken(token);
  if (!claims) return null;

  const db = await getDb();
  if (!db) throw unavailable("database unavailable — cannot map token subject to a user");

  // sub → user lookup: direct openId match first, then the namespaced form.
  const candidates = [claims.sub, `keycloak:${claims.sub}`];
  for (const openId of candidates) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
    if (row) return row.id;
  }
  logger.warn({ sub: claims.sub }, "[KeycloakOidc] verified token has no local user mapping — access denied");
  return null;
}

/** Test hook: drop cached discovery/JWKS (not used in production paths). */
export function resetKeycloakOidcCacheForTests(): void {
  discoveryCache = null;
  jwksCache = null;
}

export default { authenticateBearer, verifyBearerToken };
