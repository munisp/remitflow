/**
 * vaultClient.ts — HashiCorp Vault Integration
 *
 * Provides secure secrets management for production:
 *   - Dynamic secrets rotation (DB credentials, API keys)
 *   - Transit encryption (encrypt/decrypt sensitive fields)
 *   - Secret leasing with automatic renewal
 *   - Fallback to environment variables when Vault is unavailable
 *
 * In production: Vault is the single source of truth for secrets.
 * In development: Falls back to process.env (no Vault required).
 *
 * Auth methods supported:
 *   - Token (VAULT_TOKEN env var)
 *   - Kubernetes service account (auto-detected in K8s)
 *   - AppRole (VAULT_ROLE_ID + VAULT_SECRET_ID)
 */

import { logger } from "../_core/logger";

// ── Config ──────────────────────────────────────────────────────────────────

const VAULT_ADDR = process.env.VAULT_ADDR || "http://localhost:8200";
const VAULT_TOKEN = process.env.VAULT_TOKEN || "";
const VAULT_ROLE_ID = process.env.VAULT_ROLE_ID || "";
const VAULT_SECRET_ID = process.env.VAULT_SECRET_ID || "";
const VAULT_NAMESPACE = process.env.VAULT_NAMESPACE || "";
const SECRET_PATH_PREFIX = process.env.VAULT_SECRET_PATH || "secret/data/remitflow";

// ── Types ───────────────────────────────────────────────────────────────────

interface VaultSecret {
  data: Record<string, string>;
  metadata: {
    created_time: string;
    version: number;
    destroyed: boolean;
  };
}

interface VaultResponse<T> {
  data: T;
  lease_id?: string;
  lease_duration?: number;
  renewable?: boolean;
}

interface VaultTokenAuth {
  client_token: string;
  accessor: string;
  policies: string[];
  token_policies: string[];
  lease_duration: number;
  renewable: boolean;
}

// ── State ───────────────────────────────────────────────────────────────────

let activeToken: string = VAULT_TOKEN;
let tokenExpiry: number = 0;
let renewalTimer: ReturnType<typeof setInterval> | null = null;
const secretCache = new Map<string, { value: Record<string, string>; expiresAt: number }>();
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Authentication ──────────────────────────────────────────────────────────

async function authenticate(): Promise<string> {
  // 1. If token is already set and valid, use it
  if (activeToken && (tokenExpiry === 0 || Date.now() < tokenExpiry)) {
    return activeToken;
  }

  // 2. Try Kubernetes auth (auto-detected in K8s pods)
  const k8sTokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token";
  try {
    const fs = await import("fs");
    if (fs.existsSync(k8sTokenPath)) {
      const jwt = fs.readFileSync(k8sTokenPath, "utf-8").trim();
      const res = await vaultRequest<{ auth: VaultTokenAuth }>("POST", "/v1/auth/kubernetes/login", {
        jwt,
        role: "remitflow",
      }, true);
      activeToken = res.auth.client_token;
      tokenExpiry = Date.now() + (res.auth.lease_duration * 1000);
      scheduleRenewal(res.auth.lease_duration);
      logger.info("[Vault] Authenticated via Kubernetes service account");
      return activeToken;
    }
  } catch {
    // Not in K8s, try next method
  }

  // 3. Try AppRole auth
  if (VAULT_ROLE_ID && VAULT_SECRET_ID) {
    const res = await vaultRequest<{ auth: VaultTokenAuth }>("POST", "/v1/auth/approle/login", {
      role_id: VAULT_ROLE_ID,
      secret_id: VAULT_SECRET_ID,
    }, true);
    activeToken = res.auth.client_token;
    tokenExpiry = Date.now() + (res.auth.lease_duration * 1000);
    scheduleRenewal(res.auth.lease_duration);
    logger.info("[Vault] Authenticated via AppRole");
    return activeToken;
  }

  // 4. Fall back to token from env
  if (VAULT_TOKEN) {
    activeToken = VAULT_TOKEN;
    return activeToken;
  }

  throw new Error("Vault: No authentication method available");
}

function scheduleRenewal(leaseDurationSec: number): void {
  if (renewalTimer) clearInterval(renewalTimer);
  // Renew at 75% of lease duration
  const renewalInterval = Math.max(leaseDurationSec * 750, 30000);
  renewalTimer = setInterval(async () => {
    try {
      await vaultRequest("POST", "/v1/auth/token/renew-self", {});
      logger.debug("[Vault] Token renewed");
    } catch (err) {
      logger.warn({ err }, "[Vault] Token renewal failed — re-authenticating");
      activeToken = "";
      await authenticate().catch(() => {});
    }
  }, renewalInterval);
}

// ── HTTP Client ─────────────────────────────────────────────────────────────

async function vaultRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  skipAuth: boolean = false,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!skipAuth) {
    const token = await authenticate();
    headers["X-Vault-Token"] = token;
  }
  if (VAULT_NAMESPACE) {
    headers["X-Vault-Namespace"] = VAULT_NAMESPACE;
  }

  const response = await fetch(`${VAULT_ADDR}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vault API ${response.status}: ${errorText}`);
  }

  return (await response.json()) as T;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a secret from Vault KV v2 engine.
 * Falls back to process.env in development.
 */
export async function getSecret(key: string, envFallback?: string): Promise<string> {
  // In development without Vault, use env vars
  if (!VAULT_TOKEN && !VAULT_ROLE_ID && process.env.NODE_ENV !== "production") {
    return process.env[key] || envFallback || "";
  }

  // Check cache
  const cached = secretCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value[key] || "";
  }

  try {
    const res = await vaultRequest<VaultResponse<VaultSecret>>("GET", `${SECRET_PATH_PREFIX}/${key}`);
    const secretData = res.data.data;
    secretCache.set(key, { value: secretData, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
    return secretData[key] || secretData.value || "";
  } catch (err) {
    logger.warn({ err, key }, "[Vault] Failed to fetch secret — using env fallback");
    return process.env[key] || envFallback || "";
  }
}

/**
 * Get all secrets under a path (e.g., "api-keys" returns all API keys).
 */
export async function getSecrets(path: string): Promise<Record<string, string>> {
  if (!VAULT_TOKEN && !VAULT_ROLE_ID && process.env.NODE_ENV !== "production") {
    return {};
  }

  try {
    const res = await vaultRequest<VaultResponse<VaultSecret>>("GET", `${SECRET_PATH_PREFIX}/${path}`);
    return res.data.data;
  } catch (err) {
    logger.warn({ err, path }, "[Vault] Failed to fetch secrets");
    return {};
  }
}

/**
 * Encrypt a value using Vault Transit engine.
 * Used for PII fields (SSN, bank account numbers, passport numbers).
 */
export async function transitEncrypt(plaintext: string, keyName: string = "remitflow-pii"): Promise<string> {
  if (!activeToken && process.env.NODE_ENV !== "production") {
    // In dev mode, return base64-encoded value (not secure, but functional)
    return `dev:${Buffer.from(plaintext).toString("base64")}`;
  }

  try {
    const res = await vaultRequest<{ data: { ciphertext: string } }>(
      "POST",
      `/v1/transit/encrypt/${keyName}`,
      { plaintext: Buffer.from(plaintext).toString("base64") },
    );
    return res.data.ciphertext;
  } catch (err) {
    logger.error({ err, keyName }, "[Vault] Transit encryption failed");
    throw new Error("Encryption service unavailable");
  }
}

/**
 * Decrypt a value using Vault Transit engine.
 */
export async function transitDecrypt(ciphertext: string, keyName: string = "remitflow-pii"): Promise<string> {
  // Dev mode passthrough
  if (ciphertext.startsWith("dev:")) {
    return Buffer.from(ciphertext.slice(4), "base64").toString("utf-8");
  }

  try {
    const res = await vaultRequest<{ data: { plaintext: string } }>(
      "POST",
      `/v1/transit/decrypt/${keyName}`,
      { ciphertext },
    );
    return Buffer.from(res.data.plaintext, "base64").toString("utf-8");
  } catch (err) {
    logger.error({ err, keyName }, "[Vault] Transit decryption failed");
    throw new Error("Decryption service unavailable");
  }
}

/**
 * Get dynamic database credentials from Vault.
 * These are short-lived and auto-rotated.
 */
export async function getDatabaseCredentials(role: string = "remitflow-app"): Promise<{
  username: string;
  password: string;
  ttl: number;
}> {
  if (process.env.NODE_ENV !== "production") {
    return {
      username: process.env.PGUSER || "remitflow",
      password: process.env.PGPASSWORD || "remitflow123",
      ttl: 3600,
    };
  }

  try {
    const res = await vaultRequest<VaultResponse<{ username: string; password: string }>>(
      "GET",
      `/v1/database/creds/${role}`,
    );
    return {
      username: res.data.username,
      password: res.data.password,
      ttl: res.lease_duration || 3600,
    };
  } catch (err) {
    logger.error({ err, role }, "[Vault] Failed to get database credentials");
    throw new Error("Database credentials unavailable from Vault");
  }
}

/**
 * Check Vault connectivity and auth status.
 */
export async function healthCheck(): Promise<{
  available: boolean;
  authenticated: boolean;
  tokenTTL: number;
}> {
  try {
    const res = await fetch(`${VAULT_ADDR}/v1/sys/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const authenticated = !!activeToken;
    return {
      available: res.ok,
      authenticated,
      tokenTTL: tokenExpiry > 0 ? Math.max(0, tokenExpiry - Date.now()) : -1,
    };
  } catch {
    return { available: false, authenticated: false, tokenTTL: 0 };
  }
}

/**
 * Initialize Vault with RemitFlow secrets layout.
 * Run once during initial setup (ops/vault-init.sh calls this via API).
 */
export async function initializeSecretPaths(): Promise<void> {
  const paths = [
    "api-keys",       // External API keys (Circle, Onfido, OFAC, etc.)
    "database",       // Database credentials
    "encryption",     // Transit encryption keys
    "webhooks",       // Webhook signing secrets
    "oauth",          // OAuth client secrets
    "blockchain",     // Private keys for blockchain signing
  ];

  for (const path of paths) {
    try {
      await vaultRequest("POST", `${SECRET_PATH_PREFIX}/${path}`, {
        data: { _initialized: "true", _created_at: new Date().toISOString() },
      });
    } catch {
      // Path may already exist
    }
  }

  logger.info("[Vault] Secret paths initialized");
}
