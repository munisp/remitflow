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
