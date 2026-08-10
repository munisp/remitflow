import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = (path: string) => readFileSync(path, "utf8");

describe("attached requirements — RemitFlow security and resilience controls", () => {
  it("uses tenant-scoped PostgreSQL reservations for active idempotency", () => {
    const migration = text("drizzle/0078_durable_tenant_idempotency.sql");
    const middleware = text("server/middleware/durableIdempotency.ts");
    const security = text("server/security.middleware.ts");
    expect(migration).toContain("tenant_id");
    expect(migration).toContain("request_hash");
    expect(migration).toContain("lock_expires_at");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(middleware).toContain("FOR UPDATE");
    expect(middleware).toContain("app.current_tenant_id");
    expect(security).toContain("durableIdempotencyMiddleware");
    expect(security).not.toContain("idempotencyCache = new Map");
  });

  it("queues regulatory filings durably with claim, retry, dead-letter, and requeue controls", () => {
    const migration = text("drizzle/0077_regulatory_filing_queue.sql");
    const worker = text("server/services/regulatoryFilingQueue.ts");
    const router = text("server/routers/complianceRouter.ts");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("dead_letter");
    expect(worker).toContain("FOR UPDATE SKIP LOCKED");
    expect(worker).toContain("requeueDeadLetterRegulatoryFiling");
    expect(worker).toContain("incRegulatoryFilingOutcome");
    expect(router).toContain("enqueueRegulatoryFiling");
    expect(router).toContain("requeueDeadLetterRegulatoryFiling");
  });

  it("protects the APISIX /api/* boundary with OIDC, no default admin key, and no foreign-project config", () => {
    const manager = text("services/go-apisix-manager/main.go");
    // OIDC via Keycloak discovery on the bootstrap route, bearer_only for
    // machine endpoints, ssl_verify on by default.
    expect(manager).toContain("openid-connect");
    expect(manager).toContain("KEYCLOAK_DISCOVERY_URL");
    expect(manager).toContain("OIDCBearerOnly");
    expect(manager).toContain(`getEnv("APISIX_OIDC_SSL_VERIFY", "true")`);
    // Fail-fast when the admin key is absent — no hardcoded fallback key.
    expect(manager).toContain("APISIX_ADMIN_KEY is not set");
    expect(manager).not.toContain("edd1c9f034335f136f87ad84b625c8f1");
    // Rate-limit updates must merge, not clobber, route config.
    expect(manager).toContain("GetRoute");
  });

  it("preserves W3C-compatible trace context and regulatory queue metrics", () => {
    const tracing = text("server/middleware/requestId.ts");
    const metrics = text("server/metrics.ts");
    expect(tracing).toContain("traceparent");
    expect(tracing).toContain("TRACEPARENT");
    expect(metrics).toContain("remitflow_regulatory_filing_queue_depth");
    expect(metrics).toContain("remitflow_regulatory_filing_outcomes_total");
  });

  it("renders only tenant-scoped operational geography through an audited admin route", () => {
    const migration = text("drizzle/0079_operational_geospatial.sql");
    const router = text("server/routers/operationsMap.ts");
    const page = text("uis/pwa/src/pages/OperationsMap.tsx");
    const app = text("uis/pwa/src/App.tsx");
    expect(migration).toContain("operational_geo_locations");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(router).toContain("auditedAdminProcedure");
    expect(router).toContain("app.current_tenant_id");
    expect(page).toContain("maplibre-gl");
    expect(page).not.toContain("John Doe");
    expect(app).toContain("AdminRoute");
  });

  it("defines immutable, cross-region backup and isolated restore-drill guardrails", () => {
    const terraform = text("terraform/modules/backup-dr/main.tf");
    const backup = text("services/backup-runner/backup.sh");
    const restore = text("services/backup-runner/restore-drill.sh");
    expect(terraform).toContain("object_lock_enabled = true");
    expect(terraform).toContain("aws_s3_bucket_replication_configuration");
    expect(terraform).toContain("COMPLIANCE");
    expect(backup).toContain("--object-lock-mode COMPLIANCE");
    expect(backup).toContain("sha256sum");
    expect(restore).toContain("RESTORE_TO_ISOLATED_ENVIRONMENT");
    expect(restore).toContain("Refusing a restore target URL");
  });
});
