import { logger } from '../_core/logger';
/**
 * RemitFlow — Permify RBAC Client
 * Fine-grained authorization for all platform resources
 */

const PERMIFY_URL = process.env.PERMIFY_URL || process.env.PERMIFY_HTTP_URL || "";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT || process.env.PERMIFY_TENANT_ID || "";

// ── Permission Check Types ────────────────────────────────────────────────────

export interface PermissionCheck {
  entity: { type: string; id: string };
  permission: string;
  subject: { type: "user"; id: string };
}

export interface RelationshipWrite {
  entity: { type: string; id: string };
  relation: string;
  subject: { type: string; id: string };
}

// ── Permify Client ────────────────────────────────────────────────────────────

class PermifyClient {
  private baseUrl: string | null;
  private available = false;

  constructor() {
    this.baseUrl = PERMIFY_URL && PERMIFY_TENANT
      ? `${PERMIFY_URL.replace(/\/$/, "")}/v1/tenants/${PERMIFY_TENANT}`
      : null;
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    if (!PERMIFY_URL || !PERMIFY_TENANT || !this.baseUrl) {
      this.available = false;
      logger.error("[PERMIFY] PERMIFY_URL/PERMIFY_HTTP_URL and PERMIFY_TENANT_ID must be configured; denying authorization checks.");
      return;
    }
    try {
      const res = await fetch(`${PERMIFY_URL.replace(/\/$/, "")}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      this.available = res.ok;
      if (this.available) {
        logger.info("[PERMIFY] Authorization service connected");
      }
    } catch {
      this.available = false;
      logger.error("[PERMIFY] Authorization service unavailable; denying authorization checks.");
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async check(check: PermissionCheck): Promise<boolean> {
    if (!this.available || !this.baseUrl) {
      logger.warn("[PERMIFY] Unavailable or unconfigured — denying by default");
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/permissions/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: "", snap_token: "", depth: 20 },
          entity: check.entity,
          permission: check.permission,
          subject: check.subject,
        }),
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) return false;
      const data = (await res.json()) as { can: "CHECK_RESULT_ALLOWED" | "CHECK_RESULT_DENIED" };
      return data.can === "CHECK_RESULT_ALLOWED";
    } catch {
      return false;
    }
  }

  /**
   * In-memory permission cache — avoids network round-trip for repeated checks.
   * Cache entries expire after 30 seconds.
   */
  private permissionCache = new Map<string, { result: boolean; expiresAt: number }>();
  private static CACHE_TTL_MS = 30_000;

  private getCacheKey(check: PermissionCheck): string {
    return `${PERMIFY_TENANT}:${check.entity.type}:${check.entity.id}:${check.permission}:${check.subject.type}:${check.subject.id}`;
  }

  async checkCached(check: PermissionCheck): Promise<boolean> {
    const key = this.getCacheKey(check);
    const cached = this.permissionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const result = await this.check(check);
    this.permissionCache.set(key, { result, expiresAt: Date.now() + PermifyClient.CACHE_TTL_MS });
    return result;
  }

  /** Batch permission check — checks multiple permissions in parallel */
  async checkBatch(checks: PermissionCheck[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const promises = checks.map(async (check) => {
      const key = this.getCacheKey(check);
      const result = await this.checkCached(check);
      results.set(key, result);
    });
    await Promise.all(promises);
    return results;
  }

  async writeRelationship(rel: RelationshipWrite): Promise<boolean> {
    if (!this.available || !this.baseUrl) {
      logger.warn("[PERMIFY] Unavailable or unconfigured — denying relationship write");
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/relationships/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: "" },
          tuples: [
            {
              entity: rel.entity,
              relation: rel.relation,
              subject: rel.subject,
            },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      });
      // Invalidate cache for affected entity
      if (res.ok) {
        const prefix = `${rel.entity.type}:${rel.entity.id}:`;
        Array.from(this.permissionCache.keys()).forEach(k => {
          if (k.startsWith(prefix)) this.permissionCache.delete(k);
        });
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  async deleteRelationship(rel: RelationshipWrite): Promise<boolean> {
    if (!this.available || !this.baseUrl) {
      logger.warn("[PERMIFY] Unavailable or unconfigured — denying relationship delete");
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/relationships/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tuples: [
            {
              entity: rel.entity,
              relation: rel.relation,
              subject: rel.subject,
            },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let permifyClient: PermifyClient | null = null;

export function getPermifyClient(): PermifyClient {
  if (!permifyClient) {
    permifyClient = new PermifyClient();
  }
  return permifyClient;
}

// ── High-Level Authorization Helpers ─────────────────────────────────────────

export async function canAccessTransaction(
  userId: string,
  transactionId: string,
  permission: "view" | "cancel" | "refund" | "approve"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "transaction", id: transactionId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function canAccessWallet(
  userId: string,
  walletId: string,
  permission: "view" | "deposit" | "withdraw" | "freeze"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "wallet", id: walletId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function canManageKYC(
  userId: string,
  kycRecordId: string,
  permission: "view" | "submit" | "approve" | "reject"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "kyc_record", id: kycRecordId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function canAccessDispute(
  userId: string,
  disputeId: string,
  permission: "view" | "submit" | "respond" | "resolve" | "escalate" = "submit"
): Promise<boolean> {
  return getPermifyClient().check({
    entity: { type: "dispute", id: disputeId },
    permission,
    subject: { type: "user", id: userId },
  });
}

export async function grantTransactionAccess(
  userId: string,
  transactionId: string,
  role: "owner" | "reviewer" = "owner"
): Promise<boolean> {
  return getPermifyClient().writeRelationship({
    entity: { type: "transaction", id: transactionId },
    relation: role,
    subject: { type: "user", id: userId },
  });
}

export async function grantWalletAccess(
  userId: string,
  walletId: string,
  role: "owner" | "auditor"
): Promise<boolean> {
  return getPermifyClient().writeRelationship({
    entity: { type: "wallet", id: walletId },
    relation: role,
    subject: { type: "user", id: userId },
  });
}
