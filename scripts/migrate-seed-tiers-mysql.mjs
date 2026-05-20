#!/usr/bin/env node
/**
 * RemitFlow — Tier 1/2/3 PostgreSQL Migration + Seed Script
 *
 * Creates all 13 tier feature tables in PostgreSQL and seeds them with realistic data.
 * Usage: node scripts/migrate-seed-tiers-postgres.mjs
 */
import postgres from 'postgres';
import dotenv from "dotenv";
dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
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
console.log("✓ Connected to PostgreSQL");

// Get primary user
const [users] = await exec("SELECT id FROM users ORDER BY id LIMIT 1");
if (!users.length) { console.error("No users found — login first"); process.exit(1); }
const uid = users[0].id;
console.log("Primary user ID:", uid);

// ── Helpers ────────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace("T", " "); }
function daysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 19).replace("T", " "); }
function now() { return new Date().toISOString().slice(0, 19).replace("T", " "); }

// ── 1. Payroll Companies ───────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS payroll_companies (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    country VARCHAR(4) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    tax_id VARCHAR(64),
    payroll_frequency ENUM('weekly','bi_weekly','semi_monthly','monthly') NOT NULL DEFAULT 'monthly',
    employee_count INT DEFAULT 0,
    status ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ payroll_companies table ready");

const companies = [
  ["Acme Fintech Ltd", "NG", "NGN", "NG-TAX-001", "monthly", 85],
  ["Diaspora Remit GmbH", "DE", "EUR", "DE-TAX-002", "bi_weekly", 42],
  ["AfriPay Solutions", "GH", "GHS", "GH-TAX-003", "monthly", 130],
];
const companyIds = [];
for (const [name, country, currency, taxId, freq, empCount] of companies) {
  const [ex] = await exec("SELECT id FROM payroll_companies WHERE name=?", [name]);
  if (ex.length) { companyIds.push(ex[0].id); continue; }
  const [res] = await exec(
    "INSERT INTO payroll_companies (owner_id, name, country, currency, tax_id, payroll_frequency, employee_count) VALUES (?,?,?,?,?,?,?)",
    [uid, name, country, currency, taxId, freq, empCount]
  );
  companyIds.push(res.insertId);
}
console.log(`  → ${companyIds.length} payroll companies seeded`);

// ── 2. Contractors ─────────────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS contractors (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(320) NOT NULL,
    country VARCHAR(4) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    tax_id VARCHAR(64),
    bank_account VARCHAR(64),
    bank_name VARCHAR(100),
    status ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ contractors table ready");

const contractorData = [
  ["Emeka Obi", "emeka@contractor.ng", "NG", "NGN", "NG-CON-001", "0123456789", "Access Bank"],
  ["Amara Diallo", "amara@freelance.sn", "SN", "XOF", "SN-CON-002", "SN12345678", "Ecobank Senegal"],
  ["David Mensah", "david@dev.gh", "GH", "GHS", "GH-CON-003", "GH98765432", "GCB Bank"],
  ["Fatou Camara", "fatou@design.gm", "GM", "GMD", "GM-CON-004", "GM11223344", "Trust Bank Gambia"],
  ["Kwesi Asante", "kwesi@analytics.gh", "GH", "USD", "GH-CON-005", "GH55667788", "Stanbic Bank Ghana"],
];
const contractorIds = [];
for (const [name, email, country, currency, taxId, bankAccount, bankName] of contractorData) {
  const [ex] = await exec("SELECT id FROM contractors WHERE email=?", [email]);
  if (ex.length) { contractorIds.push(ex[0].id); continue; }
  const [res] = await exec(
    "INSERT INTO contractors (owner_id, name, email, country, currency, tax_id, bank_account, bank_name) VALUES (?,?,?,?,?,?,?,?)",
    [uid, name, email, country, currency, taxId, bankAccount, bankName]
  );
  contractorIds.push(res.insertId);
}
console.log(`  → ${contractorIds.length} contractors seeded`);

// ── 3. Contractor Invoices ─────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS contractor_invoices (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    contractor_id INT NOT NULL,
    invoice_number VARCHAR(64) NOT NULL,
    description TEXT,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    due_date DATE,
    status ENUM('draft','submitted','approved','paid','rejected','cancelled') NOT NULL DEFAULT 'draft',
    paid_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ contractor_invoices table ready");

const invoiceData = [
  ["INV-2026-001", "Web development services — Q1 2026", 4500.00, "USD", daysAgo(5), "approved"],
  ["INV-2026-002", "Data analytics dashboard — March 2026", 2800.00, "USD", daysAgo(2), "submitted"],
  ["INV-2026-003", "UI/UX design sprint — February 2026", 3200.00, "USD", daysFromNow(10), "draft"],
  ["INV-2026-004", "Backend API integration", 5100.00, "USD", daysAgo(15), "paid"],
  ["INV-2026-005", "Mobile app testing — Q1 2026", 1800.00, "USD", daysFromNow(5), "submitted"],
];
for (let i = 0; i < invoiceData.length; i++) {
  const [invNum, desc, amount, currency, dueDate, status] = invoiceData[i];
  const contractorId = contractorIds[i % contractorIds.length];
  const [ex] = await exec("SELECT id FROM contractor_invoices WHERE invoice_number=?", [invNum]);
  if (!ex.length) {
    await exec(
      "INSERT INTO contractor_invoices (owner_id, contractor_id, invoice_number, description, amount, currency, due_date, status) VALUES (?,?,?,?,?,?,?,?)",
      [uid, contractorId, invNum, desc, amount, currency, dueDate, status]
    );
  }
}
console.log("  → 5 contractor invoices seeded");

// ── 4. Expense Policies ────────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS expense_policies (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    max_amount DECIMAL(18,2),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    requires_receipt TINYINT(1) NOT NULL DEFAULT 1,
    requires_approval TINYINT(1) NOT NULL DEFAULT 1,
    categories JSON,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ expense_policies table ready");

const [exPol] = await exec("SELECT id FROM expense_policies WHERE owner_id=? LIMIT 1", [uid]);
let policyId;
if (exPol.length) {
  policyId = exPol[0].id;
} else {
  const [res] = await exec(
    "INSERT INTO expense_policies (owner_id, name, max_amount, currency, requires_receipt, requires_approval, categories) VALUES (?,?,?,?,?,?,?)",
    [uid, "Standard Expense Policy", 5000.00, "USD", 1, 1, JSON.stringify(["travel","meals","software","equipment","marketing"])]
  );
  policyId = res.insertId;
}
console.log("  → 1 expense policy seeded");

// ── 5. Expense Reports ─────────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS expense_reports (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    policy_id INT,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    status ENUM('draft','submitted','under_review','approved','rejected','paid') NOT NULL DEFAULT 'draft',
    submitted_at DATETIME,
    approved_at DATETIME,
    approver_id INT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ expense_reports table ready");

const reportData = [
  ["Q1 2026 Travel Expenses", "Business travel to Lagos and Accra", 3200.00, "USD", "approved", daysAgo(20), daysAgo(15)],
  ["March 2026 Software Subscriptions", "SaaS tools and cloud services", 850.00, "USD", "submitted", daysAgo(5), null],
  ["Q1 2026 Marketing Expenses", "Digital marketing and events", 4750.00, "USD", "under_review", daysAgo(8), null],
  ["February 2026 Meals & Entertainment", "Client dinners and team lunches", 620.00, "USD", "paid", daysAgo(30), daysAgo(25)],
  ["Equipment Purchase — Q1 2026", "Laptops and peripherals for new hires", 4200.00, "USD", "draft", null, null],
];
const reportIds = [];
for (const [title, desc, amount, currency, status, submittedAt, approvedAt] of reportData) {
  const [ex] = await exec("SELECT id FROM expense_reports WHERE title=? AND owner_id=?", [title, uid]);
  if (ex.length) { reportIds.push(ex[0].id); continue; }
  const [res] = await exec(
    "INSERT INTO expense_reports (owner_id, policy_id, title, description, total_amount, currency, status, submitted_at, approved_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [uid, policyId, title, desc, amount, currency, status, submittedAt, approvedAt]
  );
  reportIds.push(res.insertId);
}
console.log(`  → ${reportIds.length} expense reports seeded`);

// ── 6. Merchant KYB Reviews ────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS merchant_kyb_reviews (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    business_name VARCHAR(200) NOT NULL,
    business_type VARCHAR(100),
    registration_number VARCHAR(100),
    country VARCHAR(4) NOT NULL,
    website VARCHAR(500),
    contact_email VARCHAR(320),
    contact_phone VARCHAR(32),
    annual_revenue DECIMAL(18,2),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    status ENUM('pending','under_review','approved','rejected','more_info_required') NOT NULL DEFAULT 'pending',
    risk_score INT,
    reviewer_notes TEXT,
    submitted_at DATETIME,
    reviewed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ merchant_kyb_reviews table ready");

const kybData = [
  ["Konga Commerce Ltd", "ecommerce", "RC-123456", "NG", "https://konga.ng", "kyb@konga.ng", "+2348012345678", 5000000, "USD", "approved", 25],
  ["PayStack Merchants", "payment_processor", "RC-789012", "NG", "https://paystack.com", "kyb@paystack.com", "+2348087654321", 12000000, "USD", "under_review", 45],
  ["Jumia Food GH", "food_delivery", "GH-REG-001", "GH", "https://jumia.com.gh", "kyb@jumia.gh", "+233201234567", 2500000, "GHS", "pending", null],
  ["Flutterwave Merchants", "fintech", "RC-345678", "NG", "https://flutterwave.com", "kyb@flutterwave.com", "+2348023456789", 25000000, "USD", "approved", 15],
  ["Chipper Cash Ltd", "money_transfer", "UK-REG-2021", "GB", "https://chippercash.com", "kyb@chippercash.com", "+447700900123", 8000000, "USD", "more_info_required", 60],
];
for (const [bizName, bizType, regNum, country, website, email, phone, revenue, currency, status, riskScore] of kybData) {
  const [ex] = await exec("SELECT id FROM merchant_kyb_reviews WHERE registration_number=?", [regNum]);
  if (!ex.length) {
    await exec(
      "INSERT INTO merchant_kyb_reviews (owner_id, business_name, business_type, registration_number, country, website, contact_email, contact_phone, annual_revenue, currency, status, risk_score, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, bizName, bizType, regNum, country, website, email, phone, revenue, currency, status, riskScore, daysAgo(rnd(5, 30))]
    );
  }
}
console.log("  → 5 merchant KYB reviews seeded");

// ── 7. Payroll Tax Filings ─────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS payroll_tax_filings (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    company_id INT,
    tax_year INT NOT NULL,
    tax_period VARCHAR(20) NOT NULL,
    jurisdiction VARCHAR(100) NOT NULL,
    filing_type ENUM('paye','vat','corporate_tax','withholding_tax','pension') NOT NULL DEFAULT 'paye',
    gross_payroll DECIMAL(18,2) NOT NULL,
    tax_amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    status ENUM('draft','filed','accepted','rejected','amended') NOT NULL DEFAULT 'draft',
    filed_at DATETIME,
    due_date DATE,
    reference_number VARCHAR(100),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ payroll_tax_filings table ready");

const taxFilingData = [
  [2026, "Q1-2026", "Nigeria (FIRS)", "paye", 8500000, 1275000, "NGN", "filed", daysAgo(10), "2026-04-30", "FIRS-2026-Q1-001"],
  [2026, "Q1-2026", "Nigeria (FIRS)", "vat", 12000000, 1800000, "NGN", "accepted", daysAgo(15), "2026-04-21", "FIRS-VAT-2026-001"],
  [2026, "February 2026", "Ghana (GRA)", "paye", 450000, 67500, "GHS", "draft", null, "2026-03-31", null],
  [2025, "Q4-2025", "Nigeria (FIRS)", "paye", 7800000, 1170000, "NGN", "accepted", daysAgo(60), "2026-01-31", "FIRS-2025-Q4-001"],
  [2026, "Q1-2026", "Germany (Finanzamt)", "corporate_tax", 250000, 70000, "EUR", "filed", daysAgo(5), "2026-05-31", "DE-TAX-2026-Q1"],
];
for (let i = 0; i < taxFilingData.length; i++) {
  const [taxYear, period, jurisdiction, filingType, grossPayroll, taxAmount, currency, status, filedAt, dueDate, refNum] = taxFilingData[i];
  const companyId = companyIds[i % companyIds.length];
  const [ex] = await exec("SELECT id FROM payroll_tax_filings WHERE reference_number=?", [refNum || `TEMP-${i}`]);
  if (!ex.length) {
    await exec(
      "INSERT INTO payroll_tax_filings (owner_id, company_id, tax_year, tax_period, jurisdiction, filing_type, gross_payroll, tax_amount, currency, status, filed_at, due_date, reference_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, companyId, taxYear, period, jurisdiction, filingType, grossPayroll, taxAmount, currency, status, filedAt, dueDate, refNum]
    );
  }
}
console.log("  → 5 payroll tax filings seeded");

// ── 8. Business Savings Products ──────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS business_savings_products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type ENUM('fixed_deposit','call_deposit','treasury_bill','money_market') NOT NULL DEFAULT 'fixed_deposit',
    min_amount DECIMAL(18,2) NOT NULL,
    max_amount DECIMAL(18,2),
    interest_rate DECIMAL(6,4) NOT NULL,
    tenor_days INT,
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ business_savings_products table ready");

const savingsProducts = [
  ["90-Day Fixed Deposit", "fixed_deposit", 500000, 50000000, 0.1450, 90, "NGN"],
  ["180-Day Fixed Deposit", "fixed_deposit", 1000000, 100000000, 0.1600, 180, "NGN"],
  ["365-Day Fixed Deposit", "fixed_deposit", 2000000, 200000000, 0.1750, 365, "NGN"],
  ["USD Call Deposit", "call_deposit", 10000, 1000000, 0.0450, null, "USD"],
  ["Treasury Bill 91-Day", "treasury_bill", 100000, null, 0.2100, 91, "NGN"],
];
const productIds = [];
for (const [name, type, minAmt, maxAmt, rate, tenor, currency] of savingsProducts) {
  const [ex] = await exec("SELECT id FROM business_savings_products WHERE name=?", [name]);
  if (ex.length) { productIds.push(ex[0].id); continue; }
  const [res] = await exec(
    "INSERT INTO business_savings_products (name, type, min_amount, max_amount, interest_rate, tenor_days, currency) VALUES (?,?,?,?,?,?,?)",
    [name, type, minAmt, maxAmt, rate, tenor, currency]
  );
  productIds.push(res.insertId);
}
console.log(`  → ${productIds.length} savings products seeded`);

// ── 9. Business Savings Accounts ──────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS business_savings_accounts (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    product_id INT,
    account_number VARCHAR(32) NOT NULL,
    principal DECIMAL(18,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    interest_rate DECIMAL(6,4) NOT NULL,
    start_date DATE NOT NULL,
    maturity_date DATE,
    status ENUM('active','matured','withdrawn','cancelled') NOT NULL DEFAULT 'active',
    accrued_interest DECIMAL(18,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ business_savings_accounts table ready");

const savingsAccountData = [
  ["BSA-2026-001", 5000000, "NGN", 0.1450, "2026-01-15", "2026-04-15", "matured", 181250],
  ["BSA-2026-002", 10000000, "NGN", 0.1600, "2026-02-01", "2026-08-01", "active", 213333],
  ["BSA-2026-003", 50000, "USD", 0.0450, "2026-03-01", null, "active", 187.50],
  ["BSA-2026-004", 2000000, "NGN", 0.2100, "2026-04-01", "2026-07-01", "active", 35000],
  ["BSA-2026-005", 20000000, "NGN", 0.1750, "2025-12-01", "2026-12-01", "active", 1020833],
];
for (let i = 0; i < savingsAccountData.length; i++) {
  const [accNum, principal, currency, rate, startDate, maturityDate, status, accruedInterest] = savingsAccountData[i];
  const productId = productIds[i % productIds.length];
  const [ex] = await exec("SELECT id FROM business_savings_accounts WHERE account_number=?", [accNum]);
  if (!ex.length) {
    await exec(
      "INSERT INTO business_savings_accounts (owner_id, product_id, account_number, principal, currency, interest_rate, start_date, maturity_date, status, accrued_interest) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [uid, productId, accNum, principal, currency, rate, startDate, maturityDate, status, accruedInterest]
    );
  }
}
console.log("  → 5 business savings accounts seeded");

// ── 10. Bond Secondary Market Orders ──────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS bond_secondary_market_orders (
    id SERIAL PRIMARY KEY,
    seller_id INT NOT NULL,
    buyer_id INT,
    bond_isin VARCHAR(32) NOT NULL,
    bond_name VARCHAR(200) NOT NULL,
    face_value DECIMAL(18,2) NOT NULL,
    quantity INT NOT NULL,
    ask_price DECIMAL(18,2) NOT NULL,
    bid_price DECIMAL(18,2),
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    yield_rate DECIMAL(6,4),
    maturity_date DATE,
    order_type ENUM('sell','buy') NOT NULL DEFAULT 'sell',
    status ENUM('open','matched','settled','cancelled','expired') NOT NULL DEFAULT 'open',
    matched_at DATETIME,
    settled_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ bond_secondary_market_orders table ready");

const bondOrderData = [
  ["NG0000001234", "FGN Bond 14.5% 2028", 1000000, 10, 1050000, null, "NGN", 0.1380, "2028-03-15", "sell", "open"],
  ["NG0000005678", "FGN Bond 16.0% 2030", 1000000, 5, 980000, 975000, "NGN", 0.1640, "2030-06-30", "sell", "matched"],
  ["NG0000009012", "Lagos State Bond 15.5% 2027", 500000, 20, 520000, null, "NGN", 0.1490, "2027-12-31", "sell", "open"],
  ["GH0000001111", "Ghana Eurobond 8.625% 2034", 1000, 50, 920, 915, "USD", 0.0940, "2034-06-16", "sell", "open"],
  ["KE0000002222", "Kenya Infrastructure Bond 12.5% 2029", 100000, 100, 105000, null, "KES", 0.1190, "2029-09-30", "sell", "open"],
];
for (const [isin, name, faceValue, qty, askPrice, bidPrice, currency, yieldRate, matDate, orderType, status] of bondOrderData) {
  const [ex] = await exec("SELECT id FROM bond_secondary_market_orders WHERE bond_isin=? AND seller_id=?", [isin, uid]);
  if (!ex.length) {
    await exec(
      "INSERT INTO bond_secondary_market_orders (seller_id, bond_isin, bond_name, face_value, quantity, ask_price, bid_price, currency, yield_rate, maturity_date, order_type, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, isin, name, faceValue, qty, askPrice, bidPrice, currency, yieldRate, matDate, orderType, status]
    );
  }
}
console.log("  → 5 bond secondary market orders seeded");

// ── 11. Letters of Credit ──────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS letters_of_credit (
    id SERIAL PRIMARY KEY,
    applicant_id INT NOT NULL,
    lc_number VARCHAR(64) NOT NULL,
    lc_type ENUM('sight','usance','standby','revolving') NOT NULL DEFAULT 'sight',
    beneficiary_name VARCHAR(200) NOT NULL,
    beneficiary_bank VARCHAR(200),
    beneficiary_country VARCHAR(4) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    expiry_date DATE NOT NULL,
    goods_description TEXT,
    port_of_loading VARCHAR(100),
    port_of_discharge VARCHAR(100),
    status ENUM('draft','submitted','issued','amended','utilized','expired','cancelled') NOT NULL DEFAULT 'draft',
    issued_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ letters_of_credit table ready");

const lcData = [
  ["LC-2026-001", "sight", "Shanghai Electronics Co Ltd", "Bank of China", "CN", 250000, "USD", "2026-08-31", "Electronic components and PCBs", "Shanghai", "Lagos", "issued", daysAgo(15)],
  ["LC-2026-002", "usance", "European Machinery GmbH", "Deutsche Bank", "DE", 850000, "EUR", "2026-12-31", "Industrial machinery and spare parts", "Hamburg", "Apapa", "submitted", null],
  ["LC-2026-003", "standby", "US Grain Exporters LLC", "JPMorgan Chase", "US", 1200000, "USD", "2026-06-30", "Wheat and corn shipment", "Houston", "Tema", "issued", daysAgo(30)],
  ["LC-2026-004", "sight", "Indian Textile Mills Pvt Ltd", "HDFC Bank", "IN", 180000, "USD", "2026-09-30", "Cotton fabrics and garments", "Mumbai", "Dakar", "draft", null],
  ["LC-2026-005", "revolving", "Brazilian Coffee Exporters", "Banco do Brasil", "BR", 500000, "USD", "2026-12-31", "Arabica coffee beans", "Santos", "Mombasa", "utilized", daysAgo(45)],
];
for (const [lcNum, lcType, benName, benBank, benCountry, amount, currency, expiryDate, goods, portLoad, portDischarge, status, issuedAt] of lcData) {
  const [ex] = await exec("SELECT id FROM letters_of_credit WHERE lc_number=?", [lcNum]);
  if (!ex.length) {
    await exec(
      "INSERT INTO letters_of_credit (applicant_id, lc_number, lc_type, beneficiary_name, beneficiary_bank, beneficiary_country, amount, currency, expiry_date, goods_description, port_of_loading, port_of_discharge, status, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, lcNum, lcType, benName, benBank, benCountry, amount, currency, expiryDate, goods, portLoad, portDischarge, status, issuedAt]
    );
  }
}
console.log("  → 5 letters of credit seeded");

// ── 12. Invoice Financing Applications ────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS invoice_financing_applications (
    id SERIAL PRIMARY KEY,
    applicant_id INT NOT NULL,
    invoice_number VARCHAR(64) NOT NULL,
    debtor_name VARCHAR(200) NOT NULL,
    debtor_country VARCHAR(4) NOT NULL,
    invoice_amount DECIMAL(18,2) NOT NULL,
    financing_amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    advance_rate DECIMAL(5,4) NOT NULL DEFAULT 0.8000,
    fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0250,
    due_date DATE NOT NULL,
    status ENUM('draft','submitted','under_review','approved','disbursed','repaid','defaulted','cancelled') NOT NULL DEFAULT 'draft',
    approved_at DATETIME,
    disbursed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ invoice_financing_applications table ready");

const invoiceFinancingData = [
  ["INV-FIN-001", "Dangote Industries Ltd", "NG", 5000000, 4000000, "NGN", 0.80, 0.0250, daysFromNow(45), "disbursed", daysAgo(5), daysAgo(3)],
  ["INV-FIN-002", "MTN Nigeria Communications", "NG", 12000000, 9600000, "NGN", 0.80, 0.0200, daysFromNow(30), "approved", daysAgo(2), null],
  ["INV-FIN-003", "Ghana Cocoa Board", "GH", 800000, 640000, "GHS", 0.80, 0.0300, daysFromNow(60), "submitted", null, null],
  ["INV-FIN-004", "Kenya Power & Lighting", "KE", 50000, 40000, "USD", 0.80, 0.0250, daysFromNow(90), "under_review", null, null],
  ["INV-FIN-005", "Safaricom PLC", "KE", 3500000, 2800000, "KES", 0.80, 0.0225, daysFromNow(30), "repaid", daysAgo(30), daysAgo(25)],
];
for (const [invNum, debtorName, debtorCountry, invAmount, finAmount, currency, advRate, feeRate, dueDate, status, approvedAt, disbursedAt] of invoiceFinancingData) {
  const [ex] = await exec("SELECT id FROM invoice_financing_applications WHERE invoice_number=?", [invNum]);
  if (!ex.length) {
    await exec(
      "INSERT INTO invoice_financing_applications (applicant_id, invoice_number, debtor_name, debtor_country, invoice_amount, financing_amount, currency, advance_rate, fee_rate, due_date, status, approved_at, disbursed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, invNum, debtorName, debtorCountry, invAmount, finAmount, currency, advRate, feeRate, dueDate, status, approvedAt, disbursedAt]
    );
  }
}
console.log("  → 5 invoice financing applications seeded");

// ── 13. Payroll Runs ───────────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS payroll_runs (
    id SERIAL PRIMARY KEY,
    company_id INT NOT NULL,
    owner_id INT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    pay_date DATE NOT NULL,
    frequency ENUM('weekly','bi_weekly','semi_monthly','monthly') NOT NULL DEFAULT 'monthly',
    total_gross DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_net DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_deductions DECIMAL(18,2) NOT NULL DEFAULT 0,
    employee_count INT NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    status ENUM('draft','pending_approval','approved','processing','disbursed','failed','cancelled') NOT NULL DEFAULT 'draft',
    approved_by INT,
    approved_at DATETIME,
    disbursed_at DATETIME,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ payroll_runs table ready");

const payrollRunData = [
  [0, "2026-03-01", "2026-03-31", "2026-03-28", "monthly", 8500000, 6800000, 1275000, 425000, 85, "NGN", "disbursed"],
  [0, "2026-04-01", "2026-04-30", "2026-04-28", "monthly", 8750000, 7000000, 1312500, 437500, 87, "NGN", "approved"],
  [1, "2026-04-01", "2026-04-14", "2026-04-15", "bi_weekly", 180000, 144000, 27000, 9000, 42, "EUR", "disbursed"],
  [1, "2026-04-15", "2026-04-30", "2026-04-30", "bi_weekly", 185000, 148000, 27750, 9250, 42, "EUR", "pending_approval"],
  [2, "2026-04-01", "2026-04-30", "2026-04-25", "monthly", 650000, 520000, 97500, 32500, 130, "GHS", "processing"],
];
for (let i = 0; i < payrollRunData.length; i++) {
  const [compIdx, periodStart, periodEnd, payDate, freq, totalGross, totalNet, totalTax, totalDeductions, empCount, currency, status] = payrollRunData[i];
  const companyId = companyIds[compIdx % companyIds.length];
  const [ex] = await exec("SELECT id FROM payroll_runs WHERE company_id=? AND period_start=?", [companyId, periodStart]);
  if (!ex.length) {
    await exec(
      "INSERT INTO payroll_runs (company_id, owner_id, period_start, period_end, pay_date, frequency, total_gross, total_net, total_tax, total_deductions, employee_count, currency, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [companyId, uid, periodStart, periodEnd, payDate, freq, totalGross, totalNet, totalTax, totalDeductions, empCount, currency, status]
    );
  }
}
console.log("  → 5 payroll runs seeded");

// ── 14. Embedded Payroll API Keys ──────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS embedded_payroll_api_keys (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    api_key VARCHAR(128) NOT NULL,
    api_secret_hash VARCHAR(256) NOT NULL,
    scopes JSON,
    rate_limit_per_hour INT NOT NULL DEFAULT 1000,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_used_at DATETIME,
    expires_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ embedded_payroll_api_keys table ready");

const apiKeyData = [
  ["Production API Key", "epk_live_abc123def456ghi789", "hash_prod_001", ["payroll:read","payroll:write","employees:read"], 5000, 1],
  ["Staging API Key", "epk_test_xyz789uvw456rst123", "hash_stag_002", ["payroll:read","employees:read"], 1000, 1],
  ["Partner Integration — Konga", "epk_partner_kng_001", "hash_kng_003", ["payroll:read"], 500, 1],
];
for (const [name, apiKey, secretHash, scopes, rateLimit, isActive] of apiKeyData) {
  const [ex] = await exec("SELECT id FROM embedded_payroll_api_keys WHERE api_key=?", [apiKey]);
  if (!ex.length) {
    await exec(
      "INSERT INTO embedded_payroll_api_keys (owner_id, name, api_key, api_secret_hash, scopes, rate_limit_per_hour, is_active) VALUES (?,?,?,?,?,?,?)",
      [uid, name, apiKey, secretHash, JSON.stringify(scopes), rateLimit, isActive]
    );
  }
}
console.log("  → 3 embedded payroll API keys seeded");

// ── 15. Diaspora Mortgage Applications ────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS diaspora_mortgage_applications (
    id SERIAL PRIMARY KEY,
    applicant_id INT NOT NULL,
    property_address TEXT NOT NULL,
    property_country VARCHAR(4) NOT NULL,
    property_value DECIMAL(18,2) NOT NULL,
    loan_amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    loan_term_years INT NOT NULL DEFAULT 15,
    interest_rate DECIMAL(6,4),
    ltv_ratio DECIMAL(5,4),
    applicant_country VARCHAR(4) NOT NULL,
    employment_status ENUM('employed','self_employed','business_owner','retired') NOT NULL DEFAULT 'employed',
    annual_income DECIMAL(18,2),
    income_currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    status ENUM('draft','submitted','under_review','approved','rejected','disbursed','cancelled') NOT NULL DEFAULT 'draft',
    credit_score INT,
    approved_at DATETIME,
    disbursed_at DATETIME,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ diaspora_mortgage_applications table ready");

const mortgageData = [
  ["15 Banana Island Road, Ikoyi, Lagos", "NG", 250000000, 175000000, "NGN", 20, 0.1850, 0.70, "GB", "employed", 95000, "GBP", "approved", 720, daysAgo(10)],
  ["Plot 45 Maitama District, Abuja", "NG", 180000000, 126000000, "NGN", 15, 0.1950, 0.70, "US", "business_owner", 180000, "USD", "under_review", 680, null],
  ["House 7 East Legon, Accra", "GH", 1200000, 840000, "GHS", 20, 0.2200, 0.70, "CA", "employed", 120000, "CAD", "submitted", null, null],
  ["Villa 3 Karen Estate, Nairobi", "KE", 45000000, 31500000, "KES", 15, 0.1450, 0.70, "GB", "self_employed", 85000, "GBP", "approved", 710, daysAgo(5)],
  ["Apartment 12B Victoria Island, Lagos", "NG", 120000000, 84000000, "NGN", 10, 0.1750, 0.70, "DE", "employed", 75000, "EUR", "draft", null, null],
];
for (const [propAddr, propCountry, propValue, loanAmount, currency, loanTerm, interestRate, ltvRatio, appCountry, empStatus, annualIncome, incomeCurrency, status, creditScore, approvedAt] of mortgageData) {
  const [ex] = await exec("SELECT id FROM diaspora_mortgage_applications WHERE property_address=? AND applicant_id=?", [propAddr, uid]);
  if (!ex.length) {
    await exec(
      "INSERT INTO diaspora_mortgage_applications (applicant_id, property_address, property_country, property_value, loan_amount, currency, loan_term_years, interest_rate, ltv_ratio, applicant_country, employment_status, annual_income, income_currency, status, credit_score, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, propAddr, propCountry, propValue, loanAmount, currency, loanTerm, interestRate, ltvRatio, appCountry, empStatus, annualIncome, incomeCurrency, status, creditScore, approvedAt]
    );
  }
}
console.log("  → 5 diaspora mortgage applications seeded");

// ── 16. Business Credit Scores ─────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS business_credit_scores (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    business_name VARCHAR(200) NOT NULL,
    registration_number VARCHAR(100),
    country VARCHAR(4) NOT NULL,
    score INT NOT NULL,
    grade ENUM('AAA','AA','A','BBB','BB','B','CCC','CC','C','D') NOT NULL DEFAULT 'B',
    payment_history_score INT,
    debt_ratio_score INT,
    revenue_stability_score INT,
    management_score INT,
    industry_risk_score INT,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    annual_revenue DECIMAL(18,2),
    total_debt DECIMAL(18,2),
    credit_limit DECIMAL(18,2),
    report_date DATE NOT NULL,
    next_review_date DATE,
    status ENUM('active','expired','under_review') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ business_credit_scores table ready");

const creditScoreData = [
  ["Acme Fintech Ltd", "RC-123456", "NG", 785, "AA", 90, 85, 88, 82, 75, "NGN", 850000000, 120000000, 200000000, "2026-03-01", "2026-09-01"],
  ["Diaspora Remit GmbH", "DE-REG-789", "DE", 720, "A", 85, 78, 82, 80, 70, "EUR", 12000000, 3500000, 8000000, "2026-02-15", "2026-08-15"],
  ["AfriPay Solutions", "GH-REG-456", "GH", 650, "BBB", 75, 70, 72, 68, 65, "GHS", 45000000, 18000000, 25000000, "2026-04-01", "2026-10-01"],
  ["Lagos Merchant Ltd", "RC-789012", "NG", 580, "BB", 65, 60, 68, 62, 58, "NGN", 250000000, 95000000, 80000000, "2026-01-15", "2026-07-15"],
  ["Nairobi Tech Hub", "KE-REG-123", "KE", 710, "A", 82, 76, 80, 78, 72, "KES", 180000000, 45000000, 90000000, "2026-03-15", "2026-09-15"],
];
for (const [bizName, regNum, country, score, grade, payHist, debtRatio, revStab, mgmt, industryRisk, currency, annualRev, totalDebt, creditLimit, reportDate, nextReview] of creditScoreData) {
  const [ex] = await exec("SELECT id FROM business_credit_scores WHERE registration_number=? AND owner_id=?", [regNum, uid]);
  if (!ex.length) {
    await exec(
      "INSERT INTO business_credit_scores (owner_id, business_name, registration_number, country, score, grade, payment_history_score, debt_ratio_score, revenue_stability_score, management_score, industry_risk_score, currency, annual_revenue, total_debt, credit_limit, report_date, next_review_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, bizName, regNum, country, score, grade, payHist, debtRatio, revStab, mgmt, industryRisk, currency, annualRev, totalDebt, creditLimit, reportDate, nextReview]
    );
  }
}
console.log("  → 5 business credit scores seeded");

// ── 17. ESG Reports ────────────────────────────────────────────────────────────
await exec(`
  CREATE TABLE IF NOT EXISTS esg_reports (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    company_name VARCHAR(200) NOT NULL,
    report_year INT NOT NULL,
    report_period ENUM('Q1','Q2','Q3','Q4','annual') NOT NULL DEFAULT 'annual',
    carbon_emissions_tons DECIMAL(12,2),
    renewable_energy_pct DECIMAL(5,2),
    water_usage_m3 DECIMAL(12,2),
    waste_recycled_pct DECIMAL(5,2),
    female_leadership_pct DECIMAL(5,2),
    employee_training_hours DECIMAL(10,2),
    community_investment_usd DECIMAL(18,2),
    board_independence_pct DECIMAL(5,2),
    esg_score INT,
    environmental_score INT,
    social_score INT,
    governance_score INT,
    rating ENUM('AAA','AA','A','BBB','BB','B','CCC') NOT NULL DEFAULT 'B',
    status ENUM('draft','submitted','published','archived') NOT NULL DEFAULT 'draft',
    published_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✓ esg_reports table ready");

const esgData = [
  ["Acme Fintech Ltd", 2025, "annual", 1250.5, 45.2, 8500, 72.3, 38.5, 2400, 850000, 75.0, 82, 78, 85, 83, "AA", "published", daysAgo(30)],
  ["Diaspora Remit GmbH", 2025, "annual", 320.8, 85.5, 2100, 91.2, 52.0, 3200, 1200000, 85.0, 91, 88, 94, 91, "AAA", "published", daysAgo(45)],
  ["AfriPay Solutions", 2025, "annual", 890.2, 32.1, 5600, 58.7, 28.5, 1800, 450000, 65.0, 68, 65, 72, 67, "BBB", "submitted", null],
  ["Acme Fintech Ltd", 2026, "Q1", 285.3, 48.1, 2100, 74.5, 40.2, 620, 225000, 76.0, 84, 80, 87, 85, "AA", "draft", null],
  ["Lagos Merchant Ltd", 2025, "annual", 2100.7, 18.5, 12000, 42.1, 22.3, 1200, 280000, 55.0, 58, 55, 62, 57, "BB", "published", daysAgo(60)],
];
for (const [compName, reportYear, period, carbonEmissions, renewableEnergy, waterUsage, wasteRecycled, femaleLeadership, trainingHours, communityInvestment, boardIndependence, esgScore, envScore, socialScore, govScore, rating, status, publishedAt] of esgData) {
  const [ex] = await exec("SELECT id FROM esg_reports WHERE company_name=? AND report_year=? AND report_period=?", [compName, reportYear, period]);
  if (!ex.length) {
    await exec(
      "INSERT INTO esg_reports (owner_id, company_name, report_year, report_period, carbon_emissions_tons, renewable_energy_pct, water_usage_m3, waste_recycled_pct, female_leadership_pct, employee_training_hours, community_investment_usd, board_independence_pct, esg_score, environmental_score, social_score, governance_score, rating, status, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uid, compName, reportYear, period, carbonEmissions, renewableEnergy, waterUsage, wasteRecycled, femaleLeadership, trainingHours, communityInvestment, boardIndependence, esgScore, envScore, socialScore, govScore, rating, status, publishedAt]
    );
  }
}
console.log("  → 5 ESG reports seeded");

// ── Done ───────────────────────────────────────────────────────────────────────
await sql.end();
console.log("\n✅ All tier tables created and seeded successfully!");
console.log("   Tables created: payroll_companies, contractors, contractor_invoices,");
console.log("   expense_policies, expense_reports, merchant_kyb_reviews,");
console.log("   payroll_tax_filings, business_savings_products, business_savings_accounts,");
console.log("   bond_secondary_market_orders, letters_of_credit, invoice_financing_applications,");
console.log("   payroll_runs, embedded_payroll_api_keys, diaspora_mortgage_applications,");
console.log("   business_credit_scores, esg_reports");
