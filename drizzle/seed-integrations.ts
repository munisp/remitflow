/**
 * RemitFlow — Integration Tables Seed Data
 * ──────────────────────────────────────────
 * Seeds initial data for all integration tables:
 *   - APISIX route configurations
 *   - Permify policy audit baseline
 *   - Fluvio consumer group offsets
 *   - Lakehouse sync job baseline
 *   - Temporal execution baseline
 *   - Redis cache audit baseline
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL || "";

async function seedIntegrations() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("Seeding integration tables...");

  // ─── APISIX Route Logs ─────────────────────────────────────────────────────
  const apisixRoutes = [
    { routeId: "route-transfers", path: "/api/transfers", upstreamUrl: "http://remitflow-api:3000" },
    { routeId: "route-kyc", path: "/api/kyc", upstreamUrl: "http://remitflow-api:3000" },
    { routeId: "route-wallets", path: "/api/wallets", upstreamUrl: "http://remitflow-api:3000" },
    { routeId: "route-fx", path: "/api/fx", upstreamUrl: "http://remitflow-api:3000" },
    { routeId: "route-compliance", path: "/api/compliance", upstreamUrl: "http://remitflow-api:3000" },
  ];

  for (const route of apisixRoutes) {
    await db.insert(schema.apisixRouteLogs).values(route).onConflictDoNothing();
  }
  console.log(`✓ Seeded ${apisixRoutes.length} APISIX route logs`);

  // ─── Fluvio Consumer Offsets ───────────────────────────────────────────────
  const fluvioOffsets = [
    { topic: "transfer-events", partition: 0, consumerGroup: "compliance-consumer", offset: BigInt(0) },
    { topic: "kyc-events", partition: 0, consumerGroup: "kyc-consumer", offset: BigInt(0) },
    { topic: "fraud-events", partition: 0, consumerGroup: "fraud-consumer", offset: BigInt(0) },
    { topic: "audit-events", partition: 0, consumerGroup: "audit-consumer", offset: BigInt(0) },
    { topic: "settlement-events", partition: 0, consumerGroup: "settlement-consumer", offset: BigInt(0) },
  ];

  for (const offset of fluvioOffsets) {
    await db.insert(schema.fluvioOffsets).values(offset).onConflictDoNothing();
  }
  console.log(`✓ Seeded ${fluvioOffsets.length} Fluvio consumer offsets`);

  // ─── Lakehouse Sync Jobs ───────────────────────────────────────────────────
  const lakehouseSyncJobs = [
    { tableName: "transactions", lastSyncId: BigInt(0), status: "idle", recordsSynced: 0 },
    { tableName: "kyc_documents", lastSyncId: BigInt(0), status: "idle", recordsSynced: 0 },
    { tableName: "compliance_cases", lastSyncId: BigInt(0), status: "idle", recordsSynced: 0 },
    { tableName: "audit_logs", lastSyncId: BigInt(0), status: "idle", recordsSynced: 0 },
    { tableName: "fraud_alerts", lastSyncId: BigInt(0), status: "idle", recordsSynced: 0 },
  ];

  for (const job of lakehouseSyncJobs) {
    await db.insert(schema.lakehouseSyncJobs).values(job).onConflictDoNothing();
  }
  console.log(`✓ Seeded ${lakehouseSyncJobs.length} Lakehouse sync jobs`);

  // ─── Redis Cache Audit Baseline ────────────────────────────────────────────
  const redisCachePatterns = [
    { keyPattern: "fx:rate:*", operation: "set", hitCount: 0, missCount: 0 },
    { keyPattern: "session:*", operation: "set", hitCount: 0, missCount: 0 },
    { keyPattern: "kyc:status:*", operation: "set", hitCount: 0, missCount: 0 },
    { keyPattern: "idempotency:*", operation: "set", hitCount: 0, missCount: 0 },
    { keyPattern: "compliance:*", operation: "set", hitCount: 0, missCount: 0 },
  ];

  for (const pattern of redisCachePatterns) {
    await db.insert(schema.redisCacheAudit).values(pattern).onConflictDoNothing();
  }
  console.log(`✓ Seeded ${redisCachePatterns.length} Redis cache audit patterns`);

  await client.end();
  console.log("✓ Integration seed completed");
}

seedIntegrations().catch(console.error);
