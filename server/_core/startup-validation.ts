/**
 * Startup Environment Validation
 *
 * Validates that all required environment variables are present before
 * the server starts accepting traffic. Fails fast with a clear error message.
 */
import { logger } from "./logger";

const REQUIRED_ENV_VARS: string[] = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "REGULATORY_FILING_MAX_ATTEMPTS",
  "REGULATORY_FILING_BACKOFF_MS",
  "REGULATORY_FILING_HTTP_TIMEOUT_MS",
  "REGULATORY_FILING_LOCK_SECONDS",
  "REGULATORY_FILING_BATCH_SIZE",
  "REGULATORY_FILING_RETRY_INTERVAL_MS",
  "IDEMPOTENCY_TTL_HOURS",
  "IDEMPOTENCY_LOCK_SECONDS",
];

const WARN_ENV_VARS: string[] = [
  "KEYCLOAK_URL",
  "KAFKA_BROKERS",
  "REDIS_URL",
  "TEMPORAL_ADDRESS",
  "TIGERBEETLE_CLUSTER_ID",
  "PERMIFY_ENDPOINT",
  "OPENSEARCH_URL",
  "OLLAMA_URL",
];

export function requireValidEnv(): void {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // SEC-01: session cookies are signed with JWT_SECRET (env.ts cookieSecret).
  // Require it in production so the insecure dev fallback can never be reached.
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    missing.push("JWT_SECRET");
  }

  if (missing.length > 0) {
    const msg = `[startup-validation] FATAL: Missing required environment variables: ${missing.join(", ")}`;
    logger.error(msg);
    throw new Error(msg);
  }

  const warnings: string[] = [];
  for (const key of WARN_ENV_VARS) {
    if (!process.env[key]) {
      warnings.push(key);
    }
  }

  if (warnings.length > 0) {
    logger.warn(
      `[startup-validation] WARNING: Optional env vars not set (features may be degraded): ${warnings.join(", ")}`
    );
  }

  logger.info("[startup-validation] Environment validation passed.");
}
