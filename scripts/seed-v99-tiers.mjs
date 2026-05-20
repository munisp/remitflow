#!/usr/bin/env node
/**
 * RemitFlow v99 Seed Script — Tier 1/2/3 Feature Tables
 *
 * Seeds: contractors, contractor_invoices, expense_policies, expense_reports, expense_items,
 *        merchant_kyb_reviews, payroll_tax_filings, business_savings_products,
 *        business_savings_accounts, bond_secondary_market_orders, letters_of_credit,
 *        invoice_financing_applications, payroll_runs, embedded_payroll_api_keys,
 *        mortgage_applications, business_credit_scores, esg_reports
 *
 * Usage: node scripts/seed-v99-tiers.mjs
 * Requires: LOCAL_DATABASE_URL or DATABASE_URL env var (PostgreSQL)
 */
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.LOCAL_DATABASE_URL ? false : { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === "23505") return { rows: [] }; // unique_violation — skip
    throw err;
  } finally {
    client.release();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function daysAgo(n) { return new Date(Date.now() - n * 86400000); }
function daysFromNow(n) { return new Date(Date.now() + n * 86400000); }
function isoDate(d) { return d.toISOString().split("T")[0]; }

async function getOwnerUserId() {
  const res = await query("SELECT id FROM users ORDER BY id LIMIT 1");
  if (!res.rows.length) throw new Error("No users found — run the base seed first");
  return res.rows[0].id;
}

async function getUserIds(limit = 10) {
  const res = await query(`SELECT id FROM users ORDER BY id LIMIT $1`, [limit]);
  return res.rows.map(r => r.id);
}

// ── 1. Payroll Companies (prerequisite for several tables) ────────────────────
async function seedPayrollCompanies(ownerIds) {
  console.log("[v99] Seeding payroll_companies...");
  const companies = [
    { name: "Acme Fintech Ltd", country: "NG", currency: "NGN", tax_id: "NG-TAX-001", payroll_frequency: "monthly" },
    { name: "Diaspora Remit GmbH", country: "DE", currency: "EUR", tax_id: "DE-TAX-002", payroll_frequency: "bi_weekly" },
    { name: "AfriPay Solutions", country: "GH", currency: "GHS", tax_id: "GH-TAX-003", payroll_frequency: "monthly" },
  ];
  const ids = [];
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    const ownerId = ownerIds[i % ownerIds.length];
    const res = await query(
      `INSERT INTO payroll_companies (owner_id, name, country, currency, tax_id, payroll_frequency, employee_count, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
       ON CONFLICT DO NOTHING RETURNING id`,
      [ownerId, c.name, c.country, c.currency, c.tax_id, c.payroll_frequency, rnd(10, 200)]
    );
    if (res.rows.length) ids.push({ id: res.rows[0].id, ownerId });
  }
  console.log(`  → ${ids.length} payroll companies seeded`);
  return ids;
}

// ── 2. Contractors ────────────────────────────────────────────────────────────
async function seedContractors(ownerIds) {
  console.log("[v99] Seeding contractors...");
  const contractors = [
    { name: "Kwame Mensah", email: "kwame@example.com", country: "GH", currency: "GHS", payment_rail: "mobile_money" },
    { name: "Amara Diallo", email: "amara@example.com", country: "SN", currency: "XOF", payment_rail: "swift" },
    { name: "Fatima Al-Rashid", email: "fatima@example.com", country: "AE", currency: "AED", payment_rail: "swift" },
    { name: "Carlos Mendez", email: "carlos@example.com", country: "MX", currency: "MXN", payment_rail: "ach" },
    { name: "Priya Sharma", email: "priya@example.com", country: "IN", currency: "INR", payment_rail: "swift" },
  ];
  const ids = [];
  for (let i = 0; i < contractors.length; i++) {
    const c = contractors[i];
    const ownerId = ownerIds[i % ownerIds.length];
    const res = await query(
      `INSERT INTO contractors (owner_id, name, email, country, currency, payment_rail, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW())
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [ownerId, c.name, c.email, c.country, c.currency, c.payment_rail]
    );
    if (res.rows.length) ids.push({ id: res.rows[0].id, ownerId });
  }
  console.log(`  → ${ids.length} contractors seeded`);
  return ids;
}

// ── 3. Contractor Invoices ────────────────────────────────────────────────────
async function seedContractorInvoices(contractors) {
  console.log("[v99] Seeding contractor_invoices...");
  let count = 0;
  for (const { id: contractorId, ownerId } of contractors) {
    const statuses = ["pending", "paid", "rejected"];
    for (const status of statuses) {
      const total = rnd(500, 5000);
      await query(
        `INSERT INTO contractor_invoices (contractor_id, owner_id, invoice_number, description, line_items, subtotal_usd, tax_amount_usd, total_usd, currency, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'USD', $9, $10, NOW())
         ON CONFLICT DO NOTHING`,
        [
          contractorId, ownerId,
          `INV-${Date.now()}-${contractorId}-${status}`,
          "Software development services",
          JSON.stringify([{ description: "Development", quantity: 1, unitPrice: total, total }]),
          total.toFixed(2), (total * 0.075).toFixed(2), (total * 1.075).toFixed(2),
          status, daysAgo(rnd(1, 60))
        ]
      );
      count++;
    }
  }
  console.log(`  → ${count} contractor invoices seeded`);
}

// ── 4. Expense Reports ────────────────────────────────────────────────────────
async function seedExpenseReports(ownerIds, companyIds) {
  console.log("[v99] Seeding expense_reports + expense_items...");
  let count = 0;
  const categories = ["travel", "accommodation", "meals", "equipment", "software"];
  const statuses = ["submitted", "approved", "reimbursed"];
  for (let i = 0; i < 6; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const companyId = companyIds[i % companyIds.length];
    const total = rnd(200, 3000);
    const status = pick(statuses);
    const res = await query(
      `INSERT INTO expense_reports (company_id, submitted_by, title, description, total_amount_usd, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [companyId, ownerId, `Q${Math.ceil(new Date().getMonth() / 3)} Expenses`, "Quarterly business expenses", total.toFixed(2), status, daysAgo(rnd(1, 90))]
    );
    if (res.rows.length) {
      const reportId = res.rows[0].id;
      // Add 2-3 line items
      for (let j = 0; j < rnd(2, 3); j++) {
        const amount = rnd(50, 800);
        await query(
          `INSERT INTO expense_items (report_id, category, description, amount_usd, currency, expense_date, status, created_at)
           VALUES ($1, $2, $3, $4, 'USD', $5, $6, NOW())`,
          [reportId, pick(categories), "Business expense item", amount.toFixed(2), isoDate(daysAgo(rnd(1, 30))), status === "approved" ? "approved" : "pending"]
        );
      }
      count++;
    }
  }
  console.log(`  → ${count} expense reports seeded`);
}

// ── 5. Merchant KYB Reviews ───────────────────────────────────────────────────
async function seedMerchantKybReviews(ownerIds) {
  console.log("[v99] Seeding merchant_kyb_reviews...");
  const statuses = ["pending", "under_review", "approved", "rejected"];
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const status = statuses[i];
    const res = await query(
      `INSERT INTO merchant_kyb_reviews (user_id, business_name, business_type, registration_number, country, annual_revenue_usd, website, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) ON CONFLICT DO NOTHING RETURNING id`,
      [
        ownerId,
        `${pick(["Global", "Pan-African", "Diaspora", "Cross-Border"])} ${pick(["Payments", "Fintech", "Commerce", "Trade"])} Ltd`,
        pick(["limited_company", "sole_trader", "partnership", "ngo"]),
        `RC-${rnd(100000, 999999)}`,
        pick(["NG", "GH", "KE", "ZA", "GB"]),
        rnd(50000, 5000000).toFixed(2),
        `https://example-merchant-${i}.com`,
        status,
        daysAgo(rnd(1, 60))
      ]
    );
    if (res.rows.length) count++;
  }
  console.log(`  → ${count} merchant KYB reviews seeded`);
}

// ── 6. Payroll Tax Filings ────────────────────────────────────────────────────
async function seedPayrollTaxFilings(ownerIds, companyIds) {
  console.log("[v99] Seeding payroll_tax_filings...");
  const jurisdictions = ["NG-FIRS", "GH-GRA", "KE-KRA", "GB-HMRC", "DE-FINANZAMT"];
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const companyId = companyIds[i % companyIds.length];
    const gross = rnd(50000, 500000);
    const tax = gross * 0.3;
    await query(
      `INSERT INTO payroll_tax_filings (company_id, user_id, jurisdiction, tax_period_start, tax_period_end, gross_payroll_usd, total_tax_usd, employer_tax_usd, employee_tax_usd, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) ON CONFLICT DO NOTHING`,
      [
        companyId, ownerId, jurisdictions[i],
        isoDate(daysAgo(60)), isoDate(daysAgo(30)),
        gross.toFixed(2), tax.toFixed(2), (tax * 0.4).toFixed(2), (tax * 0.6).toFixed(2),
        pick(["draft", "submitted", "filed", "accepted"])
      ]
    );
    count++;
  }
  console.log(`  → ${count} payroll tax filings seeded`);
}

// ── 7. Business Savings Products ─────────────────────────────────────────────
async function seedBusinessSavingsProducts() {
  console.log("[v99] Seeding business_savings_products...");
  const products = [
    { name: "Standard Business Saver", product_type: "demand_deposit", currency: "USD", min_balance_usd: "1000", annual_yield_pct: "3.50", term_days: null },
    { name: "90-Day Fixed Deposit", product_type: "fixed_deposit", currency: "USD", min_balance_usd: "5000", annual_yield_pct: "6.00", term_days: 90 },
    { name: "180-Day Fixed Deposit", product_type: "fixed_deposit", currency: "USD", min_balance_usd: "10000", annual_yield_pct: "7.50", term_days: 180 },
    { name: "NGN Business Saver", product_type: "demand_deposit", currency: "NGN", min_balance_usd: "500", annual_yield_pct: "12.00", term_days: null },
    { name: "GHS Fixed Deposit", product_type: "fixed_deposit", currency: "GHS", min_balance_usd: "2000", annual_yield_pct: "18.00", term_days: 90 },
  ];
  let count = 0;
  for (const p of products) {
    const res = await query(
      `INSERT INTO business_savings_products (name, product_type, currency, min_balance_usd, annual_yield_pct, term_days, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW()) ON CONFLICT DO NOTHING RETURNING id`,
      [p.name, p.product_type, p.currency, p.min_balance_usd, p.annual_yield_pct, p.term_days]
    );
    if (res.rows.length) count++;
  }
  console.log(`  → ${count} savings products seeded`);
}

// ── 8. Business Savings Accounts ─────────────────────────────────────────────
async function seedBusinessSavingsAccounts(ownerIds) {
  console.log("[v99] Seeding business_savings_accounts...");
  const products = await query("SELECT id FROM business_savings_products LIMIT 5");
  if (!products.rows.length) { console.log("  → No products found, skipping accounts"); return; }
  let count = 0;
  for (let i = 0; i < 3; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const productId = products.rows[i % products.rows.length].id;
    const balance = rnd(5000, 100000);
    await query(
      `INSERT INTO business_savings_accounts (owner_id, product_id, account_number, balance_usd, status, opened_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ownerId, productId, `BSA-${Date.now()}-${i}`, balance.toFixed(2)]
    );
    count++;
  }
  console.log(`  → ${count} savings accounts seeded`);
}

// ── 9. Bond Secondary Market Orders ──────────────────────────────────────────
async function seedBondOrders(ownerIds) {
  console.log("[v99] Seeding bond_secondary_market_orders...");
  // Ensure diaspora_bonds exist
  const bonds = await query("SELECT id FROM diaspora_bonds LIMIT 3");
  if (!bonds.rows.length) {
    console.log("  → No diaspora bonds found, inserting sample bonds first...");
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO diaspora_bonds (issuer_name, bond_name, isin, currency, face_value_usd, coupon_rate_pct, maturity_date, total_issued, available, status, created_at)
         VALUES ($1, $2, $3, 'USD', $4, $5, $6, $7, $7, 'active', NOW()) ON CONFLICT DO NOTHING`,
        [
          pick(["Nigeria FGN", "Ghana GoG", "Kenya GoK"]),
          `${pick(["Diaspora", "Sovereign", "Infrastructure"])} Bond ${2025 + i}`,
          `NG00${rnd(1000, 9999)}${i}`,
          rnd(1000, 5000).toFixed(2),
          rnd(5, 15).toFixed(2),
          isoDate(daysFromNow(rnd(365, 1825))),
          rnd(1000000, 10000000).toFixed(2)
        ]
      );
    }
  }
  const bondRows = await query("SELECT id FROM diaspora_bonds LIMIT 3");
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const bondId = bondRows.rows[i % bondRows.rows.length].id;
    const qty = rnd(10, 500);
    const price = rnd(950, 1100);
    await query(
      `INSERT INTO bond_secondary_market_orders (bond_id, seller_id, quantity, face_value_usd, market_price_usd, total_value_usd, order_type, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) ON CONFLICT DO NOTHING`,
      [
        bondId, ownerId, qty, "1000.00", price.toFixed(2), (qty * price).toFixed(2),
        pick(["sell", "buy"]), pick(["open", "open", "filled", "cancelled"]),
        daysAgo(rnd(1, 30))
      ]
    );
    count++;
  }
  console.log(`  → ${count} bond orders seeded`);
}

// ── 10. Letters of Credit ─────────────────────────────────────────────────────
async function seedLettersOfCredit(ownerIds) {
  console.log("[v99] Seeding letters_of_credit...");
  const lcTypes = ["sight", "usance", "standby", "revolving"];
  const statuses = ["draft", "submitted", "issued", "advised", "settled"];
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const amount = rnd(50000, 500000);
    await query(
      `INSERT INTO letters_of_credit (applicant_id, beneficiary_name, beneficiary_country, lc_type, currency, amount_usd, expiry_date, lc_ref, status, required_documents, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, $8, $9, $10, NOW()) ON CONFLICT DO NOTHING`,
      [
        ownerId,
        `${pick(["Alibaba", "Dangote", "Olam", "Cargill", "Vitol"])} ${pick(["Trading", "Commodities", "Exports"])} Ltd`,
        pick(["CN", "US", "AE", "IN", "GB"]),
        lcTypes[i % lcTypes.length],
        amount.toFixed(2),
        isoDate(daysFromNow(rnd(60, 365))),
        `LC-${Date.now()}-${i}`,
        statuses[i % statuses.length],
        JSON.stringify(["Commercial Invoice", "Bill of Lading", "Certificate of Origin"]),
        daysAgo(rnd(1, 60))
      ]
    );
    count++;
  }
  console.log(`  → ${count} letters of credit seeded`);
}

// ── 11. Invoice Financing Applications ───────────────────────────────────────
async function seedInvoiceFinancing(ownerIds) {
  console.log("[v99] Seeding invoice_financing_applications...");
  const statuses = ["pending_review", "approved", "funded", "repaying", "repaid"];
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const invoiceAmt = rnd(20000, 200000);
    const advanceRate = 80;
    const advance = invoiceAmt * (advanceRate / 100);
    const fee = advance * 0.025;
    await query(
      `INSERT INTO invoice_financing_applications (applicant_id, invoice_number, debtor_name, debtor_country, invoice_amount_usd, advance_rate_pct, advance_amount_usd, fee_amount_usd, net_advance_usd, invoice_due_date, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) ON CONFLICT DO NOTHING`,
      [
        ownerId,
        `INV-${Date.now()}-${i}`,
        pick(["Unilever Nigeria", "MTN Ghana", "Safaricom Kenya", "Standard Chartered", "Nestlé Africa"]),
        pick(["NG", "GH", "KE", "ZA", "GB"]),
        invoiceAmt.toFixed(2), advanceRate.toFixed(2),
        advance.toFixed(2), fee.toFixed(2), (advance - fee).toFixed(2),
        isoDate(daysFromNow(rnd(30, 120))),
        statuses[i % statuses.length],
        daysAgo(rnd(1, 45))
      ]
    );
    count++;
  }
  console.log(`  → ${count} invoice financing applications seeded`);
}

// ── 12. Payroll Runs ──────────────────────────────────────────────────────────
async function seedPayrollRuns(companyIds) {
  console.log("[v99] Seeding payroll_runs...");
  let count = 0;
  for (const { id: companyId, ownerId } of companyIds) {
    for (let m = 0; m < 3; m++) {
      const periodStart = daysAgo(90 - m * 30);
      const periodEnd = daysAgo(60 - m * 30);
      const payDate = daysAgo(55 - m * 30);
      const gross = rnd(50000, 500000);
      await query(
        `INSERT INTO payroll_runs (company_id, created_by, period_start, period_end, pay_date, frequency, gross_payroll_usd, net_payroll_usd, total_tax_usd, employee_count, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'monthly', $6, $7, $8, $9, $10, $11, NOW()) ON CONFLICT DO NOTHING`,
        [
          companyId, ownerId,
          isoDate(periodStart), isoDate(periodEnd), isoDate(payDate),
          gross.toFixed(2), (gross * 0.75).toFixed(2), (gross * 0.25).toFixed(2),
          rnd(10, 100),
          pick(["draft", "approved", "disbursed"]),
          daysAgo(60 - m * 30)
        ]
      );
      count++;
    }
  }
  console.log(`  → ${count} payroll runs seeded`);
}

// ── 13. Embedded Payroll API Keys ─────────────────────────────────────────────
async function seedEmbeddedPayrollApiKeys() {
  console.log("[v99] Seeding embedded_payroll_api_keys...");
  const partners = ["Paystack Partners", "Flutterwave ISV", "Interswitch Fintech", "Chipper Cash API"];
  let count = 0;
  for (const partner of partners) {
    const res = await query(
      `INSERT INTO embedded_payroll_api_keys (tenant_id, label, key_hash, key_prefix, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT DO NOTHING RETURNING id`,
      [
        1, partner,
        `hash_${Math.random().toString(36).slice(2, 34)}`,
        `rpk_${Math.random().toString(36).slice(2, 14)}`,
        pick(["active", "active", "revoked"]),
        isoDate(daysFromNow(365))
      ]
    );
    if (res.rows.length) count++;
  }
  console.log(`  → ${count} embedded payroll API keys seeded`);
}

// ── 14. Mortgage Applications ─────────────────────────────────────────────────
async function seedMortgageApplications(ownerIds) {
  console.log("[v99] Seeding mortgage_applications...");
  const countries = ["NG", "GH", "KE", "ZA", "CM"];
  const statuses = ["enquiry", "application_submitted", "under_review", "approved", "disbursed"];
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const propertyValue = rnd(100000, 1000000);
    const loanAmount = Math.round(propertyValue * 0.7);
    const deposit = propertyValue - loanAmount;
    const termYears = pick([10, 15, 20, 25]);
    const rate = 0.085;
    const monthlyRate = rate / 12;
    const n = termYears * 12;
    const monthlyPayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
    await query(
      `INSERT INTO mortgage_applications (applicant_id, property_country, property_address, property_value_usd, loan_amount_usd, deposit_amount_usd, ltv_pct, term_years, interest_rate_pct, monthly_payment_usd, annual_income_usd, applicant_country, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()) ON CONFLICT DO NOTHING`,
      [
        ownerId, countries[i], `${rnd(1, 999)} ${pick(["Victoria Island", "East Legon", "Westlands", "Sandton", "Bastos"])} Street`,
        propertyValue.toFixed(2), loanAmount.toFixed(2), deposit.toFixed(2),
        "70.00", termYears, "8.50", monthlyPayment.toFixed(2),
        rnd(50000, 500000).toFixed(2), pick(["GB", "US", "CA", "DE", "AE"]),
        statuses[i % statuses.length], daysAgo(rnd(1, 90))
      ]
    );
    count++;
  }
  console.log(`  → ${count} mortgage applications seeded`);
}

// ── 15. Business Credit Scores ────────────────────────────────────────────────
async function seedBusinessCreditScores(ownerIds) {
  console.log("[v99] Seeding business_credit_scores...");
  const grades = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];
  let count = 0;
  for (let i = 0; i < Math.min(ownerIds.length, 5); i++) {
    const ownerId = ownerIds[i];
    const score = rnd(300, 850);
    const grade = score >= 750 ? "AAA" : score >= 700 ? "AA" : score >= 650 ? "A" : score >= 600 ? "BBB" : score >= 550 ? "BB" : score >= 500 ? "B" : "CCC";
    await query(
      `INSERT INTO business_credit_scores (user_id, score, grade, payment_history_pct, credit_utilization_pct, account_age_months, total_accounts, derogatory_marks, max_credit_line_usd, scoring_model, valid_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'RemitFlow-v3', $10, $11, NOW()) ON CONFLICT DO NOTHING`,
      [
        ownerId, score, grade,
        rnd(70, 100).toFixed(2), rnd(10, 80).toFixed(2),
        rnd(6, 120), rnd(2, 15), rnd(0, 3),
        rnd(10000, 500000).toFixed(2),
        isoDate(daysFromNow(365)),
        daysAgo(rnd(1, 30))
      ]
    );
    count++;
  }
  console.log(`  → ${count} business credit scores seeded`);
}

// ── 16. ESG Reports ───────────────────────────────────────────────────────────
async function seedEsgReports(ownerIds, companyIds) {
  console.log("[v99] Seeding esg_reports...");
  const statuses = ["draft", "submitted", "verified", "published"];
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const ownerId = ownerIds[i % ownerIds.length];
    const companyId = companyIds[i % companyIds.length];
    const carbonTons = rnd(50, 5000);
    await query(
      `INSERT INTO esg_reports (company_id, user_id, report_period_start, report_period_end, carbon_footprint_tons, renewable_energy_pct, waste_recycled_pct, female_employees_pct, board_diversity_pct, community_investment_usd, sdg_goals, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()) ON CONFLICT DO NOTHING`,
      [
        companyId, ownerId,
        isoDate(daysAgo(365)), isoDate(daysAgo(1)),
        carbonTons.toFixed(2), rnd(10, 80).toFixed(2),
        rnd(20, 90).toFixed(2), rnd(25, 60).toFixed(2),
        rnd(20, 50).toFixed(2), rnd(5000, 500000).toFixed(2),
        JSON.stringify([1, 5, 8, 13, 17].slice(0, rnd(2, 5))),
        statuses[i % statuses.length],
        daysAgo(rnd(1, 60))
      ]
    );
    count++;
  }
  console.log(`  → ${count} ESG reports seeded`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 RemitFlow v99 — Seeding Tier 1/2/3 feature tables...\n");

  const ownerIds = await getUserIds(10);
  if (!ownerIds.length) {
    console.error("❌ No users found. Run the base seed script first.");
    process.exit(1);
  }
  console.log(`  Using ${ownerIds.length} existing users (IDs: ${ownerIds.join(", ")})\n`);

  const companyRecords = await seedPayrollCompanies(ownerIds);
  const companyIds = companyRecords.length > 0 ? companyRecords : [{ id: 1, ownerId: ownerIds[0] }];
  const companyIdNums = companyIds.map(c => c.id);

  const contractorRecords = await seedContractors(ownerIds);
  await seedContractorInvoices(contractorRecords);
  await seedExpenseReports(ownerIds, companyIdNums);
  await seedMerchantKybReviews(ownerIds);
  await seedPayrollTaxFilings(ownerIds, companyIdNums);
  await seedBusinessSavingsProducts();
  await seedBusinessSavingsAccounts(ownerIds);
  await seedBondOrders(ownerIds);
  await seedLettersOfCredit(ownerIds);
  await seedInvoiceFinancing(ownerIds);
  await seedPayrollRuns(companyIds);
  await seedEmbeddedPayrollApiKeys();
  await seedMortgageApplications(ownerIds);
  await seedBusinessCreditScores(ownerIds);
  await seedEsgReports(ownerIds, companyIdNums);

  console.log("\n✅ v99 seed complete — all Tier 1/2/3 tables populated");
  await pool.end();
}

seed().catch(err => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
