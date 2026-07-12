import * as z from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.string(),
  APP_HOST: z.string(),
  APP_PORT: z.coerce.number(),
  LOG_PATH: z.string().optional().default("./logs"),
  LOG_LEVEL: z.string().optional().default("info"),
  LOG_SILENT: z.string().optional().default("false"),
  DATABASE_URI: z.string(),
  DAPR_HOST: z.string().optional().default("127.0.0.1"),
  DAPR_HTTP_PORT: z.string().optional().default("3500"),
  // billing-service is not deployed in this platform yet; when unset, billing
  // profile creation is skipped (logged, non-fatal) rather than failing tenant
  // provisioning. Set this once a billing-service exists.
  BILLING_SERVICE_URL: z.string().optional().default(""),
});
