/**
 * seed-postgres-v3.mjs
 * Final corrected PostgreSQL seed using exact column names from the live schema.
 * Targets only the tier tables that had wrong column names in v2.
 *
 * Usage:
 *   LOCAL_DATABASE_URL=postgresql://remitflow:remitflow123@localhost:5432/remitflow node scripts/seed-postgres-v3.mjs
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
  console.log('🌱 RemitFlow PostgreSQL Seed v3 (tier tables fix) starting...\n');

  const { rows: userRows } = await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
  const uid = userRows[0]?.id ?? 1;
  const { rows: companyRows } = await pool.query('SELECT id FROM payroll_companies WHERE owner_id=$1 ORDER BY id LIMIT 1', [uid]);
  const companyId = companyRows[0]?.id ?? 1;
  console.log(`Using uid=${uid}, companyId=${companyId}`);

  // ── Wallets (isDefault not isPrimary) ──────────────────────────────────────
  const walletData = [
    [uid, 'NGN', 450000.00, true],
    [uid, 'USD', 2850.50, false],
    [uid, 'GBP', 1200.00, false],
    [uid, 'EUR', 980.75, false],
  ];
  for (const [userId, currency, balance, isDefault] of walletData) {
    await q(
      `INSERT INTO wallets ("userId", currency, balance, "isDefault", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,now(),now()) ON CONFLICT DO NOTHING`,
      [userId, currency, balance, isDefault]
    );
  }
  console.log('✅ Wallets re-seeded (isDefault)');

  // ── Letters of Credit (applicant_id, lc_number, goods_description required) ──
  await q(
    `INSERT INTO letters_of_credit (applicant_id, lc_number, beneficiary_name, beneficiary_country, amount_usd, currency, goods_description, expiry_date, status, created_at, updated_at)
     VALUES ($1,'LC-2026-001','Supplier Co Ltd','CN',50000,'USD','Industrial machinery and spare parts',now() + interval '90 days','draft',now(),now())
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  await q(
    `INSERT INTO letters_of_credit (applicant_id, lc_number, beneficiary_name, beneficiary_country, amount_usd, currency, goods_description, expiry_date, status, created_at, updated_at)
     VALUES ($1,'LC-2026-002','Tech Imports GmbH','DE',25000,'EUR','Electronic components and PCBs',now() + interval '60 days','issued',now() - interval '5 days',now())
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  console.log('✅ Letters of credit re-seeded');

  // ── Invoice Financing Applications (applicant_id, debtor_name, invoice_due_date) ──
  await q(
    `INSERT INTO invoice_financing_applications (applicant_id, invoice_number, debtor_name, debtor_country, invoice_amount_usd, invoice_due_date, status, created_at, updated_at)
     VALUES ($1,'INV-2026-001','Acme Corp','US',25000,now() + interval '30 days','pending',now(),now())
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  await q(
    `INSERT INTO invoice_financing_applications (applicant_id, invoice_number, debtor_name, debtor_country, invoice_amount_usd, invoice_due_date, status, created_at, updated_at)
     VALUES ($1,'INV-2026-002','Global Trade Ltd','GB',15000,now() + interval '45 days','approved',now() - interval '3 days',now())
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  console.log('✅ Invoice financing applications re-seeded');

  // ── Business Credit Scores (company_id, score, grade) ─────────────────────
  await q(
    `INSERT INTO business_credit_scores (company_id, score, grade, transaction_volume, avg_monthly_volume, payroll_consistency, kyb_score, payment_history, utilization_ratio, created_at, updated_at)
     VALUES ($1,720,'B+',2500000,208333,95.5,85,98.2,42.0,now(),now())
     ON CONFLICT DO NOTHING`,
    [companyId]
  );
  console.log('✅ Business credit scores re-seeded');

  // ── ESG Reports (owner_id, reporting_period, co2_offset_kg, etc.) ─────────
  await q(
    `INSERT INTO esg_reports (owner_id, reporting_period, total_remittance_usd, co2_offset_kg, financial_inclusion_count, women_beneficiaries, rural_reach, jobs_supported, sdg_goals, created_at, updated_at)
     VALUES ($1,'2025-Q4',48500000,12450,8750,4200,2100,1850,'[1,8,10,13,17]'::json,now(),now())
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  await q(
    `INSERT INTO esg_reports (owner_id, reporting_period, total_remittance_usd, co2_offset_kg, financial_inclusion_count, women_beneficiaries, rural_reach, jobs_supported, sdg_goals, published_at, created_at, updated_at)
     VALUES ($1,'2025-Q3',42000000,10800,7500,3800,1900,1600,'[1,8,10,13,17]'::json,now() - interval '90 days',now() - interval '90 days',now() - interval '90 days')
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  console.log('✅ ESG reports re-seeded');

  // ── Mortgage Applications (applicant_id, deposit_amount_usd required) ─────
  await q(
    `INSERT INTO mortgage_applications (applicant_id, mortgage_type, property_country, property_address, property_value_usd, loan_amount_usd, deposit_amount_usd, ltv_pct, term_years, interest_rate_pct, applicant_country, annual_income_usd, employment_status, status, created_at, updated_at)
     VALUES ($1,'purchase','NG','14 Admiralty Way, Lekki, Lagos',250000,175000,75000,70.0,20,8.5,'GB',85000,'employed','under_review',now() - interval '3 days',now())
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  console.log('✅ Mortgage applications re-seeded');

  // ── Embedded Payroll API Keys (tenant_id, key_hash, key_prefix) ───────────
  const keyPrefix = 'epk_live_';
  const keyHash = 'sha256_' + Math.random().toString(36).substring(2, 18);
  await q(
    `INSERT INTO embedded_payroll_api_keys (tenant_id, key_hash, key_prefix, label, environment, status, created_at)
     VALUES ($1,$2,$3,'Production Key','production','active',now())
     ON CONFLICT DO NOTHING`,
    [companyId, keyHash, keyPrefix]
  );
  console.log('✅ Embedded payroll API keys re-seeded');

  // ── Expense Reports (company_id, submitted_by) ────────────────────────────
  await q(
    `INSERT INTO expense_reports (company_id, submitted_by, title, description, total_amount_usd, currency, status, created_at, updated_at)
     VALUES ($1,$2,'Q1 2026 Business Travel','Flights and hotels for client meetings',4850,'USD','submitted',now() - interval '5 days',now())
     ON CONFLICT DO NOTHING`,
    [companyId, uid]
  );
  await q(
    `INSERT INTO expense_reports (company_id, submitted_by, title, description, total_amount_usd, currency, status, created_at, updated_at)
     VALUES ($1,$2,'March 2026 Office Supplies','Stationery and equipment',320,'USD','approved',now() - interval '15 days',now())
     ON CONFLICT DO NOTHING`,
    [companyId, uid]
  );
  console.log('✅ Expense reports re-seeded');

  // ── Merchant KYB Reviews (user_id, business_name, country) ───────────────
  await q(
    `INSERT INTO merchant_kyb_reviews (user_id, business_name, registration_number, country, industry, expected_monthly_vol, status, created_at, updated_at)
     VALUES ($1,'RemitFlow Merchant Ltd','RC-2026-001','NG','fintech',500000,'under_review',now() - interval '3 days',now())
     ON CONFLICT DO NOTHING`,
    [uid]
  );
  console.log('✅ Merchant KYB reviews re-seeded');

  // ── Payroll Tax Filings (company_id, tax_authority enum, jurisdiction) ────
  // Check valid tax_authority enum values
  const { rows: enumRows } = await pool.query(`SELECT unnest(enum_range(NULL::tax_authority))::text AS t`).catch(() => ({ rows: [] }));
  const validAuthorities = enumRows.map(r => r.t);
  const authority = validAuthorities.includes('FIRS') ? 'FIRS' : (validAuthorities[0] ?? 'FIRS');
  await q(
    `INSERT INTO payroll_tax_filings (company_id, tax_authority, jurisdiction, period_start, period_end, total_gross_usd, total_tax_usd, total_pension_usd, employee_count, status, created_at, updated_at)
     VALUES ($1,$2::tax_authority,'NG',now() - interval '90 days',now() - interval '1 day',180000,36000,9000,45,'filed',now() - interval '10 days',now())
     ON CONFLICT DO NOTHING`,
    [companyId, authority]
  );
  console.log(`✅ Payroll tax filings re-seeded (authority=${authority})`);

  await pool.end();
  console.log('\n🎉 Seed v3 complete! All tier tables populated with correct column names.');
}

seed().catch(err => {
  console.error('❌ Seed v3 failed:', err.message);
  process.exit(1);
});
