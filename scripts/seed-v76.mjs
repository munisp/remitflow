/**
 * RemitFlow v76 — Comprehensive Seed Data Script
 * Seeds all new tables introduced in v76 microservices integration
 * Run: node scripts/seed-v76.mjs
 */
import postgres from 'postgres';
import { randomUUID } from "crypto";

const DB_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "3306"),
    user: u.username,
    password: u.password,
    database: u.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
  };
}

async function seed() {
  const sql = postgres(parseDbUrl(DB_URL), { max: 5, idle_timeout: 30 });
// postgres-js helper: simulates postgres2 execute(sql, params) using postgres driver
async function exec(query, params = []) {
  const parts = query.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}
async function query(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}

const conn = { sql };
  console.log("Connected to database");

  try {
    // ─── Microservice Config Table ───────────────────────────────────────────
    await exec(`
      CREATE TABLE IF NOT EXISTS microservice_configs (
        id SERIAL PRIMARY KEY,
        service_name VARCHAR(100) NOT NULL UNIQUE,
        language VARCHAR(20) NOT NULL,
        port INT NOT NULL,
        base_url VARCHAR(255) NOT NULL,
        health_endpoint VARCHAR(100) DEFAULT '/health',
        is_enabled BOOLEAN DEFAULT TRUE,
        version VARCHAR(20) DEFAULT '1.0.0',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const services = [
      ["ngx-price-feed", "go", 8081, "http://ngx-price-feed:8081", "NGX Nigerian Stock Exchange price feed"],
      ["api-gateway", "go", 8082, "http://api-gateway:8082", "Go API Gateway with rate limiting and JWT auth"],
      ["corridor-pricing", "go", 8083, "http://corridor-pricing:8083", "Go corridor pricing engine with FX quotes"],
      ["fx-engine", "rust", 8084, "http://fx-engine:8084", "Rust FX rate engine with rate locking"],
      ["tx-processor", "rust", 8085, "http://tx-processor:8085", "Rust transaction processor with FSM"],
      ["compliance-engine", "rust", 8086, "http://compliance-engine:8086", "Rust compliance engine with watchlist screening"],
      ["fraud-detection", "python", 8087, "http://fraud-detection:8087", "Python ML fraud detection with IsolationForest"],
      ["aml-compliance", "python", 8088, "http://aml-compliance:8088", "Python AML compliance with CTR/SAR automation"],
      ["analytics-engine", "python", 8089, "http://analytics-engine:8089", "Python analytics engine with cohort analysis"],
    ];

    for (const [name, lang, port, url, desc] of services) {
      await exec(
        `INSERT INTO microservice_configs (service_name, language, port, base_url, description)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [name, lang, port, url, desc]
      );
    }
    console.log(`✓ Seeded ${services.length} microservice configs`);

    // ─── FX Rate Locks Table ─────────────────────────────────────────────────
    await exec(`
      CREATE TABLE IF NOT EXISTS fx_rate_locks (
        id SERIAL PRIMARY KEY,
        lock_id VARCHAR(100) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        currency_pair VARCHAR(10) NOT NULL,
        rate DECIMAL(20, 8) NOT NULL,
        amount_base DECIMAL(20, 4) NOT NULL,
        amount_quote DECIMAL(20, 4) NOT NULL,
        fee_percent DECIMAL(5, 4) DEFAULT 0.005,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP NULL,
        status ENUM('active', 'used', 'expired') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ Created fx_rate_locks table");

    // ─── Fraud Scores Table ──────────────────────────────────────────────────
    await exec(`
      CREATE TABLE IF NOT EXISTS fraud_scores (
        id SERIAL PRIMARY KEY,
        score_id VARCHAR(100) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        transaction_id INT NULL,
        risk_score DECIMAL(5, 2) NOT NULL,
        risk_level ENUM('low', 'medium', 'high', 'critical') NOT NULL,
        fraud_probability DECIMAL(6, 4) NOT NULL,
        anomaly_score DECIMAL(6, 4) NOT NULL,
        flags JSON,
        recommendation TEXT,
        model_version VARCHAR(20) DEFAULT '1.0.0',
        scored_at BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ Created fraud_scores table");

    // ─── AML Alerts Table ────────────────────────────────────────────────────
    await exec(`
      CREATE TABLE IF NOT EXISTS aml_alerts (
        id SERIAL PRIMARY KEY,
        alert_id VARCHAR(100) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        transaction_id INT NULL,
        alert_type VARCHAR(100) NOT NULL,
        severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
        triggered_rules JSON,
        description TEXT,
        amount_usd DECIMAL(20, 4),
        ctr_required BOOLEAN DEFAULT FALSE,
        sar_recommended BOOLEAN DEFAULT FALSE,
        status ENUM('open', 'investigating', 'closed', 'escalated') DEFAULT 'open',
        assigned_to INT NULL,
        resolved_at TIMESTAMP NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ Created aml_alerts table");

    // ─── SAR Reports Table ───────────────────────────────────────────────────
    await exec(`
      CREATE TABLE IF NOT EXISTS sar_reports (
        id SERIAL PRIMARY KEY,
        sar_id VARCHAR(100) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        reporter_id INT NOT NULL,
        filing_date DATE NOT NULL,
        suspicious_activity_type VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        amount_usd DECIMAL(20, 4) NOT NULL,
        report_number VARCHAR(100) NOT NULL UNIQUE,
        status ENUM('draft', 'filed', 'acknowledged', 'rejected') DEFAULT 'filed',
        transaction_ids JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ Created sar_reports table");

    // ─── Corridor Analytics Table ────────────────────────────────────────────
    await exec(`
      CREATE TABLE IF NOT EXISTS corridor_analytics_v76 (
        id SERIAL PRIMARY KEY,
        corridor_id VARCHAR(20) NOT NULL,
        source_country CHAR(2) NOT NULL,
        dest_country CHAR(2) NOT NULL,
        source_currency CHAR(3) NOT NULL,
        dest_currency CHAR(3) NOT NULL,
        period_month CHAR(7) NOT NULL,
        transaction_count INT DEFAULT 0,
        volume_usd DECIMAL(20, 4) DEFAULT 0,
        revenue_usd DECIMAL(20, 4) DEFAULT 0,
        avg_fee_percent DECIMAL(5, 4) DEFAULT 0,
        avg_delivery_minutes DECIMAL(8, 2) DEFAULT 0,
        success_rate DECIMAL(5, 4) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_corridor_period (corridor_id, period_month)
      )
    `);

    // Seed corridor analytics
    const corridors = [
      ["US-NG", "US", "NG", "USD", "NGN"],
      ["GB-NG", "GB", "NG", "GBP", "NGN"],
      ["CA-NG", "CA", "NG", "CAD", "NGN"],
      ["US-GH", "US", "GH", "USD", "GHS"],
      ["US-KE", "US", "KE", "USD", "KES"],
    ];

    const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"];
    for (const [cid, sc, dc, scur, dcur] of corridors) {
      for (const month of months) {
        const txCount = Math.floor(Math.random() * 1500) + 200;
        const volume = txCount * (Math.random() * 600 + 150);
        const revenue = volume * (Math.random() * 0.01 + 0.005);
        await exec(
          `INSERT INTO corridor_analytics_v76 
           (corridor_id, source_country, dest_country, source_currency, dest_currency, period_month, transaction_count, volume_usd, revenue_usd, avg_fee_percent, avg_delivery_minutes, success_rate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
          [cid, sc, dc, scur, dcur, month, txCount, volume.toFixed(4), revenue.toFixed(4), 0.005, 18.5, 0.987]
        );
      }
    }
    console.log("✓ Seeded corridor analytics data");

    // ─── Microservice Health Logs ────────────────────────────────────────────
    await exec(`
      CREATE TABLE IF NOT EXISTS microservice_health_logs (
        id SERIAL PRIMARY KEY,
        service_name VARCHAR(100) NOT NULL,
        status ENUM('healthy', 'degraded', 'unavailable') NOT NULL,
        response_time_ms INT,
        error_message TEXT,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_service_checked (service_name, checked_at)
      )
    `);

    // Seed some health logs
    const serviceNames = ["ngx-price-feed", "api-gateway", "corridor-pricing", "fx-engine", "tx-processor", "compliance-engine", "fraud-detection", "aml-compliance", "analytics-engine"];
    for (const svc of serviceNames) {
      await exec(
        `INSERT INTO microservice_health_logs (service_name, status, response_time_ms) VALUES (?, 'healthy', ?)`,
        [svc, Math.floor(Math.random() * 50) + 5]
      );
    }
    console.log("✓ Seeded microservice health logs");

    console.log("\n✅ v76 seed data complete!");
  } catch (err) {
    console.error("Seed error:", err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

seed();
