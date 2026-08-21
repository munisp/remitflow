// ── Environment Configuration ────────────────────────────────────────────────
// Production-critical vars MUST be set via environment. No secrets in source.
//
// Required in production:
//   DATABASE_URL           — PostgreSQL connection string
//   JWT_SECRET             — Cookie/session signing secret (min 32 chars)
//   OPENAI_API_BASE_URL    — OpenAI-compatible LLM endpoint (e.g. https://api.openai.com/v1)
//   OPENAI_API_KEY         — API key for the LLM provider
//   RESEND_API_KEY         — Transactional email via Resend
//   KEYCLOAK_URL           — Keycloak server URL
//   KEYCLOAK_CLIENT_SECRET — Keycloak client secret
//   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET
//   FLUTTERWAVE_SECRET_KEY / FLUTTERWAVE_PUBLIC_KEY
//
// Optional:
//   STORAGE_ENDPOINT       — S3-compatible endpoint for static assets
//   STORAGE_BUCKET         — S3 bucket name
//   APP_URL                — Public URL of the app (default: https://remitflow.app)
//   REMITFLOW_PRODUCTION_DOMAIN — Production domain for CORS (default: remitflow.app)

const isProduction = process.env.NODE_ENV === "production";

function requireInProduction(name: string, fallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction && !fallback) {
    throw new Error(`FATAL: Required environment variable ${name} is not set in production`);
  }
  return fallback;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  // SEC-01: no usable fallback in production — an unset JWT_SECRET aborts boot
  // rather than signing session cookies with a publicly known secret.
  cookieSecret: requireInProduction("JWT_SECRET", isProduction ? "" : "dev-only-insecure-secret"),
  databaseUrl: requireInProduction("DATABASE_URL", ""),
  oAuthServerUrl: requireInProduction("OAUTH_SERVER_URL", ""),
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  // LLM (OpenAI-compatible). Set OPENAI_API_BASE_URL to point to any compatible provider.
  forgeApiUrl: process.env.OPENAI_API_BASE_URL ?? "",
  forgeApiKey: process.env.OPENAI_API_KEY ?? "",
  // Email (Resend)
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@remitflow.app",
  // Application URL (used in email templates and links)
  appUrl: process.env.APP_URL ?? "https://remitflow.app",
  // Keycloak OIDC
  keycloakUrl: requireInProduction("KEYCLOAK_URL", ""),
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "remitflow",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "remitflow-app",
  keycloakClientSecret: requireInProduction("KEYCLOAK_CLIENT_SECRET", ""),
  // PayPal — MUST be set via environment. No sandbox keys in source.
  paypalClientId: requireInProduction("PAYPAL_CLIENT_ID", ""),
  paypalClientSecret: requireInProduction("PAYPAL_CLIENT_SECRET", ""),
  paypalBaseUrl: process.env.PAYPAL_BASE_URL ?? (isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"),
  // Flutterwave — MUST be set via environment. No test keys in source.
  flutterwaveSecretKey: requireInProduction("FLUTTERWAVE_SECRET_KEY", ""),
  flutterwavePublicKey: requireInProduction("FLUTTERWAVE_PUBLIC_KEY", ""),
  flutterwaveBaseUrl: process.env.FLUTTERWAVE_BASE_URL ?? "https://api.flutterwave.com/v3",
};
