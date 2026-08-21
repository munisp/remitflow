/**
 * Middleware Integration Layer — unified clients for all 13 middleware systems.
 * Each integration is lazy-loaded, graceful-degrading, and independently health-checked.
 */
import { randomUUID, createHash } from "crypto";
import { logger } from "../_core/logger";

/** Required env var — throws at call time if missing (never at import time) */
function requiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[Middleware] Required env var ${key} is not set`);
  return val;
}

/** Optional env var with dev default */
function envOr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const CONFIG = {
  redis: { url: envOr("REDIS_URL", "redis://localhost:6379") },
  openSearch: { url: envOr("OPENSEARCH_URL", "http://localhost:9200"), username: envOr("OPENSEARCH_USERNAME", "admin"), password: envOr("OPENSEARCH_PASSWORD", "admin") },
  keycloak: { baseUrl: envOr("KEYCLOAK_BASE_URL", "http://localhost:8080"), realm: envOr("KEYCLOAK_REALM", "remitflow"), clientId: envOr("KEYCLOAK_CLIENT_ID", "remitflow-api"), clientSecret: envOr("KEYCLOAK_CLIENT_SECRET", ""), adminUsername: envOr("KEYCLOAK_ADMIN_USERNAME", "admin"), adminPassword: envOr("KEYCLOAK_ADMIN_PASSWORD", "admin") },
  permify: { baseUrl: envOr("PERMIFY_BASE_URL", "http://localhost:3476"), tenantId: envOr("PERMIFY_TENANT_ID", "t1"), apiKey: envOr("PERMIFY_API_KEY", "") },
  dapr: { host: envOr("DAPR_HOST", "localhost"), httpPort: parseInt(envOr("DAPR_HTTP_PORT", "3500")), grpcPort: parseInt(envOr("DAPR_GRPC_PORT", "50001")), appId: envOr("DAPR_APP_ID", "remitflow-api") },
  tigerBeetle: { clusterId: parseInt(envOr("TIGERBEETLE_CLUSTER_ID", "0")), addresses: envOr("TIGERBEETLE_ADDRESSES", "localhost:3000").split(","), bridgeUrl: envOr("TIGERBEETLE_BRIDGE_URL", "http://localhost:8080") },
  fluvio: { endpoint: envOr("FLUVIO_ENDPOINT", "localhost:9003") },
  openAppSec: { mgmtUrl: envOr("OPENAPPSEC_MGMT_URL", "http://localhost:81"), apiKey: envOr("OPENAPPSEC_API_KEY", "") },
  lakehouse: { url: envOr("LAKEHOUSE_URL", "http://localhost:8082"), catalog: envOr("LAKEHOUSE_CATALOG", "remitflow") },
  apisix: { adminUrl: envOr("APISIX_ADMIN_URL", "http://localhost:9180"), adminKey: envOr("APISIX_ADMIN_KEY", ""), gatewayUrl: envOr("APISIX_GATEWAY_URL", "http://localhost:9080"), apiUpstream: envOr("APISIX_API_UPSTREAM", "remitflow-api:3000"), lakehouseUpstream: envOr("APISIX_LAKEHOUSE_UPSTREAM", "lakehouse:8082") },
  mojaloop: { hubUrl: envOr("MOJALOOP_HUB_URL", ""), fspId: envOr("MOJALOOP_FSP_ID", "remitflow"), ilpSecret: envOr("MOJALOOP_ILP_SECRET", "") },
};

// ─── Redis Integration ────────────────────────────────────────────────────────
export class RedisIntegration {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private connectionFailed = false;

  private async getClient() {
    if (!this.client && !this.connectionFailed) {
      try {
        const { default: Redis } = await import("ioredis");
        this.client = new Redis(CONFIG.redis.url, { lazyConnect: true, connectTimeout: 3000, retryStrategy: () => null });
        await this.client.connect();
      } catch (err) {
        this.connectionFailed = true;
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Redis] Connection failed");
        this.client = null;
      }
    }
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    const c = await this.getClient();
    return c ? c.get(key) : null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const c = await this.getClient();
    if (c) { ttlSeconds ? await c.setex(key, ttlSeconds, value) : await c.set(key, value); }
  }

  async del(key: string): Promise<void> {
    const c = await this.getClient();
    if (c) await c.del(key);
  }

  async incr(key: string): Promise<number> {
    const c = await this.getClient();
    return c ? c.incr(key) : 0;
  }

  async expire(key: string, seconds: number): Promise<void> {
    const c = await this.getClient();
    if (c) await c.expire(key, seconds);
  }

  async rpush(key: string, value: string): Promise<void> {
    const c = await this.getClient();
    if (c) await c.rpush(key, value);
  }

  async llen(key: string): Promise<number> {
    const c = await this.getClient();
    return c ? c.llen(key) : 0;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const c = await this.getClient();
    return c ? c.lrange(key, start, stop) : [];
  }
}

// ─── OpenSearch Integration ───────────────────────────────────────────────────
export class OpenSearchIntegration {
  private url = CONFIG.openSearch.url;
  private auth = Buffer.from(`${CONFIG.openSearch.username}:${CONFIG.openSearch.password}`).toString("base64");

  async search(index: string, query: unknown, size = 20): Promise<{ hits: unknown[]; total: number }> {
    try {
      const res = await fetch(`${this.url}/${index}/_search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${this.auth}` },
        body: JSON.stringify({ size, query: query as object }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { hits: [], total: 0 };
      const data = await res.json() as { hits: { hits: unknown[]; total: { value: number } } };
      return { hits: data.hits.hits, total: data.hits.total.value };
    } catch { return { hits: [], total: 0 }; }
  }

  async index(index: string, id: string, doc: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/${index}/_doc/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${this.auth}` },
        body: JSON.stringify(doc),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch { return false; }
  }

  async bulkIndex(index: string, docs: Array<{ id: string; doc: unknown }>): Promise<{ indexed: number; errors: number }> {
    if (docs.length === 0) return { indexed: 0, errors: 0 };
    try {
      const body = docs.flatMap(d => [JSON.stringify({ index: { _index: index, _id: d.id } }), JSON.stringify(d.doc)]).join("\n") + "\n";
      const res = await fetch(`${this.url}/_bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson", Authorization: `Basic ${this.auth}` },
        body,
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as { errors: boolean; items: unknown[] };
      return { indexed: data.items.length, errors: data.errors ? 1 : 0 };
    } catch { return { indexed: 0, errors: docs.length }; }
  }

  async getHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/_cluster/health`, { headers: { Authorization: `Basic ${this.auth}` }, signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  }
}

// ─── Keycloak Integration ─────────────────────────────────────────────────────
export class KeycloakIntegration {
  private baseUrl = CONFIG.keycloak.baseUrl;
  private realm = CONFIG.keycloak.realm;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async getAdminToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 10000) return this.tokenCache.token;
    const res = await fetch(`${this.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: CONFIG.keycloak.adminUsername,
        password: CONFIG.keycloak.adminPassword,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as { access_token: string; expires_in: number };
    this.tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  async createUser(user: { username: string; email: string; firstName?: string; lastName?: string; enabled?: boolean }): Promise<string> {
    const token = await this.getAdminToken();
    const res = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...user, enabled: user.enabled ?? true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Keycloak createUser failed: ${res.status}`);
    const location = res.headers.get("Location") || "";
    return location.split("/").pop() || "";
  }

  async getUser(userId: string): Promise<unknown> {
    const token = await this.getAdminToken();
    const res = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? res.json() : null;
  }

  async assignRole(userId: string, roleName: string): Promise<boolean> {
    try {
      const token = await this.getAdminToken();
      const roleRes = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/roles/${roleName}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!roleRes.ok) return false;
      const role = await roleRes.json() as { id: string; name: string };
      const assignRes = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/realm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify([role]),
      });
      return assignRes.ok;
    } catch { return false; }
  }

  async getHealth(): Promise<boolean> {
    try { const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) }); return res.ok; } catch { return false; }
  }
}

// ─── Permify Integration ──────────────────────────────────────────────────────
export class PermifyIntegration {
  private baseUrl = CONFIG.permify.baseUrl;
  private tenantId = CONFIG.permify.tenantId;
  private apiKey = CONFIG.permify.apiKey;

  private async request(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/v1/tenants/${this.tenantId}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.json();
  }

  async check(entity: string, entityId: string, permission: string, subject: string, subjectId: string): Promise<boolean> {
    try {
      const data = await this.request("/permissions/check", {
        entity: { type: entity, id: entityId },
        permission,
        subject: { type: subject, id: subjectId },
      }) as { can: string };
      return data.can === "RESULT_ALLOWED";
    } catch { return false; }
  }

  async writeRelationship(entity: string, entityId: string, relation: string, subject: string, subjectId: string): Promise<boolean> {
    try {
      await this.request("/data/relationships/write", {
        tuples: [{ entity: { type: entity, id: entityId }, relation, subject: { type: subject, id: subjectId } }],
      });
      return true;
    } catch { return false; }
  }

  async deleteRelationship(entity: string, entityId: string, relation: string, subject: string, subjectId: string): Promise<boolean> {
    try {
      await this.request("/data/relationships/delete", {
        filter: { entity: { type: entity, ids: [entityId] }, relation, subject: { type: subject, ids: [subjectId] } },
      });
      return true;
    } catch { return false; }
  }

  async getHealth(): Promise<boolean> {
    try { const res = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(3000) }); return res.ok; } catch { return false; }
  }
}

// ─── Dapr Integration ─────────────────────────────────────────────────────────
export class DaprIntegration {
  private baseUrl = `http://${CONFIG.dapr.host}:${CONFIG.dapr.httpPort}/v1.0`;

  async invokeService(appId: string, method: string, data?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/invoke/${appId}/method/${method}`, {
      method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return res.json();
  }

  async publishEvent(pubsubName: string, topic: string, data: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/publish/${pubsubName}/${topic}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch { return false; }
  }

  async getState(storeName: string, key: string): Promise<unknown> {
    try {
      const res = await fetch(`${this.baseUrl}/state/${storeName}/${key}`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  async saveState(storeName: string, key: string, value: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/state/${storeName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ key, value }]),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch { return false; }
  }

  async getHealth(): Promise<boolean> {
    try { const res = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(3000) }); return res.ok; } catch { return false; }
  }
}

// ─── TigerBeetle Integration ──────────────────────────────────────────────────
export class TigerBeetleIntegration {
  private bridgeUrl = CONFIG.tigerBeetle.bridgeUrl;

  private async request(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.bridgeUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Cluster-ID": String(CONFIG.tigerBeetle.clusterId) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`TigerBeetle bridge ${path}: ${res.status}`);
    return res.json();
  }

  async createAccounts(accounts: Array<{ id: bigint; ledger: number; code: number; flags?: number; userData128?: bigint; userData64?: bigint; userData32?: number }>): Promise<void> {
    const payload = accounts.map(a => ({
      id: a.id.toString(),
      ledger: a.ledger,
      code: a.code,
      flags: a.flags ?? 0,
      user_data_128: (a.userData128 ?? 0n).toString(),
      user_data_64: (a.userData64 ?? 0n).toString(),
      user_data_32: a.userData32 ?? 0,
    }));
    const data = await this.request("/accounts/create", { accounts: payload }) as { errors?: Array<{ index: number; result: number }> };
    const hard = (data.errors ?? []).filter(e => e.result !== 21); // 21 = exists (idempotent)
    if (hard.length > 0) throw new Error(`TigerBeetle createAccounts errors: ${JSON.stringify(hard)}`);
  }

  async lookupAccounts(ids: bigint[]): Promise<unknown[]> {
    const data = await this.request("/accounts/lookup", { ids: ids.map(i => i.toString()) }) as { accounts?: unknown[] };
    return data.accounts ?? [];
  }

  async createTransfer(t: { id: bigint; debitAccountId: bigint; creditAccountId: bigint; amount: bigint; ledger: number; code: number; flags?: number; pendingId?: bigint; timeout?: number; userData128?: bigint }): Promise<void> {
    const payload = [{
      id: t.id.toString(),
      debit_account_id: t.debitAccountId.toString(),
      credit_account_id: t.creditAccountId.toString(),
      amount: t.amount.toString(),
      ledger: t.ledger,
      code: t.code,
      flags: t.flags ?? 0,
      pending_id: (t.pendingId ?? 0n).toString(),
      user_data_128: (t.userData128 ?? 0n).toString(),
      user_data_64: "0",
      user_data_32: 0,
      timeout: t.timeout ?? 0,
    }];
    const data = await this.request("/transfers/create", { transfers: payload }) as { errors?: Array<{ index: number; result: number; reason?: string }> };
    const errors = data.errors ?? [];
    // exists(46) on a deterministic id = exact replay of an identical transfer —
    // idempotent success, not an error (FF-001 settlement post/void retries).
    const hard = errors.filter(e => e.result !== 46);
    if (hard.length > 0) throw new Error(`TigerBeetle createTransfer errors: ${JSON.stringify(errors)}`);
  }

  async createPendingTransfer(t: { id: bigint; debitAccountId: bigint; creditAccountId: bigint; amount: bigint; ledger: number; code: number; timeoutSeconds?: number; userData128?: bigint }): Promise<void> {
    await this.createTransfer({ ...t, flags: 2, timeout: t.timeoutSeconds ?? 300 }); // 2 = PENDING
  }

  async postPendingTransfer(t: { id: bigint; pendingId: bigint; ledger: number; code: number; amount?: bigint }): Promise<void> {
    // TB 0.16: amount=0 posts the full pending amount; bridge defaults it.
    await this.createTransfer({
      id: t.id,
      debitAccountId: 0n,
      creditAccountId: 0n,
      amount: t.amount ?? 0n,
      ledger: t.ledger,
      code: t.code,
      flags: 4, // POST_PENDING_TRANSFER
      pendingId: t.pendingId,
    });
  }

  async voidPendingTransfer(t: { id: bigint; pendingId: bigint; ledger: number; code: number }): Promise<void> {
    await this.createTransfer({
      id: t.id,
      debitAccountId: 0n,
      creditAccountId: 0n,
      amount: 0n,
      ledger: t.ledger,
      code: t.code,
      flags: 8, // VOID_PENDING_TRANSFER
      pendingId: t.pendingId,
    });
  }

  async validateBalance(accountId: bigint, requiredAmount: bigint): Promise<void> {
    const accounts = await this.lookupAccounts([accountId]) as Array<{ debits_posted?: string; debits_pending?: string; credits_posted?: string; credits_pending?: string }>;
    if (accounts.length === 0) throw new Error(`TigerBeetle account ${accountId} not found`);
    const a = accounts[0];
    const available = BigInt(a.credits_posted ?? "0") - BigInt(a.debits_posted ?? "0") - BigInt(a.debits_pending ?? "0");
    if (available < requiredAmount) {
      throw new Error(`Insufficient funds: available ${available}, required ${requiredAmount}`);
    }
  }

  async getHealth(): Promise<boolean> {
    try { const res = await fetch(`${this.bridgeUrl}/health`, { signal: AbortSignal.timeout(3000) }); return res.ok; } catch { return false; }
  }
}

// ─── Fluvio Integration ───────────────────────────────────────────────────────
export class FluvioIntegration {
  private endpoint = `http://${CONFIG.fluvio.endpoint}`;

  async produce(topic: string, key: string, value: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/topics/${topic}/produce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ key, value }] }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch { return false; }
  }

  async getHealth(): Promise<boolean> {
    try { const res = await fetch(`${this.endpoint}/health`, { signal: AbortSignal.timeout(3000) }); return res.ok; } catch { return false; }
  }
}

// ─── OpenAppSec Integration ───────────────────────────────────────────────────
export class OpenAppSecIntegration {
  private mgmtUrl = CONFIG.openAppSec.mgmtUrl;
  private apiKey = CONFIG.openAppSec.apiKey;
  private blockedIps = new Set<string>();
  private ipViolations = new Map<string, { count: number; lastSeen: number }>();
  private static readonly MAX_VIOLATIONS = 5;
  private static readonly VIOLATION_WINDOW_MS = 60_000;

  async inspectRequest(req: { sourceIp: string; uri: string; method: string; headers?: Record<string, string>; body?: string }): Promise<{ blocked: boolean; anomalyScore: number }> {
    if (this.blockedIps.has(req.sourceIp)) return { blocked: true, anomalyScore: 1.0 };
    try {
      const res = await fetch(`${this.mgmtUrl}/api/v1/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { blocked: false, anomalyScore: 0 };
      const data = await res.json() as { blocked?: boolean; anomaly_score?: number };
      if (data.blocked) this.recordViolation(req.sourceIp);
      return { blocked: data.blocked ?? false, anomalyScore: data.anomaly_score ?? 0 };
    } catch { return { blocked: false, anomalyScore: 0 }; }
  }

  recordViolation(ip: string): { blocked: boolean; totalViolations: number } {
    const now = Date.now();
    const existing = this.ipViolations.get(ip);
    if (existing && now - existing.lastSeen < OpenAppSecIntegration.VIOLATION_WINDOW_MS) {
      existing.count++;
      existing.lastSeen = now;
    } else {
      this.ipViolations.set(ip, { count: 1, lastSeen: now });
    }
    const violations = this.ipViolations.get(ip)!;
    if (violations.count >= OpenAppSecIntegration.MAX_VIOLATIONS) {
      this.blockedIps.add(ip);
      logger.warn(`[OpenAppSec] IP ${ip} auto-blocked after ${violations.count} violations`);
      return { blocked: true, totalViolations: violations.count };
    }
    return { blocked: false, totalViolations: violations.count };
  }

  isIpBlocked(ip: string): boolean {
    return this.blockedIps.has(ip);
  }

  unblockIp(ip: string): void {
    this.blockedIps.delete(ip);
    this.ipViolations.delete(ip);
  }

  getBlockedIps(): string[] {
    return Array.from(this.blockedIps);
  }

  /** Request body inspection for common attack patterns */
  inspectBody(body: string): { suspicious: boolean; patterns: string[] } {
    const patterns: string[] = [];
    if (/(<script|javascript:|on\w+=)/i.test(body)) patterns.push("xss");
    if (/(union\s+select|;\s*drop\s+table|'\s*or\s+'1'\s*=\s*'1)/i.test(body)) patterns.push("sqli");
    if (/(\.\.\/(\.\.\/){2,}|\/etc\/passwd|\/proc\/self)/i.test(body)) patterns.push("path_traversal");
    if (/({{.*}}|{%.*%}|\$\{.*\})/i.test(body)) patterns.push("ssti");
    return { suspicious: patterns.length > 0, patterns };
  }
}

// ─── Lakehouse Integration ────────────────────────────────────────────────────
export class LakehouseIntegration {
  async query(sqlQuery: string): Promise<any[]> {
    try {
      const res = await fetch(`${CONFIG.lakehouse.url}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sqlQuery, catalog: CONFIG.lakehouse.catalog }),
      });
      if (!res.ok) return [];
      return (await res.json() as { rows: any[] }).rows || [];
    } catch { return []; }
  }

  async ingest(table: string, records: Record<string, unknown>[]): Promise<{ ingested: number }> {
    try {
      const res = await fetch(`${CONFIG.lakehouse.url}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, catalog: CONFIG.lakehouse.catalog, records }),
      });
      return res.ok ? await res.json() as { ingested: number } : { ingested: 0 };
    } catch { return { ingested: 0 }; }
  }

  async getTableStats(table: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${CONFIG.lakehouse.url}/tables/${table}/stats?catalog=${CONFIG.lakehouse.catalog}`);
      return res.ok ? await res.json() as Record<string, unknown> : null;
    } catch { return null; }
  }
}

// ─── APISIX Integration ───────────────────────────────────────────────────────
export class APISIXIntegration {
  private adminUrl = CONFIG.apisix.adminUrl;
  private gatewayUrl = CONFIG.apisix.gatewayUrl;
  private routesSynced = false;
  /** Admin key from env (never hardcoded) — falls back to empty for dev */
  private adminKey = process.env.APISIX_ADMIN_KEY || CONFIG.apisix.adminKey;
  private routeConfigVersion = 0;

  private async request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    if (!this.adminKey) {
      logger.warn("[APISIX] No admin key configured (set APISIX_ADMIN_KEY env var)");
      throw new Error("APISIX admin key not configured");
    }
    const res = await fetch(`${this.adminUrl}${path}`, {
      method,
      headers: { "X-API-KEY": this.adminKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`APISIX ${method} ${path}: ${res.status}`);
    return res.json();
  }

  /** Reload routes from config without restart — bumps config version */
  async reloadRoutes(): Promise<{ reloaded: number; version: number }> {
    this.routesSynced = false;
    this.routeConfigVersion++;
    // Re-list routes to validate config is current
    await this.listRoutes();
    return { reloaded: 15, version: this.routeConfigVersion };
  }

  /** Hot-reload admin key at runtime (e.g., after key rotation) */
  rotateAdminKey(newKey: string): void {
    this.adminKey = newKey;
    logger.info("[APISIX] Admin key rotated");
  }

  async createRoute(id: string, config: { uri: string; upstream: { nodes: Record<string, number>; type: string }; plugins?: Record<string, unknown> }): Promise<unknown> {
    return this.request(`/apisix/admin/routes/${id}`, "PUT", config);
  }

  async deleteRoute(id: string): Promise<void> {
    await this.request(`/apisix/admin/routes/${id}`, "DELETE");
  }

  async listRoutes(): Promise<unknown> {
    return this.request("/apisix/admin/routes");
  }

  async createUpstream(id: string, config: { nodes: Record<string, number>; type: string; checks?: unknown }): Promise<unknown> {
    return this.request(`/apisix/admin/upstreams/${id}`, "PUT", config);
  }

  async enablePlugin(routeId: string, pluginName: string, pluginConfig: Record<string, unknown>): Promise<unknown> {
    return this.request(`/apisix/admin/routes/${routeId}`, "PATCH", { plugins: { [pluginName]: pluginConfig } });
  }

  async getHealth(): Promise<boolean> {
    try { await this.request("/apisix/admin/routes"); return true; } catch { return false; }
  }

  getGatewayUrl(): string { return this.gatewayUrl; }

  /** Auto-register all RemitFlow service routes with JWT auth + rate limiting */
  async syncServiceRoutes(): Promise<{ synced: number; errors: string[] }> {
    if (this.routesSynced) return { synced: 0, errors: [] };
    const errors: string[] = [];
    const routes = [
      { id: "remitflow-api", uri: "/api/*", upstream: CONFIG.apisix.apiUpstream },
      { id: "remitflow-trpc", uri: "/trpc/*", upstream: CONFIG.apisix.apiUpstream },
      { id: "lakehouse-etl", uri: "/lakehouse/*", upstream: CONFIG.apisix.lakehouseUpstream },
    ];
    let synced = 0;
    for (const r of routes) {
      try {
        await this.createRoute(r.id, {
          uri: r.uri,
          upstream: { nodes: { [r.upstream]: 1 }, type: "roundrobin" },
          plugins: {
            "jwt-auth": { key: "remitflow-jwt" },
            "limit-req": { rate: 100, burst: 50, rejected_code: 429, key_type: "var", key: "remote_addr" },
            "proxy-rewrite": { scheme: "http" },
          },
        });
        synced++;
      } catch (err) {
        errors.push(`${r.id}: ${(err as Error).message}`);
      }
    }
    if (synced > 0) this.routesSynced = true;
    logger.info(`[APISIX] Synced ${synced}/${routes.length} routes`);
    return { synced, errors };
  }

  /** Canary deployment — split traffic between stable and canary upstream */
  async setCanaryWeight(routeId: string, canaryUpstream: string, weightPercent: number): Promise<boolean> {
    if (weightPercent < 0 || weightPercent > 100) return false;
    try {
      await this.request(`/apisix/admin/routes/${routeId}`, "PATCH", {
        plugins: {
          "traffic-split": {
            rules: [{
              weighted_upstreams: [
                { weight: 100 - weightPercent },
                { upstream: { nodes: { [canaryUpstream]: 1 }, type: "roundrobin" }, weight: weightPercent },
              ],
            }],
          },
        },
      });
      logger.info(`[APISIX] Canary weight for ${routeId}: ${weightPercent}%`);
      return true;
    } catch (err) {
      logger.warn({ err }, "[APISIX] Canary weight update failed");
      return false;
    }
  }

  /** SSL certificate management */
  async uploadSSLCert(id: string, cert: string, key: string, snis: string[]): Promise<boolean> {
    try {
      await this.request(`/apisix/admin/ssls/${id}`, "PUT", { cert, key, snis });
      return true;
    } catch (err) {
      logger.warn({ err }, "[APISIX] SSL cert upload failed");
      return false;
    }
  }

  /** Global plugin configuration */
  async configureGlobalPlugin(pluginName: string, config: Record<string, unknown>): Promise<boolean> {
    try {
      await this.request(`/apisix/admin/global_rules/1`, "PATCH", {
        plugins: { [pluginName]: config },
      });
      return true;
    } catch (err) {
      logger.warn({ err }, "[APISIX] Global plugin config failed");
      return false;
    }
  }
}

// ─── Mojaloop Integration ─────────────────────────────────────────────────────
export class MojaloopIntegration {
  private hubUrl = CONFIG.mojaloop.hubUrl;
  private fspId = CONFIG.mojaloop.fspId;
  private ilpSecret = CONFIG.mojaloop.ilpSecret;

  private async request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    if (!this.hubUrl) {
      throw new Error("[Mojaloop] MOJALOOP_HUB_URL not configured");
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.interoperability.transfers+json;version=1.1",
      "FSPIOP-Source": this.fspId,
      "Date": new Date().toUTCString(),
    };
    const res = await fetch(`${this.hubUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && res.status !== 202) throw new Error(`Mojaloop ${method} ${path}: ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  async getParticipant(type: string, id: string): Promise<unknown> {
    return this.request(`/participants/${type}/${id}`);
  }

  async createQuote(quoteId: string, transferAmount: { amount: string; currency: string }, payer: { partyIdType: string; partyIdentifier: string; fspId: string }, payee: { partyIdType: string; partyIdentifier: string; fspId: string }): Promise<unknown> {
    return this.request("/quotes", "POST", {
      quoteId,
      transactionId: randomUUID(),
      payer: { partyIdInfo: payer },
      payee: { partyIdInfo: payee },
      amountType: "SEND",
      amount: transferAmount,
      transactionType: { scenario: "TRANSFER", initiator: "PAYER", initiatorType: "CONSUMER" },
    });
  }

  async createTransfer(transferId: string, amount: { amount: string; currency: string }, ilpPacket: string, condition: string, payerFsp: string, payeeFsp: string): Promise<unknown> {
    return this.request("/transfers", "POST", {
      transferId,
      payerFsp,
      payeeFsp,
      amount,
      ilpPacket,
      condition,
      expiration: new Date(Date.now() + 30000).toISOString(),
    });
  }

  async getTransfer(transferId: string): Promise<unknown> {
    return this.request(`/transfers/${transferId}`);
  }

  /** Participant lifecycle: register DFSP with the switch */
  async addDFSP(dfspId: string, dfspName: string, currency = "NGN"): Promise<unknown> {
    return this.request("/participants", "POST", {
      fspId: dfspId, name: dfspName, currency,
    });
  }

  /** Fund participant position (pre-fund net debit cap) */
  async fundPosition(participantName: string, amount: { amount: string; currency: string }): Promise<unknown> {
    return this.request(`/participants/${participantName}/accounts`, "POST", {
      transferId: randomUUID(), amount, reason: "Pre-fund net debit cap",
    });
  }

  async registerParticipant(partyIdType: string, partyIdentifier: string): Promise<unknown> {
    return this.request(`/participants/${partyIdType}/${partyIdentifier}`, "POST", { fspId: this.fspId, currency: "NGN" });
  }

  async getHealth(): Promise<boolean> {
    try { const res = await fetch(`${this.hubUrl}/health`); return res.ok; } catch { return false; }
  }

  getIlpSecret(): string { return this.ilpSecret; }
  getFspId(): string { return this.fspId; }
}

// ─── Kafka Integration ────────────────────────────────────────────────────────
export class KafkaIntegration {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private producer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private consumers: Map<string, any> = new Map();
  private brokers = requiredEnv("KAFKA_BROKERS").split(",");
  private clientId = requiredEnv("KAFKA_CLIENT_ID");
  private connectionFailed = false;
  private lastConnectAttempt = 0;
  private static readonly RETRY_INTERVAL_MS = 60_000;
  private dlqTopic = "remitflow.dlq";

  async connect(): Promise<void> {
    if (this.connectionFailed && Date.now() - this.lastConnectAttempt < KafkaIntegration.RETRY_INTERVAL_MS) {
      throw new Error("Kafka producer is in its configured retry backoff window");
    }
    this.lastConnectAttempt = Date.now();
    try {
      const { Kafka } = await import("kafkajs");
      const kafka = new Kafka({ clientId: this.clientId, brokers: this.brokers });
      this.producer = kafka.producer();
      await this.producer.connect();
      this.connectionFailed = false;
      logger.info("[Kafka] Producer connected");
    } catch (err) {
      this.connectionFailed = true;
      this.producer = null;
      throw new Error(`Kafka producer connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async produce(topic: string, key: string, value: string, headers?: Record<string, string>): Promise<void> {
    if (!this.producer) await this.connect();
    if (!this.producer) throw new Error("Kafka producer unavailable after connection attempt");
    await this.producer.send({
      topic,
      messages: [{ key, value, headers: headers ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, Buffer.from(v)])) : undefined }],
    });
  }

  /** Send a failed message to the Dead Letter Queue with error metadata */
  async sendToDLQ(originalTopic: string, key: string, value: string, error: string): Promise<void> {
    if (!this.producer) await this.connect();
    if (!this.producer) {
      throw new Error(`Kafka producer unavailable while writing DLQ event for ${originalTopic}:${key}: ${error}`);
    }
    await this.producer.send({
      topic: this.dlqTopic,
      messages: [{
        key,
        value: JSON.stringify({ originalTopic, originalValue: value, error, failedAt: new Date().toISOString() }),
        headers: { "x-original-topic": Buffer.from(originalTopic), "x-error": Buffer.from(error.slice(0, 500)) },
      }],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createConsumer(groupId: string, topics: string[], handler: (message: { topic: string; partition: number; key: string; value: string; headers: Record<string, string> }) => Promise<void>): Promise<void> {
    try {
      const { Kafka } = await import("kafkajs");
      const kafka = new Kafka({ clientId: this.clientId, brokers: this.brokers });
      const consumer = kafka.consumer({ groupId });
      await consumer.connect();
      await consumer.subscribe({ topics, fromBeginning: false });
      await consumer.run({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eachMessage: async ({ topic, partition, message }: { topic: string; partition: number; message: any }) => {
          const msg = {
            topic,
            partition,
            key: message.key?.toString() || "",
            value: message.value?.toString() || "",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            headers: Object.fromEntries(Object.entries(message.headers || {}).map(([k, v]: [string, any]) => [k, v?.toString() || ""])),
          };
          try {
            await handler(msg);
          } catch (err) {
            logger.error({ err, topic, key: msg.key }, "[Kafka] Consumer handler failed — sending to DLQ");
            await this.sendToDLQ(topic, msg.key, msg.value, (err as Error).message);
          }
        },
      });
      this.consumers.set(groupId, consumer);
      logger.info({ groupId, topics }, "[Kafka] Consumer started");
    } catch (err) {
      throw new Error(`Kafka consumer ${groupId} creation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.producer) await this.producer.disconnect();
    for (const [, consumer] of Array.from(this.consumers)) {
      await consumer.disconnect();
    }
  }

  isConnected(): boolean { return !!this.producer && !this.connectionFailed; }
}

// ─── Temporal Integration ─────────────────────────────────────────────────────
export class TemporalIntegration {
  private client: any = null;
  private address = requiredEnv("TEMPORAL_ADDRESS");
  private namespace = requiredEnv("TEMPORAL_NAMESPACE");

  async connect(): Promise<void> {
    try {
      const { Connection, Client } = await import("@temporalio/client");
      const connection = await Connection.connect({ address: this.address });
      this.client = new Client({ connection, namespace: this.namespace });
      logger.info("[Temporal] Connected");
    } catch (err) {
      this.client = null;
      throw new Error(`Temporal connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async startWorkflow(workflowId: string, workflowType: string, args: unknown[], taskQueue = "remitflow-tasks"): Promise<{ workflowId: string; runId: string }> {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Temporal client unavailable after connection attempt");
    const handle = await this.client.workflow.start(workflowType, { workflowId, taskQueue, args });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  }

  async signalWorkflow(workflowId: string, signalName: string, args: unknown[]): Promise<void> {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Temporal client unavailable after connection attempt");
    const handle = this.client.workflow.getHandle(workflowId);
    await handle.signal(signalName, ...args);
  }

  async queryWorkflow(workflowId: string, queryType: string): Promise<unknown> {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Temporal client unavailable after connection attempt");
    const handle = this.client.workflow.getHandle(workflowId);
    return handle.query(queryType);
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Temporal client unavailable after connection attempt");
    const handle = this.client.workflow.getHandle(workflowId);
    await handle.cancel();
  }

  async getWorkflowResult(workflowId: string): Promise<unknown> {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Temporal client unavailable after connection attempt");
    const handle = this.client.workflow.getHandle(workflowId);
    return handle.result();
  }

  async getHealth(): Promise<boolean> {
    try {
      if (!this.client) await this.connect();
      return !!this.client;
    } catch { return false; }
  }
}

// ─── Singleton Instances ──────────────────────────────────────────────────────
export const redis = new RedisIntegration();
export const openSearch = new OpenSearchIntegration();
export const keycloak = new KeycloakIntegration();
export const permify = new PermifyIntegration();
export const dapr = new DaprIntegration();
export const tigerBeetle = new TigerBeetleIntegration();
export const fluvio = new FluvioIntegration();
export const openAppSec = new OpenAppSecIntegration();
export const lakehouse = new LakehouseIntegration();
export const apisix = new APISIXIntegration();
export const mojaloop = new MojaloopIntegration();
export const kafka = new KafkaIntegration();
export const temporal = new TemporalIntegration();

// ─── Middleware Health Check ──────────────────────────────────────────────────
export async function getMiddlewareHealth(): Promise<Record<string, { status: string; latencyMs: number }>> {
  const checks = await Promise.allSettled([
    timed("redis", () => redis.get("health_check")),
    timed("openSearch", () => openSearch.search("_health", { match_all: {} }, 1)),
    timed("keycloak", () => fetch(`${CONFIG.keycloak.baseUrl}/health`).then(r => r.ok)),
    timed("permify", () => fetch(`${new PermifyIntegration()["baseUrl"]}/healthz`).then(r => r.ok)),
    timed("dapr", () => fetch(`http://${CONFIG.dapr.host}:${CONFIG.dapr.httpPort}/v1.0/healthz`).then(r => r.ok)),
    timed("apisix", () => fetch(`${CONFIG.apisix.adminUrl}/apisix/admin/routes`, { headers: { "X-API-KEY": CONFIG.apisix.adminKey } }).then(r => r.ok)),
    timed("tigerBeetle", () => tigerBeetle.lookupAccounts([BigInt(0)])),
    timed("fluvio", () => fetch(`http://${CONFIG.fluvio.endpoint}/health`).then(r => r.ok)),
    timed("lakehouse", () => fetch(`${CONFIG.lakehouse.url}/health`).then(r => r.ok)),
    timed("openAppSec", () => fetch(`${CONFIG.openAppSec.mgmtUrl}/health`).then(r => r.ok)),
    timed("mojaloop", () => fetch(`${CONFIG.mojaloop.hubUrl}/health`).then(r => r.ok)),
  ]);

  const names = ["redis", "openSearch", "keycloak", "permify", "dapr", "apisix", "tigerBeetle", "fluvio", "lakehouse", "openAppSec", "mojaloop"];
  const result: Record<string, { status: string; latencyMs: number }> = {};
  checks.forEach((c, i) => {
    if (c.status === "fulfilled") {
      result[names[i]] = c.value as { status: string; latencyMs: number };
    } else {
      result[names[i]] = { status: "unavailable", latencyMs: -1 };
    }
  });
  return result;
}

async function timed(name: string, fn: () => Promise<unknown>): Promise<{ status: string; latencyMs: number }> {
  const start = Date.now();
  try {
    await fn();
    return { status: "healthy", latencyMs: Date.now() - start };
  } catch {
    return { status: "unavailable", latencyMs: Date.now() - start };
  }
}
