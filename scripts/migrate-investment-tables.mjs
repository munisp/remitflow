#!/usr/bin/env node
/**
 * RemitFlow v49 — Investment Tables Migration (PostgreSQL)
 * Creates investment_assets, user_investments, investment_watchlist, investment_orders
 */
import "dotenv/config";
import postgres from 'postgres';

const DB_URL = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulate mysql2 execute(sql, params)
async function exec(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}

const conn = { sql };
console.log("✅ Connected to database");

const tables = [
  // Investment Assets (stocks, ETFs, commodities, crypto, mining shares, real estate, bonds)
  `CREATE TABLE IF NOT EXISTS investment_assets (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    asset_type ENUM('stock','etf','commodity','crypto','mining_share','real_estate','bond','index_fund') NOT NULL,
    exchange VARCHAR(50),
    country VARCHAR(64),
    sector VARCHAR(100),
    current_price DECIMAL(18,6) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    price_change_24h DECIMAL(10,4) DEFAULT 0,
    price_change_pct_24h DECIMAL(10,4) DEFAULT 0,
    market_cap DECIMAL(24,2),
    volume_24h DECIMAL(24,2),
    description TEXT,
    logo_url TEXT,
    min_investment DECIMAL(18,2) DEFAULT 10.00,
    is_active TINYINT(1) DEFAULT 1,
    is_featured TINYINT(1) DEFAULT 0,
    tags JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // User Investments (portfolio holdings)
  `CREATE TABLE IF NOT EXISTS user_investments (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    asset_id INT NOT NULL,
    status ENUM('pending','active','sold','cancelled','matured') DEFAULT 'active',
    quantity DECIMAL(18,8) NOT NULL,
    purchase_price DECIMAL(18,6) NOT NULL,
    current_value DECIMAL(18,2),
    currency VARCHAR(10) DEFAULT 'USD',
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sold_at TIMESTAMP NULL,
    sold_price DECIMAL(18,6),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (asset_id) REFERENCES investment_assets(id)
  )`,
  // Investment Watchlist
  `CREATE TABLE IF NOT EXISTS investment_watchlist (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    asset_id INT NOT NULL,
    alert_price DECIMAL(18,6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (asset_id) REFERENCES investment_assets(id)
  )`,
  // Investment Orders (buy/sell history)
  `CREATE TABLE IF NOT EXISTS investment_orders (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    asset_id INT NOT NULL,
    order_type ENUM('buy','sell') DEFAULT 'buy',
    quantity DECIMAL(18,8) NOT NULL,
    price_at_order DECIMAL(18,6) NOT NULL,
    total_amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    status ENUM('pending','completed','cancelled') DEFAULT 'completed',
    fee DECIMAL(10,4) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (asset_id) REFERENCES investment_assets(id)
  )`,
];

let created = 0;
for (const ddl of tables) {
  const tableName = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
  try {
    await exec(ddl);
    console.log(`  ✅ Created/verified: ${tableName}`);
    created++;
  } catch (e) {
    console.error(`  ❌ Failed: ${tableName} — ${e.message}`);
  }
}

console.log(`\n✅ Investment migration complete: ${created}/${tables.length} tables`);
await sql.end();
