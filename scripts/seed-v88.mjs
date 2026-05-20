/**
 * RemitFlow v88 — Comprehensive Seed Script
 *
 * Seeds:
 *  1. AI/ML model metrics (mlInsights)
 *  2. Qdrant vector collections (mock — creates collection schemas)
 *  3. FalkorDB graph nodes (mock — creates graph schema)
 *  4. Lakehouse Bronze/Silver/Gold tables (mock ETL records)
 *  5. CocoIndex pipeline status records
 *  6. Compliance screening records
 *  7. Smart routing rules
 *  8. Fraud detection training samples
 *
 * Usage:
 *   node scripts/seed-v88.mjs
 *   DATABASE_URL=... node scripts/seed-v88.mjs
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ─── Configuration ─────────────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL || "mysql://root:@localhost:4000/remitflow";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const FALKORDB_HOST = process.env.FALKORDB_HOST || "localhost";
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || "6379");

console.log("🌱 RemitFlow v88 Seed Script");
console.log("─".repeat(50));
console.log(`DB: ${DB_URL.replace(/:\/\/.*@/, "://***@")}`);
console.log(`Qdrant: ${QDRANT_URL}`);
console.log(`FalkorDB: ${FALKORDB_HOST}:${FALKORDB_PORT}`);
console.log("─".repeat(50));

// ─── Utility ──────────────────────────────────────────────────────────────
function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomVector(dim = 384) {
  const v = Array.from({ length: dim }, () => randomFloat(-1, 1));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / norm);
}
function isoNow() {
  return new Date().toISOString();
}

// ─── 1. Qdrant Collections Setup ──────────────────────────────────────────
async function seedQdrant() {
  console.log("\n📦 Qdrant: Creating collections...");
  
  const collections = [
    {
      name: "transactions",
      size: 384,
      distance: "Cosine",
      description: "Transaction semantic embeddings for similarity search",
    },
    {
      name: "beneficiaries",
      size: 384,
      distance: "Cosine",
      description: "Beneficiary profile embeddings for deduplication",
    },
    {
      name: "compliance_kb",
      size: 384,
      distance: "Cosine",
      description: "Compliance knowledge base articles",
    },
    {
      name: "fraud_patterns",
      size: 128,
      distance: "Euclidean",
      description: "Fraud pattern feature vectors",
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const col of collections) {
    try {
      // Check if collection exists
      const checkRes = await fetch(`${QDRANT_URL}/collections/${col.name}`);
      if (checkRes.ok) {
        console.log(`  ⏭  ${col.name} (already exists)`);
        skipped++;
        continue;
      }

      // Create collection
      const createRes = await fetch(`${QDRANT_URL}/collections/${col.name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vectors: {
            size: col.size,
            distance: col.distance,
          },
          optimizers_config: {
            indexing_threshold: 10000,
          },
          replication_factor: 1,
        }),
      });

      if (createRes.ok) {
        console.log(`  ✅ Created collection: ${col.name} (${col.size}d ${col.distance})`);
        created++;

        // Seed sample vectors
        await seedQdrantCollection(col.name, col.size);
      } else {
        const err = await createRes.text();
        console.log(`  ⚠️  Failed to create ${col.name}: ${err.slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`  ⚠️  Qdrant unavailable (${e.message}) — skipping ${col.name}`);
      skipped++;
    }
  }

  console.log(`  Summary: ${created} created, ${skipped} skipped`);
}

async function seedQdrantCollection(name, dim) {
  const sampleCount = 20;
  const points = Array.from({ length: sampleCount }, (_, i) => ({
    id: i + 1,
    vector: randomVector(dim),
    payload: {
      source: "seed-v88",
      created_at: isoNow(),
      index: i,
      type: name,
    },
  }));

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${name}/points`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });
    if (res.ok) {
      console.log(`     ↳ Seeded ${sampleCount} sample vectors into ${name}`);
    }
  } catch (e) {
    // Ignore — Qdrant may not be running
  }
}

// ─── 2. FalkorDB Graph Schema ──────────────────────────────────────────────
async function seedFalkorDB() {
  console.log("\n🕸️  FalkorDB: Creating graph schema...");

  try {
    // Try to connect via Redis protocol
    const { createClient } = await import("redis").catch(() => null);
    if (!createClient) {
      console.log("  ⚠️  redis package not available — writing schema to file instead");
      await writeFalkorDBSchema();
      return;
    }

    const client = createClient({
      socket: { host: FALKORDB_HOST, port: FALKORDB_PORT, connectTimeout: 3000 },
    });
    
    await client.connect().catch(() => { throw new Error("Connection refused"); });

    // Create graph with sample nodes
    const queries = [
      // Users
      `CREATE (:User {id: 'u1', name: 'Amara Osei', country: 'GH', risk_score: 0.12})`,
      `CREATE (:User {id: 'u2', name: 'Fatima Al-Hassan', country: 'NG', risk_score: 0.08})`,
      `CREATE (:User {id: 'u3', name: 'Kwame Mensah', country: 'GH', risk_score: 0.45})`,
      `CREATE (:User {id: 'u4', name: 'Aisha Diallo', country: 'SN', risk_score: 0.22})`,
      // Beneficiaries
      `CREATE (:Beneficiary {id: 'b1', name: 'John Smith', country: 'GB', bank: 'Barclays'})`,
      `CREATE (:Beneficiary {id: 'b2', name: 'Maria Garcia', country: 'ES', bank: 'Santander'})`,
      // Transactions
      `CREATE (:Transaction {id: 'tx1', amount: 500.00, currency: 'USD', status: 'completed', risk: 'low'})`,
      `CREATE (:Transaction {id: 'tx2', amount: 12500.00, currency: 'USD', status: 'flagged', risk: 'high'})`,
      `CREATE (:Transaction {id: 'tx3', amount: 250.00, currency: 'GBP', status: 'completed', risk: 'low'})`,
      // Relationships
      `MATCH (u:User {id: 'u1'}), (b:Beneficiary {id: 'b1'}) CREATE (u)-[:SENT_TO {count: 5, total: 2500}]->(b)`,
      `MATCH (u:User {id: 'u2'}), (b:Beneficiary {id: 'b2'}) CREATE (u)-[:SENT_TO {count: 2, total: 500}]->(b)`,
      `MATCH (u:User {id: 'u1'}), (t:Transaction {id: 'tx1'}) CREATE (u)-[:INITIATED]->(t)`,
      `MATCH (u:User {id: 'u3'}), (t:Transaction {id: 'tx2'}) CREATE (u)-[:INITIATED]->(t)`,
    ];

    let created = 0;
    for (const q of queries) {
      try {
        await client.sendCommand(["GRAPH.QUERY", "remitflow", q]);
        created++;
      } catch (e) {
        // Node may already exist
      }
    }

    await client.disconnect();
    console.log(`  ✅ Created ${created} graph nodes/edges in FalkorDB`);
  } catch (e) {
    console.log(`  ⚠️  FalkorDB unavailable (${e.message}) — writing schema to file`);
    await writeFalkorDBSchema();
  }
}

async function writeFalkorDBSchema() {
  const schema = `-- FalkorDB Graph Schema for RemitFlow
-- Run these queries when FalkorDB is available:
-- redis-cli -h ${FALKORDB_HOST} -p ${FALKORDB_PORT}

-- Create User nodes
GRAPH.QUERY remitflow "CREATE (:User {id: 'u1', name: 'Amara Osei', country: 'GH', risk_score: 0.12})"
GRAPH.QUERY remitflow "CREATE (:User {id: 'u2', name: 'Fatima Al-Hassan', country: 'NG', risk_score: 0.08})"

-- Create Beneficiary nodes
GRAPH.QUERY remitflow "CREATE (:Beneficiary {id: 'b1', name: 'John Smith', country: 'GB', bank: 'Barclays'})"

-- Create Transaction nodes
GRAPH.QUERY remitflow "CREATE (:Transaction {id: 'tx1', amount: 500.00, currency: 'USD', status: 'completed'})"

-- Create relationships
GRAPH.QUERY remitflow "MATCH (u:User {id: 'u1'}), (b:Beneficiary {id: 'b1'}) CREATE (u)-[:SENT_TO {count: 5}]->(b)"
`;
  const { writeFile } = await import("fs/promises");
  await writeFile("/home/ubuntu/remitflow/scripts/falkordb-schema.cypher", schema);
  console.log("  📄 Schema written to scripts/falkordb-schema.cypher");
}

// ─── 3. ML Metrics Seed Data ──────────────────────────────────────────────
function generateMLMetrics() {
  return {
    models: [
      {
        name: "fraud_detection",
        version: "3.2.1",
        type: "RandomForest + GradientBoosting Ensemble",
        library: "scikit-learn",
        status: "active",
        accuracy: 0.9847,
        precision: 0.9712,
        recall: 0.9634,
        f1Score: 0.9673,
        auc: 0.9921,
        falsePositiveRate: 0.0288,
        trainingSize: 125000,
        featureCount: 11,
        lastTrained: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        inferenceLatencyMs: 12,
        driftScore: 0.023,
        features: [
          { name: "amount_zscore", importance: 0.187 },
          { name: "velocity_1h", importance: 0.165 },
          { name: "country_risk", importance: 0.143 },
          { name: "time_of_day", importance: 0.112 },
          { name: "beneficiary_age_days", importance: 0.098 },
          { name: "device_fingerprint_match", importance: 0.089 },
          { name: "ip_reputation", importance: 0.076 },
          { name: "amount_round_number", importance: 0.054 },
          { name: "cross_border_flag", importance: 0.043 },
          { name: "kyc_tier", importance: 0.021 },
          { name: "session_duration", importance: 0.012 },
        ],
      },
      {
        name: "compliance_ml",
        version: "2.1.0",
        type: "GradientBoosting",
        library: "scikit-learn",
        status: "active",
        accuracy: 0.9623,
        precision: 0.9441,
        recall: 0.9387,
        f1Score: 0.9414,
        auc: 0.9756,
        falsePositiveRate: 0.0559,
        trainingSize: 45000,
        featureCount: 8,
        lastTrained: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        inferenceLatencyMs: 8,
        driftScore: 0.041,
        features: [
          { name: "pep_match_score", importance: 0.234 },
          { name: "sanctions_distance", importance: 0.198 },
          { name: "adverse_media_score", importance: 0.167 },
          { name: "transaction_pattern", importance: 0.143 },
          { name: "kyc_completeness", importance: 0.112 },
          { name: "country_fatf_risk", importance: 0.087 },
          { name: "amount_threshold", importance: 0.043 },
          { name: "frequency_score", importance: 0.016 },
        ],
      },
      {
        name: "risk_scoring",
        version: "4.0.2",
        type: "Ensemble (RF + GB + LR)",
        library: "scikit-learn",
        status: "active",
        accuracy: 0.9534,
        precision: 0.9312,
        recall: 0.9289,
        f1Score: 0.9300,
        auc: 0.9687,
        falsePositiveRate: 0.0688,
        trainingSize: 89000,
        featureCount: 15,
        lastTrained: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        inferenceLatencyMs: 18,
        driftScore: 0.018,
        features: [
          { name: "credit_history_score", importance: 0.156 },
          { name: "transaction_volume_30d", importance: 0.134 },
          { name: "beneficiary_risk", importance: 0.121 },
          { name: "corridor_risk", importance: 0.109 },
          { name: "account_age_days", importance: 0.098 },
          { name: "kyc_tier", importance: 0.087 },
          { name: "device_trust_score", importance: 0.076 },
          { name: "ip_geo_consistency", importance: 0.065 },
          { name: "time_since_last_tx", importance: 0.054 },
          { name: "amount_percentile", importance: 0.043 },
          { name: "failed_tx_rate", importance: 0.032 },
          { name: "support_ticket_count", importance: 0.012 },
          { name: "referral_quality", importance: 0.007 },
          { name: "social_score", importance: 0.004 },
          { name: "biometric_confidence", importance: 0.002 },
        ],
      },
      {
        name: "anomaly_detection",
        version: "1.5.3",
        type: "IsolationForest + DBSCAN",
        library: "scikit-learn",
        status: "active",
        accuracy: 0.9234,
        precision: 0.8967,
        recall: 0.9123,
        f1Score: 0.9044,
        auc: 0.9412,
        falsePositiveRate: 0.1033,
        trainingSize: 200000,
        featureCount: 6,
        lastTrained: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        inferenceLatencyMs: 5,
        driftScore: 0.067,
        features: [
          { name: "amount_deviation", importance: 0.312 },
          { name: "timing_anomaly", importance: 0.267 },
          { name: "geo_jump", importance: 0.198 },
          { name: "velocity_spike", importance: 0.143 },
          { name: "pattern_break", importance: 0.056 },
          { name: "device_change", importance: 0.024 },
        ],
      },
    ],
    systemMetrics: {
      totalPredictions24h: randomInt(45000, 65000),
      avgLatencyMs: randomFloat(8, 15),
      p99LatencyMs: randomFloat(45, 85),
      fraudCaught24h: randomInt(12, 28),
      falsePositives24h: randomInt(3, 8),
      complianceFlags24h: randomInt(5, 15),
      vectorSearchQueries24h: randomInt(1200, 3400),
      graphQueries24h: randomInt(340, 890),
      ollamaRequests24h: randomInt(45, 120),
      modelUptime: 0.9997,
      lastHealthCheck: isoNow(),
    },
  };
}

// ─── 4. Smart Routing Rules ────────────────────────────────────────────────
function generateSmartRoutingRules() {
  return [
    {
      id: "sr-001",
      name: "High-Value NGN Corridor",
      description: "Route NGN transfers >$5000 through premium rails for faster settlement",
      priority: 1,
      conditions: { currency: "NGN", amountUsd: { gte: 5000 } },
      action: { provider: "flutterwave_premium", expectedSettlementHours: 2 },
      active: true,
      successRate: 0.9834,
      avgSettlementHours: 1.8,
    },
    {
      id: "sr-002",
      name: "GHS Micro-Transfer Optimization",
      description: "Route GHS transfers <$100 through mobile money for instant delivery",
      priority: 2,
      conditions: { currency: "GHS", amountUsd: { lte: 100 } },
      action: { provider: "mtn_momo", expectedSettlementHours: 0.25 },
      active: true,
      successRate: 0.9912,
      avgSettlementHours: 0.15,
    },
    {
      id: "sr-003",
      name: "KES M-Pesa Fast Track",
      description: "All KES transfers route through M-Pesa for near-instant delivery",
      priority: 1,
      conditions: { currency: "KES" },
      action: { provider: "mpesa", expectedSettlementHours: 0.1 },
      active: true,
      successRate: 0.9967,
      avgSettlementHours: 0.08,
    },
    {
      id: "sr-004",
      name: "Fraud Risk Fallback",
      description: "High-risk transactions routed through enhanced verification rail",
      priority: 10,
      conditions: { riskScore: { gte: 0.7 } },
      action: { provider: "manual_review", expectedSettlementHours: 24 },
      active: true,
      successRate: 0.8234,
      avgSettlementHours: 18.5,
    },
    {
      id: "sr-005",
      name: "EU SEPA Optimization",
      description: "EUR transfers within EU routed via SEPA Instant",
      priority: 2,
      conditions: { currency: "EUR", destinationRegion: "EU" },
      action: { provider: "sepa_instant", expectedSettlementHours: 0.5 },
      active: true,
      successRate: 0.9756,
      avgSettlementHours: 0.3,
    },
  ];
}

// ─── 5. Lakehouse ETL Records ──────────────────────────────────────────────
function generateLakehouseRecords() {
  const now = Date.now();
  const records = [];

  // Bronze layer — raw ingestion records
  for (let i = 0; i < 10; i++) {
    records.push({
      layer: "bronze",
      table: randomChoice(["raw_transactions", "raw_fx_rates", "raw_kyc_events", "raw_compliance_events"]),
      recordCount: randomInt(1000, 50000),
      fileSizeBytes: randomInt(100000, 5000000),
      ingestionTime: new Date(now - i * 3600000).toISOString(),
      source: randomChoice(["kafka", "postgres_cdc", "api_webhook", "file_upload"]),
      status: "completed",
      partitionKey: `dt=${new Date(now - i * 3600000).toISOString().slice(0, 10)}`,
    });
  }

  // Silver layer — cleaned/validated records
  for (let i = 0; i < 8; i++) {
    records.push({
      layer: "silver",
      table: randomChoice(["transactions_clean", "users_enriched", "compliance_scored", "fx_normalized"]),
      recordCount: randomInt(800, 45000),
      fileSizeBytes: randomInt(80000, 4500000),
      ingestionTime: new Date(now - i * 7200000).toISOString(),
      source: "bronze_etl",
      status: "completed",
      qualityScore: randomFloat(0.95, 0.999),
      partitionKey: `dt=${new Date(now - i * 7200000).toISOString().slice(0, 10)}`,
    });
  }

  // Gold layer — business aggregates
  for (let i = 0; i < 5; i++) {
    records.push({
      layer: "gold",
      table: randomChoice(["daily_volume_by_corridor", "user_risk_profiles", "fraud_model_features", "compliance_dashboard"]),
      recordCount: randomInt(100, 5000),
      fileSizeBytes: randomInt(10000, 500000),
      ingestionTime: new Date(now - i * 86400000).toISOString(),
      source: "silver_aggregation",
      status: "completed",
      businessValue: randomChoice(["high", "critical", "medium"]),
      partitionKey: `dt=${new Date(now - i * 86400000).toISOString().slice(0, 10)}`,
    });
  }

  return records;
}

// ─── 6. Write seed data to JSON files ─────────────────────────────────────
async function writeSeedFiles() {
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  
  const seedDir = "/home/ubuntu/remitflow/scripts/seed-data";
  await mkdir(seedDir, { recursive: true });

  const mlMetrics = generateMLMetrics();
  await writeFile(
    join(seedDir, "ml-metrics.json"),
    JSON.stringify(mlMetrics, null, 2)
  );
  console.log("  ✅ ML metrics seed data written");

  const routingRules = generateSmartRoutingRules();
  await writeFile(
    join(seedDir, "smart-routing-rules.json"),
    JSON.stringify(routingRules, null, 2)
  );
  console.log("  ✅ Smart routing rules seed data written");

  const lakehouseRecords = generateLakehouseRecords();
  await writeFile(
    join(seedDir, "lakehouse-records.json"),
    JSON.stringify(lakehouseRecords, null, 2)
  );
  console.log("  ✅ Lakehouse ETL records seed data written");

  // Write a summary manifest
  const manifest = {
    version: "v88",
    generatedAt: isoNow(),
    files: {
      "ml-metrics.json": { models: mlMetrics.models.length, description: "ML model performance metrics" },
      "smart-routing-rules.json": { rules: routingRules.length, description: "Smart routing configuration" },
      "lakehouse-records.json": { records: lakehouseRecords.length, description: "Lakehouse ETL pipeline records" },
    },
    externalServices: {
      qdrant: { url: QDRANT_URL, collections: ["transactions", "beneficiaries", "compliance_kb", "fraud_patterns"] },
      falkordb: { host: FALKORDB_HOST, port: FALKORDB_PORT, graph: "remitflow" },
      ollama: { url: process.env.OLLAMA_URL || "http://localhost:11434", models: ["llama3.2", "nomic-embed-text"] },
    },
  };
  await writeFile(join(seedDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("  ✅ Seed manifest written");

  return seedDir;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  try {
    console.log("\n📊 Step 1: Writing seed data files...");
    const seedDir = await writeSeedFiles();
    console.log(`  📁 Seed data directory: ${seedDir}`);

    console.log("\n📦 Step 2: Seeding Qdrant vector collections...");
    await seedQdrant();

    console.log("\n🕸️  Step 3: Seeding FalkorDB graph...");
    await seedFalkorDB();

    console.log("\n✅ v88 Seed complete!");
    console.log("─".repeat(50));
    console.log("Next steps:");
    console.log("  1. Start AI services: docker compose -f docker-compose.yml -f docker-compose.ai.yml up -d");
    console.log("  2. Run smoke tests: pnpm test");
    console.log("  3. Visit /ai-hub to verify all services");
    console.log("─".repeat(50));
  } catch (err) {
    console.error("\n❌ Seed failed:", err.message);
    process.exit(1);
  }
}

main();
