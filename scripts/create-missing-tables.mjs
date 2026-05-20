import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL });

const queries = [
  `CREATE TABLE IF NOT EXISTS bill_payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    biller_id TEXT NOT NULL,
    biller_name TEXT NOT NULL,
    category TEXT NOT NULL,
    account_number TEXT NOT NULL,
    amount_ngn NUMERIC(15,2) NOT NULL,
    amount_usd NUMERIC(15,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS airtime_purchases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    network TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    purchase_type TEXT NOT NULL DEFAULT 'airtime',
    data_plan TEXT,
    amount_ngn NUMERIC(15,2) NOT NULL,
    amount_usd NUMERIC(15,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS virtual_cards (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    card_number_masked TEXT NOT NULL,
    card_type TEXT NOT NULL DEFAULT 'virtual',
    network TEXT NOT NULL DEFAULT 'visa',
    currency TEXT NOT NULL DEFAULT 'USD',
    balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    spending_limit NUMERIC(15,2),
    status TEXT NOT NULL DEFAULT 'active',
    expiry_month INTEGER NOT NULL,
    expiry_year INTEGER NOT NULL,
    provider TEXT,
    provider_card_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS card_transactions (
    id SERIAL PRIMARY KEY,
    card_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    merchant_name TEXT NOT NULL,
    amount NUMERIC(15,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    transaction_type TEXT NOT NULL DEFAULT 'purchase',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS bnpl_installments (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    installment_number INTEGER NOT NULL,
    amount_ngn NUMERIC(15,2) NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS agent_registrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    agent_code TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL,
    business_type TEXT NOT NULL,
    state TEXT NOT NULL,
    lga TEXT,
    address TEXT,
    phone TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'basic',
    status TEXT NOT NULL DEFAULT 'pending',
    daily_limit_ngn NUMERIC(15,2) NOT NULL DEFAULT 50000,
    commission_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 1.5,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS support_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    is_agent BOOLEAN NOT NULL DEFAULT false,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS referral_rewards (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL,
    referred_id INTEGER NOT NULL,
    reward_amount_usd NUMERIC(10,2) NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS investment_distributions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    investment_id INTEGER,
    amount_usd NUMERIC(15,2) NOT NULL,
    distribution_type TEXT NOT NULL DEFAULT 'dividend',
    status TEXT NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'push',
    status TEXT NOT NULL DEFAULT 'sent',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];

let ok = 0, fail = 0;
for (const q of queries) {
  const name = q.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
  try {
    await pool.query(q);
    console.log(`✓ ${name}`);
    ok++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    fail++;
  }
}
console.log(`\nDone: ${ok} created, ${fail} failed`);
await pool.end();
