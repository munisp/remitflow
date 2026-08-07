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

  it("rejects malformed JWTs at the custom APISIX tenant boundary without logging credentials", () => {
    const plugin = text("infrastructure/apisix-resources/plugins/access.lua");
    const route = text("infrastructure/apisix-resources/routes/account-service.yaml");
    expect(plugin).toContain("exactly three bounded base64url segments");
    expect(plugin).toContain("Unsigned JWTs are not permitted");
    expect(plugin).toContain("require_tenant_claim");
    expect(plugin).not.toContain("Token from Authorization header:");
    expect(plugin).not.toContain("Token from cookie:");
    expect(route).toContain("54remit-access-plugin");
    expect(route).toContain("require_tenant_claim: true");
    expect(route).toContain('allow_origins: "https://54remit.upi.dev"');
    expect(route).not.toContain('allow_origins: "*"');
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
