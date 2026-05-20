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
console.log("✓ Connected");

// Get primary user
const [users] = await exec("SELECT id FROM users LIMIT 1");
if (!users.length) { console.error("No users found - login first"); process.exit(1); }
const uid = users[0].id;
console.log("Primary user ID:", uid);

// Beneficiaries
const bens = [
  ["James Okonkwo", "GB", "GBP", "Barclays UK", "12345678", 1],
  ["Sarah Chen", "US", "USD", "Chase Bank", "9876543210", 1],
  ["Peter Kamau", "KE", "KES", "Equity Bank", "254712345678", 0],
  ["Marie Dupont", "FR", "EUR", "BNP Paribas", "FR7612345678901234567890189", 0],
  ["David Williams", "US", "USD", "Wells Fargo", "1234567890", 1],
  ["Emma Thompson", "GB", "GBP", "HSBC UK", "87654321", 0],
];
for (const [name, country, currency, bankName, accountNumber, isFav] of bens) {
  const [ex] = await exec("SELECT id FROM beneficiaries WHERE userId=? AND accountNumber=?", [uid, accountNumber]);
  if (!ex.length) await exec(
    "INSERT INTO beneficiaries (userId, name, country, currency, bankName, accountNumber, isFavorite) VALUES (?,?,?,?,?,?,?)",
    [uid, name, country, currency, bankName, accountNumber, isFav]
  );
}
console.log("✓ Beneficiaries seeded");

// Savings goals
const goals = [
  ["Emergency Fund", "500000", "325000", "NGN", "active", 1],
  ["UK Study Abroad", "5000", "1842.50", "GBP", "active", 0],
  ["House Deposit", "10000000", "2847650", "NGN", "active", 1],
  ["Car Purchase", "3000000", "3000000", "NGN", "completed", 0],
];
for (const [name, target, current, currency, status, autoSave] of goals) {
  const [ex] = await exec("SELECT id FROM savings_goals WHERE userId=? AND name=?", [uid, name]);
  if (!ex.length) await exec(
    "INSERT INTO savings_goals (userId, name, targetAmount, currentAmount, currency, status, autoSave, autoSaveAmount, autoSaveFrequency) VALUES (?,?,?,?,?,?,?,?,?)",
    [uid, name, target, current, currency, status, autoSave, autoSave ? "25000" : "0", "monthly"]
  );
}
console.log("✓ Savings goals seeded");

// FX alerts
const fxAlerts = [
  ["NGN", "GBP", "0.00052", "above", "active"],
  ["NGN", "USD", "0.00068", "above", "active"],
  ["USD", "NGN", "1600", "above", "triggered"],
];
for (const [from, to, rate, dir, status] of fxAlerts) {
  const [ex] = await exec("SELECT id FROM fx_alerts WHERE userId=? AND fromCurrency=? AND toCurrency=?", [uid, from, to]);
  if (!ex.length) await exec(
    "INSERT INTO fx_alerts (userId, fromCurrency, toCurrency, targetRate, direction, status) VALUES (?,?,?,?,?,?)",
    [uid, from, to, rate, dir, status]
  );
}
console.log("✓ FX alerts seeded");

// Recurring payments
const recurring = [
  ["Monthly Family Support", "250000", "NGN", "James Okonkwo", "12345678", "Barclays UK", "GB", "monthly"],
  ["Quarterly Business", "500000", "NGN", "Sarah Chen", "9876543210", "Chase Bank", "US", "quarterly"],
];
for (const [name, amount, currency, recName, recAcc, recBank, recCountry, freq] of recurring) {
  const [ex] = await exec("SELECT id FROM recurring_payments WHERE userId=? AND name=?", [uid, name]);
  if (!ex.length) await exec(
    "INSERT INTO recurring_payments (userId, name, amount, currency, recipientName, recipientAccount, recipientBank, recipientCountry, frequency, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [uid, name, amount, currency, recName, recAcc, recBank, recCountry, freq, "active"]
  );
}
console.log("✓ Recurring payments seeded");

// Audit logs
const auditLogs = [
  ["LOGIN", "User logged in from Lagos, Nigeria"],
  ["TRANSFER_SENT", "Sent ₦250,000 to James Okonkwo (GB)"],
  ["KYC_SUBMITTED", "Tier 2 KYC documents submitted"],
  ["KYC_APPROVED", "Tier 2 KYC verification approved"],
  ["WALLET_TOPUP", "NGN wallet topped up by ₦1,000,000"],
  ["2FA_ENABLED", "Two-factor authentication enabled"],
  ["BENEFICIARY_ADDED", "New beneficiary: David Williams (US)"],
  ["SAVINGS_GOAL_CREATED", "New savings goal: UK Study Abroad"],
];
for (const [action, description] of auditLogs) {
  await exec(
    "INSERT INTO audit_logs (userId, action, description) VALUES (?,?,?)",
    [uid, action, description]
  );
}
console.log("✓ Audit logs seeded");

// Virtual accounts
const vas = [
  ["NGN", "0123456789", "GTBank", "058", "ADAEZE OKONKWO - REMITFLOW"],
  ["GBP", "12345678", "Barclays", "20-00-00", "ADAEZE OKONKWO - REMITFLOW"],
  ["USD", "9876543210", "JP Morgan Chase", "021000021", "ADAEZE OKONKWO - REMITFLOW"],
];
for (const [currency, accountNumber, bank, bankCode, accountName] of vas) {
  const [ex] = await exec("SELECT id FROM virtual_accounts WHERE userId=? AND currency=?", [uid, currency]);
  if (!ex.length) await exec(
    "INSERT INTO virtual_accounts (userId, currency, accountNumber, bank, bankCode, accountName, status) VALUES (?,?,?,?,?,?,?)",
    [uid, currency, accountNumber, bank, bankCode, accountName, "active"]
  );
}
console.log("✓ Virtual accounts seeded");

// KYC documents
const kycDocs = [
  ["national_id", "approved", "https://cdn.remitflow.demo/kyc/national_id_001.jpg", 1],
  ["proof_of_address", "approved", "https://cdn.remitflow.demo/kyc/address_001.pdf", 2],
  ["selfie", "approved", "https://cdn.remitflow.demo/kyc/selfie_001.jpg", 2],
];
for (const [docType, status, fileUrl, tier] of kycDocs) {
  const [ex] = await exec("SELECT id FROM kyc_documents WHERE userId=? AND docType=?", [uid, docType]);
  if (!ex.length) await exec(
    "INSERT INTO kyc_documents (userId, docType, status, fileUrl, tier) VALUES (?,?,?,?,?)",
    [uid, docType, status, fileUrl, tier]
  );
}
console.log("✓ KYC documents seeded");

// Cards
const cards = [
  ["virtual", "visa", "4242", 12, 2027, "USD", "active", "ADAEZE OKONKWO", "500.00"],
  ["physical", "mastercard", "8765", 6, 2026, "NGN", "active", "ADAEZE OKONKWO", "500000.00"],
];
for (const [type, brand, last4, expiryMonth, expiryYear, currency, status, cardholderName, spendLimit] of cards) {
  const [ex] = await exec("SELECT id FROM cards WHERE userId=? AND last4=?", [uid, last4]);
  if (!ex.length) await exec(
    "INSERT INTO cards (userId, type, brand, last4, expiryMonth, expiryYear, currency, status, cardholderName, spendLimit) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [uid, type, brand, last4, expiryMonth, expiryYear, currency, status, cardholderName, spendLimit]
  );
}
console.log("✓ Cards seeded");

// Support tickets (uses user_id, message columns)
const tickets = [
  ["Transfer not received", "I sent money 3 days ago but recipient has not received it", "transfer", "resolved", "high"],
  ["KYC document rejected", "My national ID was rejected but it is valid", "kyc", "in_progress", "medium"],
  ["FX rate discrepancy", "The rate shown was different from what was applied", "payments", "open", "low"],
];
const [exTickets] = await exec("SELECT id FROM support_tickets WHERE user_id=? LIMIT 1",[uid]);
if (!exTickets.length) {
  for (const [subject, message, category, status, priority] of tickets) {
    await exec(
      "INSERT INTO support_tickets (user_id, subject, message, category, status, priority) VALUES (?,?,?,?,?,?)",
      [uid, subject, message, category, status, priority]
    );
  }
}
console.log("✓ Support tickets seeded");

// Batch payments
const [exBatch] = await exec("SELECT id FROM batch_payments WHERE userId=? LIMIT 1", [uid]);
if (!exBatch.length) {
  const recipients = JSON.stringify([
    {name:"James Okonkwo", account:"12345678", bank:"Barclays UK", amount:250000, currency:"NGN"},
    {name:"Sarah Chen", account:"9876543210", bank:"Chase Bank", amount:500000, currency:"NGN"},
  ]);
  await exec(
    "INSERT INTO batch_payments (userId, name, totalAmount, currency, recipients, status) VALUES (?,?,?,?,?,?)",
    [uid, "Q1 2024 Payments", "750000.00", "NGN", recipients, "completed"]
  );
}
console.log("✓ Batch payments seeded");

// CBDC wallets
const cbdcWallets = [
  ["eNaira", "1250.50", "eNGN1234567890ABCDEF"],
  ["eCedi", "450.00", "eGHS9876543210FEDCBA"],
];
for (const [currency, balance, walletAddress] of cbdcWallets) {
  const [ex] = await exec("SELECT id FROM cbdc_wallets WHERE userId=? AND currency=?", [uid, currency]);
  if (!ex.length) await exec(
    "INSERT INTO cbdc_wallets (userId, currency, balance, walletAddress, status) VALUES (?,?,?,?,?)",
    [uid, currency, balance, walletAddress, "active"]
  );
}
console.log("✓ CBDC wallets seeded");

// Stablecoin wallets
const stablecoins = [
  ["USDT", "500.00", "0x1234567890abcdef1234567890abcdef12345678", "Ethereum"],
  ["USDC", "250.00", "0xabcdef1234567890abcdef1234567890abcdef12", "Polygon"],
  ["cUSD", "100.00", "0x9876543210fedcba9876543210fedcba98765432", "Celo"],
];
for (const [token, balance, walletAddress, network] of stablecoins) {
  const [ex] = await exec("SELECT id FROM stablecoin_wallets WHERE userId=? AND token=?", [uid, token]);
  if (!ex.length) await exec(
    "INSERT INTO stablecoin_wallets (userId, token, balance, walletAddress, network, status) VALUES (?,?,?,?,?,?)",
    [uid, token, balance, walletAddress, network, "active"]
  );
}
console.log("✓ Stablecoin wallets seeded");

// Payment methods
const paymentMethods = [
  ["bank_account", "GTBank NGN Account", JSON.stringify({accountNumber:"0123456789", bankName:"GTBank", currency:"NGN"}), 1],
  ["card", "Visa *4242", JSON.stringify({last4:"4242", brand:"Visa", expiryMonth:12, expiryYear:2027}), 0],
  ["mobile_money", "MTN Mobile Money", JSON.stringify({phone:"+2348012345678", provider:"MTN"}), 0],
];
for (const [type, name, details, isDefault] of paymentMethods) {
  const [ex] = await exec("SELECT id FROM payment_methods WHERE userId=? AND name=?", [uid, name]);
  if (!ex.length) await exec(
    "INSERT INTO payment_methods (userId, type, name, details, isDefault, status) VALUES (?,?,?,?,?,?)",
    [uid, type, name, details, isDefault, "active"]
  );
}
console.log("✓ Payment methods seeded");

// Consent records (uses user_id, consent_type columns)
const consents = [
  ["marketing_emails", 1, "1.0"],
  ["data_processing", 1, "2.1"],
  ["third_party_sharing", 0, "1.5"],
  ["analytics", 1, "1.0"],
];
for (const [consentType, granted, version] of consents) {
  const [ex] = await exec("SELECT id FROM consent_records WHERE user_id=? AND consent_type=?",[uid, consentType]);
  if (!ex.length) await exec(
    "INSERT INTO consent_records (user_id, consent_type, granted, version) VALUES (?,?,?,?)",
    [uid, consentType, granted, version]
  );
}
console.log("✓ Consent records seeded");

// POS terminals
const posList = [
  ["POS-001-LGS", "Main Store Lagos", "Lagos Island, Lagos", "active", 145, "2847650.00"],
  ["POS-002-ABJ", "Abuja Branch", "Wuse II, Abuja", "active", 89, "1250000.00"],
];
for (const [terminalId, name, location, status, totalTx, totalVol] of posList) {
  const [ex] = await exec("SELECT id FROM pos_terminals WHERE userId=? AND terminalId=?", [uid, terminalId]);
  if (!ex.length) await exec(
    "INSERT INTO pos_terminals (userId, terminalId, name, location, status, totalTransactions, totalVolume) VALUES (?,?,?,?,?,?,?)",
    [uid, terminalId, name, location, status, totalTx, totalVol]
  );
}
console.log("✓ POS terminals seeded");

// Agent account
const [exAgent] = await exec("SELECT id FROM agent_accounts WHERE userId=? LIMIT 1", [uid]);
if (!exAgent.length) {
  await exec(
    "INSERT INTO agent_accounts (userId, agentCode, businessName, location, status, commissionRate, totalTransactions, totalVolume) VALUES (?,?,?,?,?,?,?,?)",
    [uid, "AGT-2024-001", "Okonkwo Financial Services", "Lagos Island, Lagos", "active", "0.0050", 234, "12500000.00"]
  );
}
console.log("✓ Agent account seeded");

// Mojaloop transfers
const [exMoja] = await exec("SELECT id FROM mojaloop_transfers WHERE userId=? LIMIT 1", [uid]);
if (!exMoja.length) {
  await exec(
    "INSERT INTO mojaloop_transfers (userId, transferId, amount, currency, payerFsp, payeeFsp, payerName, payeeName, status) VALUES (?,?,?,?,?,?,?,?,?)",
    [uid, "TRF-" + Date.now(), "50000.00", "NGN", "GTBank", "Equity Bank Kenya", "Adaeze Okonkwo", "Peter Kamau", "committed"]
  );
}
console.log("✓ Mojaloop transfers seeded");

// FX rate locks
const [exLock] = await exec("SELECT id FROM fx_rate_locks WHERE userId=? LIMIT 1", [uid]);
if (!exLock.length) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  await exec(
    "INSERT INTO fx_rate_locks (userId, fromCurrency, toCurrency, lockedRate, amount, expiresAt, status) VALUES (?,?,?,?,?,?,?)",
    [uid, "NGN", "GBP", "0.000498", "500000.00", expiresAt, "active"]
  );
}
console.log("✓ FX rate locks seeded");

// BNPL plan
const [exBnpl] = await exec("SELECT id FROM bnpl_plans WHERE userId=? LIMIT 1", [uid]);
if (!exBnpl.length) {
  const nextPayment = new Date(Date.now() + 30 * 86400000);
  await exec(
    "INSERT INTO bnpl_plans (userId, amount, currency, installments, installmentAmount, paidInstallments, status, nextPaymentDate) VALUES (?,?,?,?,?,?,?,?)",
    [uid, "200000.00", "NGN", 4, "50000.00", 1, "active", nextPayment]
  );
}
console.log("✓ BNPL plan seeded");

// Direct debit
const [exDD] = await exec("SELECT id FROM direct_debits WHERE userId=? LIMIT 1", [uid]);
if (!exDD.length) {
  const nextDebit = new Date(Date.now() + 15 * 86400000);
  await exec(
    "INSERT INTO direct_debits (userId, creditorName, creditorAccount, creditorBank, amount, currency, frequency, nextDebitDate, status) VALUES (?,?,?,?,?,?,?,?,?)",
    [uid, "Netflix Nigeria", "NG123456789", "Zenith Bank", "4500.00", "NGN", "monthly", nextDebit, "active"]
  );
}
console.log("✓ Direct debits seeded");

// Travel rule record
const [exTR] = await exec("SELECT id FROM travel_rule_records WHERE userId=? LIMIT 1", [uid]);
if (!exTR.length) {
  await exec(
    "INSERT INTO travel_rule_records (userId, originatorName, originatorAccount, originatorCountry, beneficiaryName, beneficiaryAccount, beneficiaryCountry, amount, currency, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [uid, "Adaeze Okonkwo", "0123456789", "NG", "James Okonkwo", "12345678", "GB", "250000.00", "NGN", "sent"]
  );
}
console.log("✓ Travel rule records seeded");

console.log("\n✅ All seed data complete!");
console.log("   User ID:", uid);
console.log("   Tables seeded: 20");
await sql.end();
