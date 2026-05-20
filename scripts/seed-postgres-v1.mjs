/**
 * seed-postgres-v1.mjs
 * Comprehensive PostgreSQL seed for RemitFlow using correct camelCase column names.
 * Idempotent: uses ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   LOCAL_DATABASE_URL=postgresql://remitflow:remitflow123@localhost:5432/remitflow node scripts/seed-postgres-v1.mjs
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
    console.warn(`  ⚠️  ${err.message.split('\n')[0]}`);
  }
}

async function seed() {
  console.log('🌱 RemitFlow PostgreSQL Seed v1 starting...\n');

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

  // ── 3. Transactions ────────────────────────────────────────────────────────
  const txData = [
    [uid, 'send', 50000, 'NGN', 'completed', 'Transfer to James Okonkwo', 'TXN001'],
    [uid, 'receive', 200, 'USD', 'completed', 'Payment from Sarah Chen', 'TXN002'],
    [uid, 'send', 150, 'GBP', 'pending', 'Transfer to Pierre Dubois', 'TXN003'],
    [uid, 'topup', 100000, 'NGN', 'completed', 'Wallet top-up via card', 'TXN004'],
    [uid, 'send', 75, 'USD', 'failed', 'Transfer to Fatima Al-Rashid', 'TXN005'],
    [uid, 'send', 25000, 'NGN', 'completed', 'Airtime purchase', 'TXN006'],
    [uid, 'receive', 500, 'USD', 'completed', 'Referral bonus', 'TXN007'],
    [uid, 'send', 300, 'EUR', 'completed', 'Bill payment', 'TXN008'],
  ];
  for (const [userId, type, amount, currency, status, description, ref] of txData) {
    await q(
      `INSERT INTO transactions ("userId", type, amount, currency, status, description, reference, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,now() - (random()*30 || ' days')::interval,now())
       ON CONFLICT DO NOTHING`,
      [userId, type, amount, currency, status, description, ref]
    );
  }
  console.log('✅ Transactions seeded');

  // ── 4. Beneficiaries ───────────────────────────────────────────────────────
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
      `INSERT INTO beneficiaries ("userId", name, country, currency, "bankName", "accountNumber", "isFavorite", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())
       ON CONFLICT DO NOTHING`,
      [userId, name, country, currency, bankName, accountNumber, isFav]
    );
  }
  console.log('✅ Beneficiaries seeded');

  // ── 5. Cards ───────────────────────────────────────────────────────────────
  await q(`INSERT INTO cards ("userId", type, last4, brand, "expiryMonth", "expiryYear", status, "isDefault", "createdAt", "updatedAt")
    VALUES ($1,'virtual','4242','Visa',12,2027,'active',true,now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO cards ("userId", type, last4, brand, "expiryMonth", "expiryYear", status, "isDefault", "createdAt", "updatedAt")
    VALUES ($1,'physical','5555','Mastercard',6,2026,'active',false,now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Cards seeded');

  // ── 6. Savings Goals ───────────────────────────────────────────────────────
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

  // ── 7. Notifications ───────────────────────────────────────────────────────
  const notifs = [
    [uid, 'transfer', 'Transfer Sent', 'Your transfer of ₦50,000 to James Okonkwo was successful.', true],
    [uid, 'security', 'New Login Detected', 'A new login was detected from Lagos, Nigeria.', false],
    [uid, 'promo', 'Rate Alert Triggered', 'GBP/NGN has reached your target rate of 1,850.', false],
    [uid, 'kyc', 'KYC Approved', 'Your Tier 2 KYC verification has been approved.', true],
  ];
  for (const [userId, type, title, message, isRead] of notifs) {
    await q(
      `INSERT INTO notifications ("userId", type, title, message, "isRead", "createdAt")
       VALUES ($1,$2,$3,$4,$5,now() - (random()*7 || ' days')::interval) ON CONFLICT DO NOTHING`,
      [userId, type, title, message, isRead]
    );
  }
  console.log('✅ Notifications seeded');

  // ── 8. FX Alerts ──────────────────────────────────────────────────────────
  await q(`INSERT INTO "fxAlerts" ("userId", "fromCurrency", "toCurrency", "targetRate", direction, status, "createdAt", "updatedAt")
    VALUES ($1,'GBP','NGN',1850,'above','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO "fxAlerts" ("userId", "fromCurrency", "toCurrency", "targetRate", direction, status, "createdAt", "updatedAt")
    VALUES ($1,'USD','NGN',1550,'below','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ FX alerts seeded');

  // ── 9. Support Tickets ─────────────────────────────────────────────────────
  await q(`INSERT INTO "supportTickets" ("userId", subject, description, status, priority, "createdAt", "updatedAt")
    VALUES ($1,'Transfer Delayed','My transfer to UK has been pending for 2 days.','open','high',now() - interval '2 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO "supportTickets" ("userId", subject, description, status, priority, "createdAt", "updatedAt")
    VALUES ($1,'Card Declined','My virtual card was declined at an online store.','resolved','medium',now() - interval '5 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Support tickets seeded');

  // ── 10. KYC Documents ─────────────────────────────────────────────────────
  await q(`INSERT INTO "kycDocuments" ("userId", type, status, "documentUrl", "createdAt", "updatedAt")
    VALUES ($1,'passport','approved','https://example.com/docs/passport.jpg',now() - interval '30 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO "kycDocuments" ("userId", type, status, "documentUrl", "createdAt", "updatedAt")
    VALUES ($1,'utility_bill','approved','https://example.com/docs/utility.jpg',now() - interval '30 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ KYC documents seeded');

  // ── 11. Recurring Payments ────────────────────────────────────────────────
  await q(`INSERT INTO "recurringPayments" ("userId", name, amount, currency, frequency, "nextRun", status, "createdAt", "updatedAt")
    VALUES ($1,'Monthly Rent',150000,'NGN','monthly',now() + interval '15 days','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO "recurringPayments" ("userId", name, amount, currency, frequency, "nextRun", status, "createdAt", "updatedAt")
    VALUES ($1,'Netflix Subscription',15.99,'USD','monthly',now() + interval '8 days','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Recurring payments seeded');

  // ── 12. Virtual Accounts ──────────────────────────────────────────────────
  await q(`INSERT INTO "virtualAccounts" ("userId", currency, "accountNumber", "bankName", "bankCode", status, "createdAt", "updatedAt")
    VALUES ($1,'NGN','0123456789','Wema Bank','035','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO "virtualAccounts" ("userId", currency, "accountNumber", "bankName", "bankCode", status, "createdAt", "updatedAt")
    VALUES ($1,'USD','9876543210','Stripe Treasury','999','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Virtual accounts seeded');

  // ── 13. Disputes ──────────────────────────────────────────────────────────
  await q(`INSERT INTO disputes ("userId", type, amount, currency, description, status, "createdAt", "updatedAt")
    VALUES ($1,'unauthorized_transaction',5000,'NGN','Unrecognized debit of ₦5,000 on my account.','open',now() - interval '3 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Disputes seeded');

  // ── 14. Referrals ─────────────────────────────────────────────────────────
  if (userIds.length > 1) {
    await q(`INSERT INTO referrals ("referrerId", "referredId", status, reward, "createdAt")
      VALUES ($1,$2,'completed',500,now() - interval '10 days') ON CONFLICT DO NOTHING`, [uid, userIds[1]]);
    await q(`INSERT INTO referrals ("referrerId", "referredId", status, reward, "createdAt")
      VALUES ($1,$2,'pending',0,now() - interval '2 days') ON CONFLICT DO NOTHING`, [uid, userIds[2] ?? userIds[1]]);
  }
  console.log('✅ Referrals seeded');

  // ── 15. BNPL Plans ────────────────────────────────────────────────────────
  await q(`INSERT INTO "bnplPlans" ("userId", merchant, amount, currency, installments, "amountPerInstallment", status, "createdAt", "updatedAt")
    VALUES ($1,'Jumia',120000,'NGN',4,30000,'active',now() - interval '5 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ BNPL plans seeded');

  // ── 16. CBDC Wallets ──────────────────────────────────────────────────────
  await q(`INSERT INTO "cbdcWallets" ("userId", currency, balance, status, "createdAt", "updatedAt")
    VALUES ($1,'eNGN',50000,'active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO "cbdcWallets" ("userId", currency, balance, status, "createdAt", "updatedAt")
    VALUES ($1,'eCedi',1200,'active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ CBDC wallets seeded');

  // ── 17. Stablecoin Wallets ────────────────────────────────────────────────
  await q(`INSERT INTO "stablecoinWallets" ("userId", symbol, balance, "walletAddress", network, "createdAt", "updatedAt")
    VALUES ($1,'USDT',250.00,'0xAbCdEf1234567890AbCdEf1234567890AbCdEf12','Ethereum',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO "stablecoinWallets" ("userId", symbol, balance, "walletAddress", network, "createdAt", "updatedAt")
    VALUES ($1,'USDC',100.00,'0x1234567890AbCdEf1234567890AbCdEf12345678','Polygon',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Stablecoin wallets seeded');

  // ── 18. Direct Debit Mandates ─────────────────────────────────────────────
  await q(`INSERT INTO "directDebitMandates" ("userId", "merchantName", amount, currency, frequency, status, "createdAt", "updatedAt")
    VALUES ($1,'Spotify',9.99,'USD','monthly','active',now() - interval '60 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Direct debit mandates seeded');

  // ── 19. Rate Locks ────────────────────────────────────────────────────────
  await q(`INSERT INTO "rateLocks" ("userId", "fromCurrency", "toCurrency", rate, amount, status, "expiresAt", "createdAt", "updatedAt")
    VALUES ($1,'GBP','NGN',1847.50,500,'active',now() + interval '24 hours',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Rate locks seeded');

  // ── 20. Batch Payments ────────────────────────────────────────────────────
  await q(`INSERT INTO "batchPayments" ("userId", name, status, "totalAmount", currency, "recipientCount", "createdAt", "updatedAt")
    VALUES ($1,'October Payroll',1500000,'NGN','completed',25,now() - interval '12 days',now()) ON CONFLICT DO NOTHING`, [uid]);
  console.log('✅ Batch payments seeded');

  // ── 21. Audit Logs ────────────────────────────────────────────────────────
  const auditEntries = [
    [uid, 'login', 'User logged in', '41.58.100.1', 'Mozilla/5.0'],
    [uid, 'transfer_sent', 'Transfer of ₦50,000 sent', '41.58.100.1', 'Mozilla/5.0'],
    [uid, 'kyc_upload', 'KYC document uploaded', '41.58.100.1', 'Mozilla/5.0'],
    [uid, 'card_created', 'Virtual card created', '41.58.100.1', 'Mozilla/5.0'],
  ];
  for (const [userId, action, details, ip, ua] of auditEntries) {
    await q(
      `INSERT INTO "auditLogs" ("userId", action, details, "ipAddress", "userAgent", "createdAt")
       VALUES ($1,$2,$3,$4,$5,now() - (random()*14 || ' days')::interval) ON CONFLICT DO NOTHING`,
      [userId, action, details, ip, ua]
    );
  }
  console.log('✅ Audit logs seeded');

  // ── 22. FX Rate Cache ─────────────────────────────────────────────────────
  const fxRates = [
    ['USD', 'NGN', 1572.50], ['GBP', 'NGN', 1987.30], ['EUR', 'NGN', 1710.20],
    ['USD', 'GHS', 15.80], ['USD', 'KES', 129.50], ['USD', 'ZAR', 18.45],
    ['GBP', 'USD', 1.265], ['EUR', 'USD', 1.088], ['USD', 'AED', 3.673],
    ['USD', 'XOF', 612.40], ['USD', 'MAD', 9.95], ['USD', 'EGP', 48.20],
  ];
  for (const [from, to, rate] of fxRates) {
    await q(
      `INSERT INTO "fxRateCache" ("fromCurrency", "toCurrency", rate, "updatedAt")
       VALUES ($1,$2,$3,now())
       ON CONFLICT ("fromCurrency", "toCurrency") DO UPDATE SET rate=$3, "updatedAt"=now()`,
      [from, to, rate]
    );
  }
  console.log('✅ FX rate cache seeded');

  // ── 23. Tier Feature Tables ───────────────────────────────────────────────
  // Payroll companies
  await q(`INSERT INTO payroll_companies ("userId", "companyName", "registrationNumber", country, currency, "employeeCount", status, "createdAt", "updatedAt")
    VALUES ($1,'RemitFlow Ltd','RC123456','NG','NGN',45,'active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO payroll_companies ("userId", "companyName", "registrationNumber", country, currency, "employeeCount", status, "createdAt", "updatedAt")
    VALUES ($1,'Diaspora Tech Inc','US987654','US','USD',12,'active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  // Contractors
  await q(`INSERT INTO contractors ("userId", name, email, country, currency, "taxId", status, "createdAt", "updatedAt")
    VALUES ($1,'Chidi Okeke','chidi@example.com','NG','NGN','TIN123456','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);
  await q(`INSERT INTO contractors ("userId", name, email, country, currency, "taxId", status, "createdAt", "updatedAt")
    VALUES ($1,'Aisha Bello','aisha@example.com','GH','GHS','GH987654','active',now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  // Business savings
  await q(`INSERT INTO business_savings_accounts ("userId", "productId", "accountNumber", balance, currency, status, "maturityDate", "createdAt", "updatedAt")
    VALUES ($1,1,'BSA001',500000,'NGN','active',now() + interval '90 days',now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  // Bond secondary market orders
  await q(`INSERT INTO bond_secondary_market_orders ("userId", "bondIsin", "bondName", "orderType", quantity, "pricePerUnit", currency, status, "createdAt", "updatedAt")
    VALUES ($1,'NG0000123456','FGN Bond 2027','buy',10,980,'NGN','pending',now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  // Letters of credit
  await q(`INSERT INTO letters_of_credit ("userId", "applicantName", "beneficiaryName", "beneficiaryCountry", amount, currency, "expiryDate", status, "createdAt", "updatedAt")
    VALUES ($1,'RemitFlow Ltd','Supplier Co Ltd','CN',50000,'USD',now() + interval '90 days','draft',now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  // Invoice financing
  await q(`INSERT INTO invoice_financing_applications ("userId", "invoiceNumber", "invoiceAmount", currency, "buyerName", "buyerCountry", "dueDate", status, "createdAt", "updatedAt")
    VALUES ($1,'INV-2026-001',25000,'USD','Acme Corp','US',now() + interval '30 days','pending',now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  // Business credit scores
  await q(`INSERT INTO business_credit_scores ("userId", score, grade, "reportDate", "createdAt", "updatedAt")
    VALUES ($1,720,'B+',now(),now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  // ESG reports
  await q(`INSERT INTO esg_reports ("userId", "reportYear", "carbonEmissionsTons", "renewableEnergyPct", "employeeDiversityPct", "communityInvestmentUsd", status, "createdAt", "updatedAt")
    VALUES ($1,2025,45.2,68.5,42.0,15000,'published',now(),now()) ON CONFLICT DO NOTHING`, [uid]);

  console.log('✅ Tier feature tables seeded');

  // ── 24. Feature Flags ─────────────────────────────────────────────────────
  const flags = [
    ['ENABLE_CBDC', 'CBDC Transfers', 'Enable CBDC transfers', 'global', true, 100],
    ['ENABLE_STABLECOIN', 'Stablecoin Payments', 'Enable stablecoin payments', 'global', true, 100],
    ['ENABLE_MOJALOOP', 'Mojaloop Instant Payments', 'Enable Mojaloop', 'global', true, 100],
    ['ENABLE_RATE_ALERTS', 'FX Rate Alerts', 'Enable FX rate alerts', 'global', true, 100],
    ['ENABLE_BNPL', 'Buy Now Pay Later', 'Enable BNPL', 'global', true, 80],
    ['ENABLE_CRYPTO', 'Crypto Payments', 'Enable crypto payments', 'global', false, 0],
    ['ENABLE_HNW', 'HNW Banking', 'Enable HNW private banking', 'global', true, 100],
    ['ENABLE_SME_TRADE', 'SME Trade Payments', 'Enable SME trade', 'global', true, 100],
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

  // ── 25. FX Rate Cache (additional pairs) ─────────────────────────────────
  const additionalRates = [
    ['GBP', 'EUR', 1.165], ['GBP', 'USD', 1.265], ['EUR', 'GBP', 0.858],
    ['NGN', 'USD', 0.000636], ['GHS', 'USD', 0.0633], ['KES', 'USD', 0.00772],
  ];
  for (const [from, to, rate] of additionalRates) {
    await q(
      `INSERT INTO "fxRateCache" ("fromCurrency", "toCurrency", rate, "updatedAt")
       VALUES ($1,$2,$3,now())
       ON CONFLICT ("fromCurrency", "toCurrency") DO UPDATE SET rate=$3, "updatedAt"=now()`,
      [from, to, rate]
    );
  }
  console.log('✅ Additional FX rates seeded');

  await pool.end();
  console.log('\n🎉 All seed data inserted successfully into PostgreSQL!');
  console.log(`   Primary user: id=${uid}, email=patrick@remitflow.io, role=admin`);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
