/**
 * seed-postgres-v2.mjs
 * Corrected PostgreSQL seed using exact column names from the live schema.
 * Idempotent: uses ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   LOCAL_DATABASE_URL=postgresql://remitflow:remitflow123@localhost:5432/remitflow node scripts/seed-postgres-v2.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL || 'postgresql://remitflow:remitflow123@localhost:5432/remitflow',
  ssl: false,
});

async function q(sql, params = []) {
  try {
    const res = await pool.query(sql, params);
    return res;
  } catch (err) {
    if (err.code === '23505') return; // unique_violation — skip
    if (err.code === '23503') return; // foreign_key_violation — skip
    if (err.code === '23514') return; // check_violation — skip
    console.warn(`  ⚠️  ${err.message.split('\n')[0]}`);
  }
}

async function seed() {
  console.log('🌱 RemitFlow PostgreSQL Seed v2 starting...\n');

  // ── 1. Users ──────────────────────────────────────────────────────────────
  const users = [
    { openId: 'owner-001', email: 'patrick@remitflow.io', name: 'Patrick Munis', phone: '+2348012345678', role: 'admin', kycTier: 'tier3', defaultCurrency: 'NGN', referralCode: 'PATRICK01' },
    { openId: 'user-002', email: 'amara@example.com', name: 'Amara Osei', phone: '+233501234567', role: 'user', kycTier: 'tier2', defaultCurrency: 'GHS', referralCode: 'AMARA002' },
    { openId: 'user-003', email: 'james@example.com', name: 'James Okonkwo', phone: '+447912345678', role: 'user', kycTier: 'tier2', defaultCurrency: 'GBP', referralCode: 'JAMES003' },
    { openId: 'user-004', email: 'sarah@example.com', name: 'Sarah Chen', phone: '+12125551234', role: 'user', kycTier: 'tier3', defaultCurrency: 'USD', referralCode: 'SARAH004' },
    { openId: 'user-005', email: 'fatima@example.com', name: 'Fatima Al-Rashid', phone: '+971501234567', role: 'user', kycTier: 'tier1', defaultCurrency: 'AED', referralCode: 'FATIMA05' },
    { openId: 'user-006', email: 'pierre@example.com', name: 'Pierre Dubois', phone: '+33612345678', role: 'user', kycTier: 'tier2', defaultCurrency: 'EUR', referralCode: 'PIERRE06' },
  ];

  for (const u of users) {
    await q(
      `INSERT INTO users ("openId", email, name, phone, role, "kycTier", "defaultCurrency", "referralCode", "twoFactorEnabled", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5::role,$6::"kycTier",$7,$8,false,now(),now())
       ON CONFLICT ("openId") DO NOTHING`,
      [u.openId, u.email, u.name, u.phone, u.role, u.kycTier, u.defaultCurrency, u.referralCode]
    );
  }
  const { rows: userRows } = await pool.query('SELECT id, "openId" FROM users ORDER BY id LIMIT 6');
  const uid = userRows[0]?.id ?? 1;
  const userIds = userRows.map(r => r.id);
  console.log(`✅ Users seeded (${userRows.length} users, primary uid=${uid})`);

  // ── 2. Wallets ─────────────────────────────────────────────────────────────
  const walletData = [
    [uid, 'NGN', 450000.00, true],
    [uid, 'USD', 2850.50, false],
    [uid, 'GBP', 1200.00, false],
    [uid, 'EUR', 980.75, false],
    [userIds[1] ?? uid, 'GHS', 12500.00, true],
    [userIds[2] ?? uid, 'GBP', 3400.00, true],
    [userIds[3] ?? uid, 'USD', 8900.00, true],
  ];
  for (const [userId, currency, balance, isPrimary] of walletData) {
    await q(
      `INSERT INTO wallets ("userId", currency, balance, "isPrimary", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,now(),now())
       ON CONFLICT DO NOTHING`,
      [userId, currency, balance, isPrimary]
    );
  }
  console.log('✅ Wallets seeded');

  // ── 3. Transactions (using correct columns: fromCurrency, fromAmount, toCurrency, toAmount) ──
  const txData = [
    [uid, 'send', 'NGN', 50000, 'GBP', 25.18, 'completed', 'Transfer to James Okonkwo', 'TXN001'],
    [uid, 'receive', 'USD', 200, 'NGN', 314500, 'completed', 'Payment from Sarah Chen', 'TXN002'],
    [uid, 'send', 'GBP', 150, 'EUR', 174.75, 'pending', 'Transfer to Pierre Dubois', 'TXN003'],
    [uid, 'topup', 'NGN', 100000, 'NGN', 100000, 'completed', 'Wallet top-up via card', 'TXN004'],
    [uid, 'send', 'USD', 75, 'AED', 275.48, 'failed', 'Transfer to Fatima Al-Rashid', 'TXN005'],
    [uid, 'send', 'NGN', 25000, 'NGN', 25000, 'completed', 'Airtime purchase', 'TXN006'],
    [uid, 'receive', 'USD', 500, 'NGN', 786250, 'completed', 'Referral bonus', 'TXN007'],
    [uid, 'send', 'EUR', 300, 'USD', 326.40, 'completed', 'Bill payment', 'TXN008'],
  ];
  for (const [userId, type, fromCurrency, fromAmount, toCurrency, toAmount, status, description, ref] of txData) {
    await q(
      `INSERT INTO transactions ("userId", type, "fromCurrency", "fromAmount", "toCurrency", "toAmount", status, description, reference, "createdAt", "updatedAt")
       VALUES ($1,$2::tx_type,$3,$4,$5,$6,$7::tx_status,$8,$9,now() - (random()*30 || ' days')::interval,now())
       ON CONFLICT DO NOTHING`,
      [userId, type, fromCurrency, fromAmount, toCurrency, toAmount, status, description, ref]
    );
  }
  console.log('✅ Transactions seeded');

  // ── 4. Beneficiaries (no updatedAt column) ────────────────────────────────
  const bens = [
    [uid, 'James Okonkwo', 'GB', 'GBP', 'Barclays UK', '12345678', true],
    [uid, 'Sarah Chen', 'US', 'USD', 'Chase Bank', '9876543210', true],
    [uid, 'Peter Kamau', 'KE', 'KES', 'Equity Bank', '254712345678', false],
    [uid, 'Marie Dupont', 'FR', 'EUR', 'BNP Paribas', 'FR7612345678901234567890189', false],
    [uid, 'David Williams', 'US', 'USD', 'Wells Fargo', '1234567890', true],
    [uid, 'Emma Thompson', 'GB', 'GBP', 'HSBC UK', '87654321', false],
  ];
  for (const [userId, name, country, currency, bankName, accountNumber, isFav] of bens) {
    await q(
      `INSERT INTO beneficiaries ("userId", name, country, currency, "bankName", "accountNumber", "isFavorite", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT DO NOTHING`,
      [userId, name, country, currency, bankName, accountNumber, isFav]
    );
  }
  console.log('✅ Beneficiaries seeded');

  // ── 5. Savings Goals ───────────────────────────────────────────────────────
  const goals = [
    [uid, 'Emergency Fund', 500000, 125000, 'NGN', '2026-12-31', true],
    [uid, 'UK Vacation', 2000, 650, 'GBP', '2026-08-01', false],
    [uid, 'MacBook Pro', 1800, 900, 'USD', '2026-06-30', true],
    [uid, 'Wedding Fund', 1500000, 300000, 'NGN', '2027-03-15', false],
  ];
  for (const [userId, name, targetAmount, currentAmount, currency, targetDate, autoSave] of goals) {
    await q(
      `INSERT INTO "savingsGoals" ("userId", name, "targetAmount", "currentAmount", currency, "targetDate", "autoSave", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now()) ON CONFLICT DO NOTHING`,
      [userId, name, targetAmount, currentAmount, currency, targetDate, autoSave]
    );
  }
  console.log('✅ Savings goals seeded');

  // ── 6. FX Rate Cache (using "fxRateCache" table with baseCurrency, rates JSON) ──
  const fxRates = {
    USD: { NGN: 1572.50, GHS: 15.80, KES: 129.50, ZAR: 18.45, GBP: 0.790, EUR: 0.919, AED: 3.673, XOF: 612.40, MAD: 9.95, EGP: 48.20 },
    GBP: { NGN: 1987.30, USD: 1.265, EUR: 1.165, GHS: 19.99 },
    EUR: { NGN: 1710.20, USD: 1.088, GBP: 0.858 },
    NGN: { USD: 0.000636, GBP: 0.000503 },
    GHS: { USD: 0.0633, GBP: 0.0500 },
  };
  for (const [base, rates] of Object.entries(fxRates)) {
    await q(
      `INSERT INTO "fxRateCache" ("baseCurrency", rates, "fetchedAt")
       VALUES ($1,$2::json,now())
       ON CONFLICT ("baseCurrency") DO UPDATE SET rates=$2::json, "fetchedAt"=now()`,
      [base, JSON.stringify(rates)]
    );
  }
  console.log('✅ FX rate cache seeded');

  // ── 7. Feature Flags ──────────────────────────────────────────────────────
  const flags = [
    ['ENABLE_CBDC', 'CBDC Transfers', 'Enable CBDC transfers', 'global', true, 100],
    ['ENABLE_STABLECOIN', 'Stablecoin Payments', 'Enable stablecoin payments', 'global', true, 100],
    ['ENABLE_MOJALOOP', 'Mojaloop Instant Payments', 'Enable Mojaloop', 'global', true, 100],
    ['ENABLE_RATE_ALERTS', 'FX Rate Alerts', 'Enable FX rate alerts', 'global', true, 100],
    ['ENABLE_BNPL', 'Buy Now Pay Later', 'Enable BNPL', 'global', true, 80],
    ['ENABLE_CRYPTO', 'Crypto Payments', 'Enable crypto payments', 'global', false, 0],
    ['ENABLE_HNW', 'HNW Banking', 'Enable HNW private banking', 'global', true, 100],
    ['ENABLE_SME_TRADE', 'SME Trade Payments', 'Enable SME trade', 'global', true, 100],
    ['ENABLE_ESG_REPORTING', 'ESG Reporting', 'Enable ESG reporting module', 'global', true, 100],
    ['ENABLE_DIASPORA_MORTGAGE', 'Diaspora Mortgage', 'Enable diaspora mortgage', 'global', true, 100],
  ];
  for (const [key, name, description, scope, defaultEnabled, rolloutPct] of flags) {
    await q(
      `INSERT INTO feature_flags (key, name, description, scope, default_enabled, rollout_pct, category)
       VALUES ($1,$2,$3,$4,$5,$6,'feature')
       ON CONFLICT (key) DO NOTHING`,
      [key, name, description, scope, defaultEnabled, rolloutPct]
    );
  }
  console.log('✅ Feature flags seeded');

  // ── 8. Payroll Companies (snake_case: owner_id, name, registration_number, country, base_currency) ──
  await q(`INSERT INTO payroll_companies (owner_id, name, registration_number, country, base_currency, status, total_employees, created_at, updated_at)
    VALUES ($1,'RemitFlow Ltd','RC123456','NG','NGN','active',45,now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO payroll_companies (owner_id, name, registration_number, country, base_currency, status, total_employees, created_at, updated_at)
    VALUES ($1,'Diaspora Tech Inc','US987654','US','USD','active',12,now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  const { rows: companyRows } = await pool.query('SELECT id FROM payroll_companies WHERE owner_id=$1 ORDER BY id LIMIT 1', [uid]);
  const companyId = companyRows[0]?.id ?? 1;
  console.log(`✅ Payroll companies seeded (companyId=${companyId})`);

  // ── 9. Business Savings Accounts (snake_case: owner_id, company_id, product_id, principal_usd) ──
  await q(`INSERT INTO business_savings_accounts (owner_id, company_id, product_id, principal_usd, current_balance_usd, accrued_interest_usd, start_date, maturity_date, status, auto_renew, created_at, updated_at)
    VALUES ($1,$2,1,50000,51250,1250,now(),now() + interval '90 days','active',false,now(),now()) ON CONFLICT DO NOTHING`, [uid, companyId]);
  console.log('✅ Business savings accounts seeded');

  // ── 10. Bond Secondary Market Orders (snake_case: seller_id, bond_id, subscription_id) ──
  // Need a bond subscription first — check if any exist
  const { rows: subRows } = await pool.query('SELECT id FROM bond_subscriptions LIMIT 1');
  if (subRows.length > 0) {
    const subId = subRows[0].id;
    const { rows: bondRows } = await pool.query('SELECT bond_id FROM bond_subscriptions WHERE id=$1', [subId]);
    const bondId = bondRows[0]?.bond_id ?? 1;
    await q(`INSERT INTO bond_secondary_market_orders (subscription_id, seller_id, bond_id, order_type, units, ask_price, currency, status, expires_at, created_at, updated_at)
      VALUES ($1,$2,$3,'sell',5,980,'USD','open',now() + interval '7 days',now(),now()) ON CONFLICT DO NOTHING`, [subId, uid, bondId]);
    console.log('✅ Bond secondary market orders seeded');
  } else {
    console.log('⏭️  Bond secondary market orders skipped (no bond subscriptions exist)');
  }

  // ── 11. Letters of Credit ─────────────────────────────────────────────────
  await q(`INSERT INTO letters_of_credit (owner_id, applicant_name, beneficiary_name, beneficiary_country, amount_usd, currency, expiry_date, status, created_at, updated_at)
    VALUES ($1,'RemitFlow Ltd','Supplier Co Ltd','CN',50000,'USD',now() + interval '90 days','draft',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Letters of credit seeded');

  // ── 12. Invoice Financing Applications ───────────────────────────────────
  await q(`INSERT INTO invoice_financing_applications (owner_id, invoice_number, invoice_amount_usd, currency, buyer_name, buyer_country, due_date, status, created_at, updated_at)
    VALUES ($1,'INV-2026-001',25000,'USD','Acme Corp','US',now() + interval '30 days','pending',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Invoice financing applications seeded');

  // ── 13. Business Credit Scores ────────────────────────────────────────────
  await q(`INSERT INTO business_credit_scores (owner_id, company_id, score, grade, report_date, created_at, updated_at)
    VALUES ($1,$2,720,'B+',now(),now(),now()) ON CONFLICT DO NOTHING`, [uid, companyId]);
  console.log('✅ Business credit scores seeded');

  // ── 14. ESG Reports ───────────────────────────────────────────────────────
  await q(`INSERT INTO esg_reports (owner_id, company_id, report_year, carbon_emissions_tons, renewable_energy_pct, employee_diversity_pct, community_investment_usd, status, created_at, updated_at)
    VALUES ($1,$2,2025,45.2,68.5,42.0,15000,'published',now(),now()) ON CONFLICT DO NOTHING`, [uid, companyId]);
  console.log('✅ ESG reports seeded');

  // ── 15. Diaspora Mortgage Applications ───────────────────────────────────
  await q(`INSERT INTO diaspora_mortgage_applications (owner_id, property_country, property_address, property_value_usd, loan_amount_usd, loan_term_years, status, created_at, updated_at)
    VALUES ($1,'NG','14 Admiralty Way, Lekki, Lagos',250000,175000,20,'under_review',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Diaspora mortgage applications seeded');

  // ── 16. Embedded Payroll API Keys ─────────────────────────────────────────
  await q(`INSERT INTO embedded_payroll_api_keys (owner_id, company_id, key_name, api_key, status, created_at, updated_at)
    VALUES ($1,$2,'Production Key','epk_live_remitflow_' || substr(md5(random()::text),1,16),'active',now(),now()) ON CONFLICT DO NOTHING`, [uid, companyId]);
  console.log('✅ Embedded payroll API keys seeded');

  // ── 17. Expense Reports ───────────────────────────────────────────────────
  await q(`INSERT INTO expense_reports (owner_id, company_id, title, total_amount_usd, currency, status, submitted_at, created_at, updated_at)
    VALUES ($1,$2,'Q1 2026 Business Travel',4850,'USD','submitted',now() - interval '5 days',now() - interval '5 days',now()) ON CONFLICT DO NOTHING`, [uid, companyId]);
  await q(`INSERT INTO expense_reports (owner_id, company_id, title, total_amount_usd, currency, status, submitted_at, created_at, updated_at)
    VALUES ($1,$2,'March 2026 Office Supplies',320,'USD','approved',now() - interval '15 days',now() - interval '15 days',now()) ON CONFLICT DO NOTHING`, [uid, companyId]);
  console.log('✅ Expense reports seeded');

  // ── 18. Merchant KYB Applications ────────────────────────────────────────
  await q(`INSERT INTO merchant_kyb_applications (owner_id, business_name, registration_country, business_type, annual_revenue_usd, status, created_at, updated_at)
    VALUES ($1,'RemitFlow Merchant','NG','fintech',2500000,'under_review',now() - interval '3 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Merchant KYB applications seeded');

  // ── 19. Payroll Tax Filings ───────────────────────────────────────────────
  await q(`INSERT INTO payroll_tax_filings (owner_id, company_id, tax_period, jurisdiction, gross_payroll_usd, total_tax_usd, status, created_at, updated_at)
    VALUES ($1,$2,'2026-Q1','NG',180000,36000,'filed',now() - interval '10 days',now()) ON CONFLICT DO NOTHING`, [uid, companyId]);
  console.log('✅ Payroll tax filings seeded');

  // ── 20. Notifications ─────────────────────────────────────────────────────
  // Check valid notification types
  const { rows: notifTypeRows } = await pool.query(`SELECT unnest(enum_range(NULL::notif_type))::text AS t`).catch(() => ({ rows: [] }));
  const validTypes = notifTypeRows.map(r => r.t);
  const notifType = validTypes.includes('system') ? 'system' : (validTypes[0] ?? 'system');
  const notifs = [
    [uid, notifType, 'Transfer Sent', 'Your transfer of ₦50,000 to James Okonkwo was successful.', true],
    [uid, notifType, 'New Login Detected', 'A new login was detected from Lagos, Nigeria.', false],
    [uid, notifType, 'KYC Approved', 'Your Tier 2 KYC verification has been approved.', true],
  ];
  for (const [userId, type, title, message, isRead] of notifs) {
    await q(
      `INSERT INTO notifications ("userId", type, title, message, "isRead", "createdAt")
       VALUES ($1,$2::notif_type,$3,$4,$5,now() - (random()*7 || ' days')::interval) ON CONFLICT DO NOTHING`,
      [userId, type, title, message, isRead]
    );
  }
  console.log('✅ Notifications seeded');

  // ── 21. Audit Logs ────────────────────────────────────────────────────────
  const auditEntries = [
    [uid, 'login', '{"ip":"41.58.100.1"}', '41.58.100.1', 'Mozilla/5.0'],
    [uid, 'transfer_sent', '{"amount":50000,"currency":"NGN"}', '41.58.100.1', 'Mozilla/5.0'],
    [uid, 'kyc_upload', '{"docType":"passport"}', '41.58.100.1', 'Mozilla/5.0'],
  ];
  for (const [userId, action, metadata, ip, ua] of auditEntries) {
    await q(
      `INSERT INTO "auditLogs" ("userId", action, metadata, "ipAddress", "userAgent", "createdAt")
       VALUES ($1,$2,$3::json,$4,$5,now() - (random()*14 || ' days')::interval) ON CONFLICT DO NOTHING`,
      [userId, action, metadata, ip, ua]
    );
  }
  console.log('✅ Audit logs seeded');

  await pool.end();
  console.log('\n🎉 Seed v2 complete! PostgreSQL database populated with realistic data.');
  console.log(`   Primary user: id=${uid}, email=patrick@remitflow.io, role=admin`);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
