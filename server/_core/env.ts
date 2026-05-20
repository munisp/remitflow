export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Email (Resend)
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@remitflow.app",
  // Application URL (used in email templates and links)
  appUrl: process.env.APP_URL ?? "https://remitflow.app",
  // Keycloak OIDC (replaces Manus OAuth)
  keycloakUrl: process.env.KEYCLOAK_URL ?? "",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "remitflow",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "remitflow-app",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
  // PayPal (sandbox defaults — replace with live keys in Settings → Payment)
  paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "AZDxjDScFpQtjWTOUtWKbyN_bDt4OgqaF4eYXlewfBP4-8ER52XW2a0R1oJkpxGMFqFJOHBDGbIV",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "EGnHDxD_qRPbzbTKOuAtjMznV2yZo9aHZu30L7mevsVor53fwdregYkVvRGepqSm",
  paypalBaseUrl: process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
  // Flutterwave (test defaults — replace with live keys in Settings → Payment)
  flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? "FLWSECK_TEST-SANDBOXDEMOKEY-X",
  flutterwavePublicKey: process.env.FLUTTERWAVE_PUBLIC_KEY ?? "FLWPUBK_TEST-SANDBOXDEMOKEY-X",
  flutterwaveBaseUrl: process.env.FLUTTERWAVE_BASE_URL ?? "https://api.flutterwave.com/v3",
};
