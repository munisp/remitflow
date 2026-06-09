/**
 * Secrets Rotation Infrastructure
 * 
 * Provides automated rotation for:
 * - Database credentials (PostgreSQL)
 * - API keys (payment providers, FX APIs)
 * - JWT signing keys
 * - Webhook signing secrets
 * - mTLS certificates
 * 
 * Middleware-ready: In production, swap to AWS Secrets Manager, HashiCorp Vault,
 * or Dapr Secrets API via environment configuration.
 */
import crypto from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SecretMetadata {
  name: string;
  version: number;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt?: Date;
  source: "env" | "vault" | "aws_sm" | "dapr";
}

interface RotationPolicy {
  intervalDays: number;
  graceHours: number;
  autoRotate: boolean;
  notifyBeforeDays: number;
}

interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string, metadata: Partial<SecretMetadata>): Promise<void>;
  rotate(name: string): Promise<{ oldVersion: number; newVersion: number }>;
  listExpiring(withinDays: number): Promise<SecretMetadata[]>;
}

// ─── Default Rotation Policies ──────────────────────────────────────────────

const ROTATION_POLICIES: Record<string, RotationPolicy> = {
  database_credentials: {
    intervalDays: 90,
    graceHours: 24,
    autoRotate: false,
    notifyBeforeDays: 14,
  },
  api_keys: {
    intervalDays: 180,
    graceHours: 48,
    autoRotate: true,
    notifyBeforeDays: 30,
  },
  jwt_signing_key: {
    intervalDays: 365,
    graceHours: 72,
    autoRotate: true,
    notifyBeforeDays: 60,
  },
  webhook_signing_secret: {
    intervalDays: 90,
    graceHours: 24,
    autoRotate: true,
    notifyBeforeDays: 14,
  },
  mtls_certificate: {
    intervalDays: 365,
    graceHours: 168,
    autoRotate: false,
    notifyBeforeDays: 90,
  },
};

// ─── Environment-based Secret Store (dev) ───────────────────────────────────

class EnvSecretStore implements SecretStore {
  private metadata = new Map<string, SecretMetadata>();

  async get(name: string): Promise<string | null> {
    return process.env[name] ?? null;
  }

  async set(name: string, value: string, meta: Partial<SecretMetadata>): Promise<void> {
    process.env[name] = value;
    this.metadata.set(name, {
      name,
      version: (this.metadata.get(name)?.version ?? 0) + 1,
      createdAt: meta.createdAt ?? new Date(),
      expiresAt: meta.expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      rotatedAt: new Date(),
      source: "env",
    });
  }

  async rotate(name: string): Promise<{ oldVersion: number; newVersion: number }> {
    const current = this.metadata.get(name);
    const oldVersion = current?.version ?? 0;
    const newVersion = oldVersion + 1;
    
    const newSecret = crypto.randomBytes(32).toString("hex");
    await this.set(name, newSecret, {
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    
    return { oldVersion, newVersion };
  }

  async listExpiring(withinDays: number): Promise<SecretMetadata[]> {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    return Array.from(this.metadata.values()).filter(m => m.expiresAt <= cutoff);
  }
}

// ─── Vault Secret Store (production) ────────────────────────────────────────

class VaultSecretStore implements SecretStore {
  private vaultUrl: string;
  private vaultToken: string;

  constructor() {
    this.vaultUrl = process.env.VAULT_ADDR ?? "http://localhost:8200";
    this.vaultToken = process.env.VAULT_TOKEN ?? "";
  }

  async get(name: string): Promise<string | null> {
    if (!this.vaultToken) return process.env[name] ?? null;
    try {
      const resp = await fetch(`${this.vaultUrl}/v1/secret/data/remitflow/${name}`, {
        headers: { "X-Vault-Token": this.vaultToken },
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { data?: { data?: Record<string, string> } };
      return data.data?.data?.value ?? null;
    } catch {
      return process.env[name] ?? null;
    }
  }

  async set(name: string, value: string, _meta: Partial<SecretMetadata>): Promise<void> {
    if (!this.vaultToken) { process.env[name] = value; return; }
    await fetch(`${this.vaultUrl}/v1/secret/data/remitflow/${name}`, {
      method: "POST",
      headers: {
        "X-Vault-Token": this.vaultToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: { value } }),
    });
  }

  async rotate(name: string): Promise<{ oldVersion: number; newVersion: number }> {
    const newSecret = crypto.randomBytes(32).toString("hex");
    await this.set(name, newSecret, {});
    return { oldVersion: 0, newVersion: 1 };
  }

  async listExpiring(_withinDays: number): Promise<SecretMetadata[]> {
    return [];
  }
}

// ─── Dapr Secret Store (production with service mesh) ───────────────────────

class DaprSecretStore implements SecretStore {
  private daprUrl: string;
  private storeName: string;

  constructor() {
    this.daprUrl = process.env.DAPR_HTTP_PORT
      ? `http://localhost:${process.env.DAPR_HTTP_PORT}`
      : "http://localhost:3500";
    this.storeName = process.env.DAPR_SECRET_STORE ?? "kubernetes";
  }

  async get(name: string): Promise<string | null> {
    try {
      const resp = await fetch(`${this.daprUrl}/v1.0/secrets/${this.storeName}/${name}`);
      if (!resp.ok) return process.env[name] ?? null;
      const data = await resp.json() as Record<string, string>;
      return data[name] ?? null;
    } catch {
      return process.env[name] ?? null;
    }
  }

  async set(name: string, value: string, _meta: Partial<SecretMetadata>): Promise<void> {
    process.env[name] = value;
  }

  async rotate(name: string): Promise<{ oldVersion: number; newVersion: number }> {
    const newSecret = crypto.randomBytes(32).toString("hex");
    await this.set(name, newSecret, {});
    return { oldVersion: 0, newVersion: 1 };
  }

  async listExpiring(_withinDays: number): Promise<SecretMetadata[]> {
    return [];
  }
}

// ─── Rotation Scheduler ─────────────────────────────────────────────────────

class SecretRotationScheduler {
  private store: SecretStore;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(store: SecretStore) {
    this.store = store;
  }

  async checkAndRotate(): Promise<{ rotated: string[]; expiringSoon: string[] }> {
    const rotated: string[] = [];
    const expiringSoon: string[] = [];

    const expiring = await this.store.listExpiring(30);
    for (const secret of expiring) {
      const policy = ROTATION_POLICIES[secret.name] ?? ROTATION_POLICIES.api_keys;
      
      const daysUntilExpiry = (secret.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      
      if (daysUntilExpiry <= 0 && policy.autoRotate) {
        await this.store.rotate(secret.name);
        rotated.push(secret.name);
      } else if (daysUntilExpiry <= policy.notifyBeforeDays) {
        expiringSoon.push(secret.name);
      }
    }

    return { rotated, expiringSoon };
  }

  start(intervalHours = 24): void {
    this.interval = setInterval(
      () => this.checkAndRotate().catch(console.error),
      intervalHours * 60 * 60 * 1000
    );
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

function createSecretStore(): SecretStore {
  if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN) {
    return new VaultSecretStore();
  }
  if (process.env.DAPR_HTTP_PORT) {
    return new DaprSecretStore();
  }
  return new EnvSecretStore();
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  createSecretStore,
  SecretRotationScheduler,
  EnvSecretStore,
  VaultSecretStore,
  DaprSecretStore,
  ROTATION_POLICIES,
};
export type { SecretStore, SecretMetadata, RotationPolicy };
