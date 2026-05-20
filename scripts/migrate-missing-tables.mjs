#!/usr/bin/env node
/**
 * RemitFlow v44 — Missing Tables Migration
 * Creates all tables that are defined in schema.ts but missing from the database
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
  // Market Listings
  `CREATE TABLE IF NOT EXISTS market_listings (
    id SERIAL PRIMARY KEY,
    seller_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(18,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    category VARCHAR(100),
    location VARCHAR(255),
    images JSON,
    status ENUM('active','sold','paused','deleted') DEFAULT 'active',
    views INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Market Orders
  `CREATE TABLE IF NOT EXISTS market_orders (
    id SERIAL PRIMARY KEY,
    listing_id INT NOT NULL,
    buyer_id INT NOT NULL,
    seller_id INT NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    status ENUM('pending','paid','shipped','delivered','disputed','cancelled','refunded') DEFAULT 'pending',
    payment_reference VARCHAR(100),
    shipping_address TEXT,
    tracking_number VARCHAR(100),
    notes TEXT,
    escrow_held TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Market Ratings
  `CREATE TABLE IF NOT EXISTS market_ratings (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    buyer_id INT NOT NULL,
    seller_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (order_id)
  )`,

  // Talent Profiles
  `CREATE TABLE IF NOT EXISTS talent_profiles (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    title VARCHAR(255),
    bio TEXT,
    skills JSON,
    hourly_rate DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    availability ENUM('full_time','part_time','advisory','project_based') DEFAULT 'advisory',
    expertise_area VARCHAR(100),
    country VARCHAR(100),
    linkedin_url VARCHAR(500),
    portfolio_url VARCHAR(500),
    is_verified TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    rating DECIMAL(3,2) DEFAULT 0,
    review_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Talent Opportunities
  `CREATE TABLE IF NOT EXISTS talent_opportunities (
    id SERIAL PRIMARY KEY,
    posted_by INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    budget DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    engagement_type ENUM('consulting','advisory','mentorship','speaking','project_based') DEFAULT 'consulting',
    duration VARCHAR(100),
    skills_required JSON,
    status ENUM('open','closed','filled') DEFAULT 'open',
    applicant_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Talent Bookings
  `CREATE TABLE IF NOT EXISTS talent_bookings (
    id SERIAL PRIMARY KEY,
    profile_id INT NOT NULL,
    client_id INT NOT NULL,
    engagement_type VARCHAR(100),
    description TEXT,
    budget DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    status ENUM('pending','accepted','declined','completed','cancelled') DEFAULT 'pending',
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    rating INT,
    review TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Community Funds
  `CREATE TABLE IF NOT EXISTS community_funds (
    id SERIAL PRIMARY KEY,
    creator_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    goal_amount DECIMAL(18,2) NOT NULL,
    raised_amount DECIMAL(18,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    category VARCHAR(100),
    status ENUM('active','paused','completed','cancelled') DEFAULT 'active',
    member_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Fund Proposals
  `CREATE TABLE IF NOT EXISTS fund_proposals (
    id SERIAL PRIMARY KEY,
    fund_id INT NOT NULL,
    proposer_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    requested_amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    votes_for INT DEFAULT 0,
    votes_against INT DEFAULT 0,
    status ENUM('draft','voting','approved','rejected','funded','cancelled') DEFAULT 'voting',
    voting_deadline TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Fund Votes
  `CREATE TABLE IF NOT EXISTS fund_votes (
    id SERIAL PRIMARY KEY,
    proposal_id INT NOT NULL,
    fund_id INT NOT NULL,
    voter_id INT NOT NULL,
    vote ENUM('for','against','abstain') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_vote (proposal_id, voter_id)
  )`,

  // Fund Contributions
  `CREATE TABLE IF NOT EXISTS fund_contributions (
    id SERIAL PRIMARY KEY,
    fund_id INT NOT NULL,
    contributor_id INT NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    payment_reference VARCHAR(100),
    status ENUM('pending','completed','failed','refunded') DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Diaspora Collectives
  `CREATE TABLE IF NOT EXISTS diaspora_collectives (
    id SERIAL PRIMARY KEY,
    creator_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    home_country VARCHAR(100),
    target_amount DECIMAL(18,2),
    raised_amount DECIMAL(18,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    member_count INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Diaspora Collective Members
  `CREATE TABLE IF NOT EXISTS diaspora_collective_members (
    id SERIAL PRIMARY KEY,
    collective_id INT NOT NULL,
    user_id INT NOT NULL,
    contribution_amount DECIMAL(18,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    role ENUM('admin','member') DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_membership (collective_id, user_id)
  )`,

  // Investment Opportunities
  `CREATE TABLE IF NOT EXISTS investment_opportunities (
    id SERIAL PRIMARY KEY,
    creator_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    sector VARCHAR(100),
    target_amount DECIMAL(18,2) NOT NULL,
    raised_amount DECIMAL(18,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    min_investment DECIMAL(18,2),
    stage VARCHAR(100),
    expected_return VARCHAR(100),
    status ENUM('open','closing','closed','funded') DEFAULT 'open',
    investor_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Family Members
  `CREATE TABLE IF NOT EXISTS family_members (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    relationship ENUM('spouse','parent','child','sibling','other') DEFAULT 'other',
    country_code VARCHAR(10),
    phone VARCHAR(50),
    email VARCHAR(255),
    bank_name VARCHAR(255),
    bank_account VARCHAR(100),
    preferred_currency VARCHAR(10) DEFAULT 'USD',
    notes TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Family Budgets
  `CREATE TABLE IF NOT EXISTS family_budgets (
    id SERIAL PRIMARY KEY,
    family_member_id INT NOT NULL,
    user_id INT NOT NULL,
    monthly_limit DECIMAL(18,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    spent_amount DECIMAL(18,2) DEFAULT 0,
    alert_threshold INT DEFAULT 80,
    period_start DATE,
    period_end DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Outbox Events (for event sourcing)
  `CREATE TABLE IF NOT EXISTS outbox_events (
    id SERIAL PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSON,
    status ENUM('pending','processing','delivered','failed') DEFAULT 'pending',
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL
  )`,
];

let created = 0;
let skipped = 0;
for (const ddl of tables) {
  const tableName = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
  try {
    await exec(ddl);
    console.log(`  ✅ Created/verified: ${tableName}`);
    created++;
  } catch (e) {
    console.warn(`  ⚠ ${tableName}: ${e.message.slice(0, 80)}`);
    skipped++;
  }
}

console.log(`\n✅ Migration complete: ${created} tables created/verified, ${skipped} skipped`);
await sql.end();

// Run investment tables migration
async function migrateInvestmentTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'investment_asset_type') THEN
          CREATE TYPE investment_asset_type AS ENUM('stock','etf','commodity','crypto','mining_share','real_estate','bond','index_fund');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_investment_status') THEN
          CREATE TYPE user_investment_status AS ENUM('pending','active','sold','cancelled','matured');
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS investment_assets (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        name VARCHAR(200) NOT NULL,
        asset_type investment_asset_type NOT NULL,
        exchange VARCHAR(50),
        country VARCHAR(64),
        sector VARCHAR(100),
        current_price NUMERIC(18,6) DEFAULT 0,
        currency VARCHAR(10) DEFAULT 'USD',
        price_change_24h NUMERIC(10,4) DEFAULT 0,
        price_change_pct_24h NUMERIC(10,4) DEFAULT 0,
        market_cap NUMERIC(24,2),
        volume_24h NUMERIC(24,2),
        description TEXT,
        logo_url TEXT,
        min_investment NUMERIC(18,2) DEFAULT 10,
        is_active BOOLEAN DEFAULT true,
        is_featured BOOLEAN DEFAULT false,
        tags JSONB DEFAULT '[]',
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_investments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        asset_id INTEGER NOT NULL REFERENCES investment_assets(id),
        status user_investment_status DEFAULT 'active',
        quantity NUMERIC(18,8) NOT NULL,
        purchase_price NUMERIC(18,6) NOT NULL,
        current_value NUMERIC(18,2),
        currency VARCHAR(10) DEFAULT 'USD',
        purchased_at TIMESTAMP DEFAULT NOW() NOT NULL,
        sold_at TIMESTAMP,
        sold_price NUMERIC(18,6),
        notes TEXT,
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS investment_watchlist (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        asset_id INTEGER NOT NULL REFERENCES investment_assets(id),
        alert_price NUMERIC(18,6),
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS investment_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        asset_id INTEGER NOT NULL REFERENCES investment_assets(id),
        order_type VARCHAR(10) DEFAULT 'buy',
        quantity NUMERIC(18,8) NOT NULL,
        price_at_order NUMERIC(18,6) NOT NULL,
        total_amount NUMERIC(18,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USD',
        status VARCHAR(20) DEFAULT 'completed',
        fee NUMERIC(10,4) DEFAULT 0,
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    console.log('✅ Investment tables created/verified');
  } finally {
    client.release();
  }
}

migrateInvestmentTables().then(() => pool.end()).catch(e => { console.error(e.message); pool.end(); });
