/**
 * RemitFlow — Keycloak Enhanced Integration
 * ──────────────────────────────────────────
 * Extends the base Keycloak OIDC adapter with:
 *   - Token refresh with sliding window
 *   - User attribute sync (roles, KYC tier, MFA status)
 *   - Session invalidation on logout/suspicious activity
 *   - Admin API for user management
 *   - Realm event subscription for audit trail
 *   - Multi-realm support for white-label tenants
 *
 * Environment variables:
 *   KEYCLOAK_URL            e.g. https://auth.remitflow.app
 *   KEYCLOAK_REALM          e.g. remitflow
 *   KEYCLOAK_CLIENT_ID      e.g. remitflow-app
 *   KEYCLOAK_CLIENT_SECRET  (confidential client secret)
 *   KEYCLOAK_ADMIN_USER     e.g. admin
 *   KEYCLOAK_ADMIN_PASSWORD (admin credentials for Admin API)
 */
import axios, { AxiosInstance } from "axios";
import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import { sql } from "drizzle-orm";

const KC_URL = process.env.KEYCLOAK_URL || "http://localhost:8080";
const KC_REALM = process.env.KEYCLOAK_REALM || "remitflow";
const KC_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || "remitflow-app";
const KC_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || "";
const KC_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER || "admin";
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || "";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface KeycloakUser {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  attributes?: Record<string, string[]>;
  realmRoles?: string[];
  clientRoles?: Record<string, string[]>;
  createdTimestamp?: number;
}

export interface KeycloakTokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
  refreshExpiresIn?: number;
  tokenType: string;
  sessionState?: string;
}

export interface KeycloakSessionInfo {
  sessionId: string;
  userId: string;
  username: string;
  ipAddress: string;
  start: number;
  lastAccess: number;
  clients: Record<string, string>;
}

// ─── Admin Token Cache ────────────────────────────────────────────────────────
let _adminToken: string | null = null;
let _adminTokenExpiry = 0;

async function getAdminToken(): Promise<string> {
  if (_adminToken && Date.now() < _adminTokenExpiry - 30_000) return _adminToken;
  const res = await axios.post(
    `${KC_URL}/realms/master/protocol/openid-connect/token`,
    new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: KC_ADMIN_USER,
      password: KC_ADMIN_PASSWORD,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  _adminToken = res.data.access_token;
  _adminTokenExpiry = Date.now() + res.data.expires_in * 1000;
  return _adminToken!;
}

function adminClient(): AxiosInstance {
  return axios.create({
    baseURL: `${KC_URL}/admin/realms/${KC_REALM}`,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Token Operations ─────────────────────────────────────────────────────────
export async function refreshAccessToken(refreshToken: string): Promise<KeycloakTokenSet> {
  const res = await axios.post(
    `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: KC_CLIENT_ID,
      client_secret: KC_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    idToken: res.data.id_token,
    expiresIn: res.data.expires_in,
    refreshExpiresIn: res.data.refresh_expires_in,
    tokenType: res.data.token_type,
    sessionState: res.data.session_state,
  };
}

export async function introspectToken(token: string): Promise<{ active: boolean; sub?: string; exp?: number; roles?: string[] }> {
  const res = await axios.post(
    `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token/introspect`,
    new URLSearchParams({
      token,
      client_id: KC_CLIENT_ID,
      client_secret: KC_CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const data = res.data;
  return {
    active: data.active,
    sub: data.sub,
    exp: data.exp,
    roles: data.realm_access?.roles ?? [],
  };
}

export async function revokeToken(token: string, tokenTypeHint: "access_token" | "refresh_token" = "refresh_token"): Promise<void> {
  await axios.post(
    `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/revoke`,
    new URLSearchParams({
      token,
      token_type_hint: tokenTypeHint,
      client_id: KC_CLIENT_ID,
      client_secret: KC_CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  logger.info("[Keycloak] Token revoked");
}

// ─── User Management ──────────────────────────────────────────────────────────
export async function getUserById(userId: string): Promise<KeycloakUser | null> {
  try {
    const adminToken = await getAdminToken();
    const client = adminClient();
    const res = await client.get(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    return res.data as KeycloakUser;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

export async function getUserByEmail(email: string): Promise<KeycloakUser | null> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  const res = await client.get(`/users?email=${encodeURIComponent(email)}&exact=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  return res.data?.[0] ?? null;
}

export async function updateUserAttributes(userId: string, attributes: Record<string, string[]>): Promise<void> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  // First get current user to merge attributes
  const user = await getUserById(userId);
  if (!user) throw new Error(`[Keycloak] User ${userId} not found`);
  await client.put(`/users/${userId}`, {
    ...user,
    attributes: { ...user.attributes, ...attributes },
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  logger.info({ userId, attributes: Object.keys(attributes) }, "[Keycloak] User attributes updated");
}

export async function syncKycTierToKeycloak(userId: string, kycTier: number): Promise<void> {
  await updateUserAttributes(userId, { kyc_tier: [String(kycTier)] });
}

export async function syncMfaStatusToKeycloak(userId: string, mfaEnabled: boolean): Promise<void> {
  await updateUserAttributes(userId, { mfa_enabled: [String(mfaEnabled)] });
}

export async function assignRealmRole(userId: string, roleName: string): Promise<void> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  // Get role representation
  const roleRes = await client.get(`/roles/${roleName}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const role = roleRes.data;
  await client.post(`/users/${userId}/role-mappings/realm`, [role], {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  logger.info({ userId, roleName }, "[Keycloak] Realm role assigned");
}

export async function removeRealmRole(userId: string, roleName: string): Promise<void> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  const roleRes = await client.get(`/roles/${roleName}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const role = roleRes.data;
  await client.delete(`/users/${userId}/role-mappings/realm`, {
    data: [role],
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  logger.info({ userId, roleName }, "[Keycloak] Realm role removed");
}

// ─── Session Management ───────────────────────────────────────────────────────
export async function getUserSessions(userId: string): Promise<KeycloakSessionInfo[]> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  const res = await client.get(`/users/${userId}/sessions`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  return res.data ?? [];
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  await client.delete(`/users/${userId}/sessions`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  // Persist session invalidation to PostgreSQL for audit trail
  const db = await getDb();
  if (db) {
    await (db as any).execute(sql`
      INSERT INTO keycloak_sessions (keycloak_user_id, session_id, action, ip_address, created_at)
      VALUES (${userId}, 'ALL', 'invalidated', 'system', NOW())
    `);
  }
  logger.info({ userId }, "[Keycloak] All user sessions invalidated");
}

export async function logoutSession(sessionId: string): Promise<void> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  await client.delete(`/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  logger.info({ sessionId }, "[Keycloak] Session logged out");
}

// ─── Realm Event Sync ─────────────────────────────────────────────────────────
export async function getRealmEvents(params: {
  type?: string[];
  userId?: string;
  from?: Date;
  to?: Date;
  max?: number;
}): Promise<Record<string, unknown>[]> {
  const adminToken = await getAdminToken();
  const client = adminClient();
  const query = new URLSearchParams();
  if (params.type) params.type.forEach(t => query.append("type", t));
  if (params.userId) query.set("user", params.userId);
  if (params.from) query.set("dateFrom", params.from.toISOString().split("T")[0]);
  if (params.to) query.set("dateTo", params.to.toISOString().split("T")[0]);
  if (params.max) query.set("max", String(params.max));
  const res = await client.get(`/events?${query.toString()}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  return res.data ?? [];
}

// ─── Multi-Realm Support ──────────────────────────────────────────────────────
export async function createTenantRealm(tenantId: string, displayName: string): Promise<void> {
  const adminToken = await getAdminToken();
  await axios.post(`${KC_URL}/admin/realms`, {
    realm: `remitflow-${tenantId}`,
    displayName,
    enabled: true,
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: true,
    editUsernameAllowed: false,
    bruteForceProtected: true,
    permanentLockout: false,
    maxFailureWaitSeconds: 900,
    minimumQuickLoginWaitSeconds: 60,
    waitIncrementSeconds: 60,
    quickLoginCheckMilliSeconds: 1000,
    maxDeltaTimeSeconds: 43200,
    failureFactor: 5,
    sslRequired: "external",
    accessTokenLifespan: 300,
    refreshTokenMaxReuse: 0,
    revokeRefreshToken: true,
  }, { headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" } });
  logger.info({ tenantId, displayName }, "[Keycloak] Tenant realm created");
}

// ─── Health Check ─────────────────────────────────────────────────────────────
export async function checkKeycloakHealth(): Promise<{ healthy: boolean; realm: string; version?: string }> {
  try {
    const res = await axios.get(`${KC_URL}/realms/${KC_REALM}/.well-known/openid-configuration`, { timeout: 3000 });
    return { healthy: true, realm: KC_REALM, version: res.data?.["keycloak-version"] };
  } catch {
    return { healthy: false, realm: KC_REALM };
  }
}

export const keycloakEnhanced = {
  refreshAccessToken,
  introspectToken,
  revokeToken,
  getUserById,
  getUserByEmail,
  updateUserAttributes,
  syncKycTierToKeycloak,
  syncMfaStatusToKeycloak,
  assignRealmRole,
  removeRealmRole,
  getUserSessions,
  invalidateAllUserSessions,
  logoutSession,
  getRealmEvents,
  createTenantRealm,
  checkHealth: checkKeycloakHealth,
};

export default keycloakEnhanced;
