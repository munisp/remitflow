/**
 * RemitFlow — Environment Variable Validation (TypeScript)
 * ══════════════════════════════════════════════════════════
 * Validates all required environment variables at startup using Zod.
 * The process will exit with a descriptive error if any required variable
 * is missing or malformed — preventing silent misconfigurations in production.
 *
 * Usage:
 *   import { env } from "@/server/lib/env";
 *   const db = new Pool({ connectionString: env.DATABASE_URL });
 */

import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // ── Core ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_VERSION: z.string().default("1.0.0"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // ── Database (PostgreSQL) ──────────────────────────────────────────────────
  DATABASE_URL: z.string().url().startsWith("postgres"),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().default(30000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().default(10000),

  // ── Redis ──────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().url().startsWith("redis"),
  REDIS_KEY_PREFIX: z.string().default("rf:"),
  REDIS_TTL_DEFAULT_SECONDS: z.coerce.number().int().default(3600),

  // ── Keycloak ──────────────────────────────────────────────────────────────
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(8),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().default("admin-cli"),
  KEYCLOAK_ADMIN_USERNAME: z.string().default("admin"),
  KEYCLOAK_ADMIN_PASSWORD: z.string().min(8),

  // ── Permify ───────────────────────────────────────────────────────────────
  PERMIFY_URL: z.string().url(),
  PERMIFY_TENANT_ID: z.string().default("t1"),

  // ── Dapr ──────────────────────────────────────────────────────────────────
  DAPR_HTTP_PORT: z.coerce.number().int().default(3500),
  DAPR_GRPC_PORT: z.coerce.number().int().default(50001),
  DAPR_APP_ID: z.string().default("remitflow-api"),
  DAPR_PUBSUB_NAME: z.string().default("remitflow-pubsub"),
  DAPR_STATE_STORE_NAME: z.string().default("remitflow-state"),

  // ── Temporal ──────────────────────────────────────────────────────────────
  TEMPORAL_ADDRESS: z.string().default("temporal:7233"),
  TEMPORAL_NAMESPACE: z.string().default("remitflow"),
  TEMPORAL_TASK_QUEUE: z.string().default("remitflow-main"),

  // ── TigerBeetle Bridge ────────────────────────────────────────────────────
  TB_BRIDGE_URL: z.string().url().default("http://tb-bridge:8200"),

  // ── Fluvio ────────────────────────────────────────────────────────────────
  FLUVIO_HTTP_BRIDGE_URL: z.string().url().default("http://fluvio-bridge:8300"),
  FLUVIO_CONSUMER_GROUP: z.string().default("remitflow-main"),

  // ── APISIX ────────────────────────────────────────────────────────────────
  APISIX_ADMIN_URL: z.string().url().default("http://apisix:9180"),
  APISIX_ADMIN_KEY: z.string().min(8),
  APISIX_MANAGER_URL: z.string().url().default("http://apisix-manager:8100"),

  // ── OpenAppSec ────────────────────────────────────────────────────────────
  OPENAPPSEC_AGENT_URL: z.string().url().default("http://openappsec:8765"),
  OPENAPPSEC_POLICY_FILE: z.string().default("/etc/openappsec/policy.json"),

  // ── Lakehouse ─────────────────────────────────────────────────────────────
  LAKEHOUSE_URL: z.string().url().default("http://lakehouse:8102"),
  LAKEHOUSE_BUCKET: z.string().default("remitflow-lakehouse"),
  S3_ENDPOINT: z.string().url().default("http://minio:9000"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(8),

  // ── AML Scorer ────────────────────────────────────────────────────────────
  AML_SCORER_URL: z.string().url().default("http://aml-scorer:8103"),
  AML_AUTO_BLOCK_ENABLED: z.coerce.boolean().default(true),
  AML_THRESHOLD_CRITICAL: z.coerce.number().int().min(1).max(100).default(81),

  // ── Compliance Reporter ───────────────────────────────────────────────────
  COMPLIANCE_REPORTER_URL: z.string().url().default("http://compliance-reporter:8104"),

  // ── Crypto Utils ──────────────────────────────────────────────────────────
  CRYPTO_UTILS_URL: z.string().url().default("http://crypto-utils:8202"),
  CRYPTO_MASTER_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i, "Must be 64 hex characters"),
  CRYPTO_HMAC_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i, "Must be 64 hex characters"),

  // ── Rate Limiter ──────────────────────────────────────────────────────────
  RATE_LIMITER_URL: z.string().url().default("http://rate-limiter:8101"),

  // ── Health Probe ──────────────────────────────────────────────────────────
  HEALTH_PROBE_URL: z.string().url().default("http://health-probe:8099"),

  // ── Security ──────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("lax"),

  // ── Feature Flags ─────────────────────────────────────────────────────────
  FEATURE_AML_SCORING: z.coerce.boolean().default(true),
  FEATURE_TIGERBEETLE: z.coerce.boolean().default(true),
  FEATURE_FLUVIO: z.coerce.boolean().default(true),
  FEATURE_LAKEHOUSE_SYNC: z.coerce.boolean().default(true),
  FEATURE_OPENAPPSEC: z.coerce.boolean().default(true),

  // ── Observability ─────────────────────────────────────────────────────────
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default("remitflow-api"),
  OTEL_SERVICE_VERSION: z.string().default("1.0.0"),
  PROMETHEUS_METRICS_PORT: z.coerce.number().int().default(9090),

  // ── Email / Notifications ─────────────────────────────────────────────────
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email().default("noreply@remitflow.com"),
});

// ─── Validation ───────────────────────────────────────────────────────────────

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `  ✗ ${path}: ${issue.message}`;
    });

    console.error("\n╔══════════════════════════════════════════════════════════╗");
    console.error("║     FATAL: Environment variable validation failed         ║");
    console.error("╚══════════════════════════════════════════════════════════╝\n");
    console.error("Missing or invalid environment variables:\n");
    console.error(errors.join("\n"));
    console.error("\nPlease check your .env file or deployment configuration.\n");

    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }

    // In development, warn but continue with defaults
    console.warn("⚠ Running in development mode with missing env vars — some features may be disabled.\n");
  }

  return result.data ?? (envSchema.parse({ ...process.env }) as z.infer<typeof envSchema>);
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;

// ─── Derived Config ───────────────────────────────────────────────────────────

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

export const dbConfig = {
  connectionString: env.DATABASE_URL,
  min: env.DATABASE_POOL_MIN,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
};

export const redisConfig = {
  url: env.REDIS_URL,
  keyPrefix: env.REDIS_KEY_PREFIX,
  defaultTTL: env.REDIS_TTL_DEFAULT_SECONDS,
};

export const keycloakConfig = {
  url: env.KEYCLOAK_URL,
  realm: env.KEYCLOAK_REALM,
  clientId: env.KEYCLOAK_CLIENT_ID,
  clientSecret: env.KEYCLOAK_CLIENT_SECRET,
};

export const temporalConfig = {
  address: env.TEMPORAL_ADDRESS,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: env.TEMPORAL_TASK_QUEUE,
};

export const featureFlags = {
  amlScoring: env.FEATURE_AML_SCORING,
  tigerBeetle: env.FEATURE_TIGERBEETLE,
  fluvio: env.FEATURE_FLUVIO,
  lakehouseSync: env.FEATURE_LAKEHOUSE_SYNC,
  openAppSec: env.FEATURE_OPENAPPSEC,
};
