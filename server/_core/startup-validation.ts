/**
 * startup-validation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates environment variables at server startup.
 * - CRITICAL vars: server refuses to start if missing
 * - IMPORTANT vars: warning logged, feature degraded
 * - OPTIONAL vars: info log only
 *
 * Call validateEnvAtStartup() as the first thing in server/index.ts.
 */

interface EnvSpec {
  key: string;
  level: "critical" | "important" | "optional";
  description: string;
}

const ENV_SPECS: EnvSpec[] = [
  // ── Core platform ──────────────────────────────────────────────────────────
  { key: "DATABASE_URL",           level: "critical",  description: "PostgreSQL connection string" },
  { key: "JWT_SECRET",             level: "critical",  description: "Session cookie signing secret" },
  { key: "VITE_APP_ID",            level: "critical",  description: "Manus OAuth application ID" },
  { key: "OAUTH_SERVER_URL",       level: "critical",  description: "Manus OAuth backend URL" },
  { key: "BUILT_IN_FORGE_API_KEY", level: "critical",  description: "Manus built-in API bearer token" },
  { key: "BUILT_IN_FORGE_API_URL", level: "critical",  description: "Manus built-in API base URL" },

  // ── Stripe ─────────────────────────────────────────────────────────────────
  { key: "STRIPE_SECRET_KEY",         level: "important", description: "Stripe secret key (payments disabled without this)" },
  { key: "STRIPE_WEBHOOK_SECRET",     level: "important", description: "Stripe webhook signing secret" },
  { key: "VITE_STRIPE_PUBLISHABLE_KEY", level: "important", description: "Stripe publishable key (frontend)" },

  // ── KYC providers ──────────────────────────────────────────────────────────
  { key: "ONFIDO_API_TOKEN",       level: "important", description: "Onfido KYC API token" },
  { key: "ONFIDO_WEBHOOK_SECRET",  level: "important", description: "Onfido webhook HMAC secret" },
  { key: "SUMSUB_APP_TOKEN",       level: "important", description: "Sumsub KYC app token" },
  { key: "SUMSUB_SECRET_KEY",      level: "important", description: "Sumsub KYC secret key" },
  { key: "SUMSUB_WEBHOOK_SECRET",  level: "important", description: "Sumsub webhook HMAC secret" },
  { key: "VERIFF_API_KEY",         level: "important", description: "Veriff KYC API key" },
  { key: "VERIFF_WEBHOOK_SECRET",  level: "important", description: "Veriff webhook HMAC secret" },

  // ── Payment rails ──────────────────────────────────────────────────────────
  { key: "PAYPAL_CLIENT_ID",       level: "important", description: "PayPal client ID" },
  { key: "PAYPAL_CLIENT_SECRET",   level: "important", description: "PayPal client secret" },
  { key: "FLUTTERWAVE_SECRET_KEY", level: "important", description: "Flutterwave secret key" },
  { key: "FLUTTERWAVE_PUBLIC_KEY", level: "important", description: "Flutterwave public key" },

  // ── Notifications ──────────────────────────────────────────────────────────
  { key: "RESEND_API_KEY",            level: "important", description: "Resend email API key" },
  { key: "AFRICAS_TALKING_API_KEY",   level: "important", description: "Africa's Talking SMS API key" },
  { key: "AFRICAS_TALKING_USERNAME",  level: "important", description: "Africa's Talking username" },

  // ── AML / Compliance microservices ─────────────────────────────────────────
  { key: "AML_ENGINE_URL",         level: "optional",  description: "AML engine microservice URL" },
  { key: "AML_SERVICE_URL",        level: "optional",  description: "AML service URL" },
  { key: "COMPLIANCE_SERVICE_URL", level: "optional",  description: "Python compliance service URL" },
  { key: "SANCTIONS_SERVICE_URL",  level: "optional",  description: "Sanctions screening service URL" },

  // ── Infrastructure ─────────────────────────────────────────────────────────
  { key: "APP_URL",                level: "optional",  description: "Public application URL (used in emails/links)" },
  { key: "GRAFANA_API_KEY",        level: "optional",  description: "Grafana API key for dashboards" },
  { key: "KAFKA_BROKERS",          level: "optional",  description: "Kafka broker list (event streaming)" },
  { key: "REDIS_URL",              level: "optional",  description: "Redis connection URL (caching/rate-limiting)" },
];

export interface ValidationResult {
  passed: boolean;
  critical: string[];
  warnings: string[];
  info: string[];
}

export function validateEnvAtStartup(): ValidationResult {
  const critical: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  for (const spec of ENV_SPECS) {
    const value = process.env[spec.key];
    const missing = !value || value.trim() === "";

    if (missing) {
      if (spec.level === "critical") {
        critical.push(`[CRITICAL] ${spec.key} — ${spec.description}`);
      } else if (spec.level === "important") {
        warnings.push(`[WARN]     ${spec.key} — ${spec.description}`);
      } else {
        info.push(`[INFO]     ${spec.key} — ${spec.description} (optional, feature disabled)`);
      }
    }
  }

  const passed = critical.length === 0;

  if (critical.length > 0) {
    console.error("\n╔══════════════════════════════════════════════════════════════╗");
    console.error("║  STARTUP FAILED — Missing critical environment variables     ║");
    console.error("╚══════════════════════════════════════════════════════════════╝");
    for (const msg of critical) console.error(` ✗ ${msg}`);
    console.error("");
  }

  if (warnings.length > 0) {
    console.warn("\n⚠  Missing important environment variables (features degraded):");
    for (const msg of warnings) console.warn(` ! ${msg}`);
    console.warn("");
  }

  if (info.length > 0 && process.env.NODE_ENV !== "production") {
    console.info("\nℹ  Optional environment variables not set:");
    for (const msg of info) console.info(`   ${msg}`);
    console.info("");
  }

  if (passed && warnings.length === 0) {
    console.info("✓  Environment validation passed — all critical and important vars present.");
  } else if (passed) {
    console.info(`✓  Environment validation passed (${warnings.length} warnings — see above).`);
  }

  return { passed, critical, warnings, info };
}

/**
 * Call this at the very start of server/index.ts.
 * In production, throws if any CRITICAL vars are missing.
 * In development, logs warnings but continues.
 */
export function requireValidEnv(): void {
  const result = validateEnvAtStartup();
  if (!result.passed && process.env.NODE_ENV === "production") {
    throw new Error(
      `Server startup aborted: ${result.critical.length} critical environment variable(s) missing.\n` +
      result.critical.join("\n")
    );
  }
}
