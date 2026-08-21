/**
 * RemitFlow — Unified Middleware Integration Layer
 *
 * Full production integration with:
 *   - Redis: Caching, rate limiting, session store, pub/sub
 *   - OpenSearch: Full-text search, analytics, log aggregation
 *   - Keycloak: SSO, OIDC, RBAC, realm management
 *   - Permify: Fine-grained authorization (ABAC/ReBAC)
 *   - Dapr: Service invocation, state store, pub/sub, secrets
 *   - APISIX: API gateway, route management, plugin config
 *   - TigerBeetle: Double-entry financial ledger
 *   - Fluvio: Real-time event streaming
 *   - Lakehouse: Data warehouse analytics (Delta/Iceberg)
 *   - OpenAppSec: WAF, bot protection, API security
 *   - Mojaloop: Financial interoperability
 *
 * Each integration uses real client libraries with circuit breaker + retry.
 */
import { logger } from "../_core/logger.js";
import { verifyKeycloakAccessToken } from "../lib/keycloak-jwks.js";
import { randomUUID } from "crypto";

// ─── Config ───────────────────────────────────────────────────────────────────
/**
 * Integration credentials and endpoints are deployment configuration, never
 * application defaults. Failing at startup prevents a financial service from
 * silently targeting localhost, sample credentials, or a mock dependency.
 */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required integration configuration: ${name}`);
  return value;
}

function requiredNumberEnv(name: string): number {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value)) throw new Error(`Integration configuration ${name} must be numeric`);
  return value;
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/**
 * Keycloak client redirect URIs / web origins must never be wildcard ("*").
 * Configure KEYCLOAK_CLIENT_REDIRECT_URIS (comma-separated) and APP_URL.
 * When unset we derive them from APP_URL and warn loudly; if APP_URL is also
 * unset we provision the client with no redirect URIs (safe default) and warn.
 */
function resolveKeycloakRedirectUris(): string[] {
  const configured = optionalEnv("KEYCLOAK_CLIENT_REDIRECT_URIS")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && u !== "*");
  if (configured.length > 0) return configured;
  const appUrl = optionalEnv("APP_URL").replace(/\/+$/, "");
  if (appUrl) {
    logger.warn(
      "[Keycloak] KEYCLOAK_CLIENT_REDIRECT_URIS not set; deriving redirect URIs from APP_URL",
    );
    return [`${appUrl}/*`];
  }
  logger.warn(
    "[Keycloak] KEYCLOAK_CLIENT_REDIRECT_URIS and APP_URL are both unset; " +
      "provisioning client with NO redirect URIs (authentication redirects will fail until configured)",
  );
  return [];
}

function resolveKeycloakWebOrigins(): string[] {
  const appUrl = optionalEnv("APP_URL").replace(/\/+$/, "");
  if (appUrl) return [appUrl];
  logger.warn(
    "[Keycloak] APP_URL is unset; provisioning client with NO web origins " +
      "(CORS from the browser will fail until APP_URL is configured)",
  );
  return [];
}

const CONFIG = {
  redis: {
    url: requiredEnv("REDIS_URL"),
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB ?? "0"),
    keyPrefix: "rf:",
    maxRetries: 3,
    retryDelayMs: 1000,
  },
  openSearch: {
    node: requiredEnv("OPENSEARCH_URL"),
    auth: { username: requiredEnv("OPENSEARCH_USER"), password: requiredEnv("OPENSEARCH_PASSWORD") },
    ssl: { rejectUnauthorized: process.env.NODE_ENV === "production" },
  },
  keycloak: {
    baseUrl: requiredEnv("KEYCLOAK_URL"),
    realm: requiredEnv("KEYCLOAK_REALM"),
    clientId: requiredEnv("KEYCLOAK_CLIENT_ID"),
    clientSecret: requiredEnv("KEYCLOAK_CLIENT_SECRET"),
    adminUser: requiredEnv("KEYCLOAK_ADMIN"),
    adminPassword: requiredEnv("KEYCLOAK_ADMIN_PASSWORD"),
  },
  permify: {
    endpoint: requiredEnv("PERMIFY_ENDPOINT"),
    tenantId: requiredEnv("PERMIFY_TENANT_ID"),
  },
  dapr: {
    host: requiredEnv("DAPR_HOST"),
    httpPort: requiredNumberEnv("DAPR_HTTP_PORT"),
    grpcPort: requiredNumberEnv("DAPR_GRPC_PORT"),
    appId: requiredEnv("DAPR_APP_ID"),
    stateStore: requiredEnv("DAPR_STATE_STORE"),
    pubsub: requiredEnv("DAPR_PUBSUB"),
    secretStore: requiredEnv("DAPR_SECRET_STORE"),
  },
  apisix: {
    adminUrl: requiredEnv("APISIX_ADMIN_URL"),
    adminKey: requiredEnv("APISIX_ADMIN_KEY"),
    gatewayUrl: requiredEnv("APISIX_GATEWAY_URL"),
    apiUpstream: requiredEnv("APISIX_UPSTREAM_API"),
    lakehouseUpstream: requiredEnv("APISIX_UPSTREAM_LAKEHOUSE"),
  },
  tigerBeetle: {
    addresses: requiredEnv("TIGERBEETLE_ADDRESSES").split(","),
    clusterId: requiredNumberEnv("TIGERBEETLE_CLUSTER_ID"),
  },
  fluvio: {
    endpoint: requiredEnv("FLUVIO_ENDPOINT"),
    profileName: requiredEnv("FLUVIO_PROFILE"),
  },
  lakehouse: {
    url: requiredEnv("LAKEHOUSE_URL"),
    catalog: requiredEnv("LAKEHOUSE_CATALOG"),
    warehouse: requiredEnv("LAKEHOUSE_WAREHOUSE"),
  },
  openAppSec: {
    mgmtUrl: requiredEnv("OPENAPPSEC_MGMT_URL"),
    token: process.env.OPENAPPSEC_TOKEN ?? "",
  },
  // Mojaloop is not a required component of the selected deployment profile;
  // methods throw explicitly when a caller attempts to use it without config.
  mojaloop: {
    hubUrl: optionalEnv("MOJALOOP_HUB_URL"),
    fspId: optionalEnv("MOJALOOP_FSP_ID"),
    ilpSecret: optionalEnv("MOJALOOP_ILP_SECRET"),
  },
};

// ─── Redis Integration ────────────────────────────────────────────────────────
interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setEx(key: string, ttl: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  hSet(key: string, field: string, value: string): Promise<unknown>;
  hGetAll(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  publish?(channel: string, message: string): Promise<unknown>;
  subscribe?(channel: string, listener: (message: string) => void): Promise<unknown>;
  pSubscribe?(pattern: string, listener: (message: string, channel: string) => void): Promise<unknown>;
}

export class RedisIntegration {
