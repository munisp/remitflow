/**
 * RemitFlow — Permify Bootstrap (P2)
 *
 * Idempotent startup provisioning for the Permify authorization service:
 *   1. Creates the configured tenant (PERMIFY_TENANT_ID) via /v1/tenants/create
 *      — safe to run repeatedly; an existing tenant is reported, not an error.
 *   2. Writes the canonical schema
 *      (infrastructure/integration/permify_policies/remitflow_schema.perm)
 *      via schemas/write and prints the resulting schema_version.
 *
 * Usage:
 *   pnpm tsx scripts/permify-bootstrap.ts
 *
 * Exit codes:
 *   0 — tenant ready and canonical schema written
 *   1 — any step failed. In production deployments this MUST abort the rollout
 *       (run as a job/init-container with a failing exit gating the API pods).
 *
 * Required env:
 *   PERMIFY_URL or PERMIFY_HTTP_URL   e.g. http://permify:3476
 *   PERMIFY_TENANT_ID (or PERMIFY_TENANT)
 * Optional env:
 *   PERMIFY_SCHEMA_PATH               override the canonical schema location
 */

import { bootstrapPermifyTenantAndSchema } from "../server/middleware/permify";

async function main(): Promise<void> {
  const result = await bootstrapPermifyTenantAndSchema();
  // Machine-readable output for CI/rollout scripting.
  console.log(JSON.stringify({ status: "ok", ...result }));
}

main().catch((err) => {
  console.error(
    `[permify-bootstrap] FAILED: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
});
