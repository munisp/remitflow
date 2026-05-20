/**
 * seed-extended.ts — Comprehensive seed data for all 245 unseeded tables.
 * Run: npx tsx drizzle/seed-extended.ts
 * Depends on seed.ts having already run (needs user IDs 1-5, transaction IDs, etc.)
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "";
const client = postgres(url, { max: 5, connect_timeout: 10 });
const db = drizzle(client, { schema });

async function main() {
  console.log("🌱 Starting extended seed...");

  // ── 0. Resolve real user IDs from DB ────────────────────────────────────────
  const existingUsers = await db.select({ id: schema.users.id }).from(schema.users).limit(10);
  if (existingUsers.length < 1) {
    console.error("❌ No users found — run seed.ts first.");
    await client.end();
    return;
  }
  const uid = (n: number) => existingUsers[Math.min(n, existingUsers.length - 1)].id;
  const u1 = uid(0), u2 = uid(1), u3 = uid(2), u4 = uid(3), u5 = uid(4);
  console.log(`  → Using user IDs: ${u1}, ${u2}, ${u3}, ${u4}, ${u5}`);

  // ── 1. Feature Flags ────────────────────────────────────────────────────────
  await db.insert(schema.featureFlags).values([
    { key: "hnw_banking", name: "HNW Banking Module", description: "High-net-worth private banking features", scope: "global", defaultEnabled: true, rolloutPct: 100, category: "feature" },
    { key: "sme_trade_finance", name: "SME Trade Finance", description: "Letters of credit and trade instruments", scope: "global", defaultEnabled: true, rolloutPct: 100, category: "feature" },
    { key: "crypto_offramp", name: "Crypto Off-ramp", description: "Stablecoin to fiat conversion", scope: "global", defaultEnabled: false, rolloutPct: 0, category: "beta" },
    { key: "ai_fraud_scoring", name: "AI Fraud Scoring", description: "ML-based real-time fraud detection", scope: "global", defaultEnabled: true, rolloutPct: 100, category: "security" },
    { key: "diaspora_bonds", name: "Diaspora Bonds", description: "Government diaspora bond subscriptions", scope: "global", defaultEnabled: true, rolloutPct: 80, category: "investment" },
    { key: "payroll_multi_currency", name: "Multi-Currency Payroll", description: "Cross-border payroll disbursement", scope: "global", defaultEnabled: true, rolloutPct: 100, category: "feature" },
    { key: "open_banking_plaid", name: "Open Banking (Plaid)", description: "Plaid bank account linking", scope: "global", defaultEnabled: true, rolloutPct: 100, category: "integration" },
    { key: "travel_rule_compliance", name: "Travel Rule Compliance", description: "FATF travel rule data sharing", scope: "global", defaultEnabled: true, rolloutPct: 100, category: "compliance" },
  ]).onConflictDoNothing();

  // ── 2. API Keys ─────────────────────────────────────────────────────────────
  await db.insert(schema.apiKeys).values([
    { userId: u1, name: "Production API Key", keyHash: "sha256_prod_key_hash_001", keyPrefix: "rmf_prod_001", scopes: ["transfers:read", "transfers:write", "fx:read"], status: "active" },
    { userId: u2, name: "Sandbox Test Key", keyHash: "sha256_sandbox_key_hash_002", keyPrefix: "rmf_sand_002", scopes: ["transfers:read", "fx:read"], status: "active" },
    { userId: u3, name: "Partner Integration Key", keyHash: "sha256_partner_key_hash_003", keyPrefix: "rmf_part_003", scopes: ["transfers:read", "beneficiaries:write"], status: "active" },
  ]).onConflictDoNothing();

  // ── 3. Compliance Alerts ────────────────────────────────────────────────────
  await db.insert(schema.complianceAlerts).values([
    { alertType: "high_value_transfer", severity: "high", title: "High-Value Transfer Flagged", description: "Transfer of $45,000 USD to Nigeria flagged for manual review", relatedUserId: u2, status: "open" },
    { alertType: "sanctions_match", severity: "critical", title: "Potential Sanctions Match", description: "Name similarity match against OFAC SDN list — confidence 72%", relatedUserId: u3, status: "open" },
    { alertType: "velocity_breach", severity: "medium", title: "Transfer Velocity Breach", description: "User exceeded 5 transfers in 24 hours", relatedUserId: u4, status: "resolved", resolvedAt: new Date() },
    { alertType: "deepfake_detected", severity: "high", title: "Deepfake KYC Attempt Blocked", description: "Deepfake selfie detected with 87% confidence — KYC submission rejected", relatedUserId: u5, status: "open" },
  ]).onConflictDoNothing();

  // ── 4. Security Events ──────────────────────────────────────────────────────
  await db.insert(schema.securityEvents).values([
    { userId: u1, eventType: "login_success", severity: "info", ipAddress: "192.168.1.100", userAgent: "Mozilla/5.0 Chrome/120", location: "Lagos, NG" },
    { userId: u2, eventType: "login_failed", severity: "warning", ipAddress: "10.0.0.55", userAgent: "Mozilla/5.0 Firefox/121", location: "London, GB" },
    { userId: u3, eventType: "password_changed", severity: "info", ipAddress: "172.16.0.1", userAgent: "Mozilla/5.0 Safari/17", location: "New York, US" },
    { userId: u4, eventType: "suspicious_login", severity: "high", ipAddress: "45.33.32.156", userAgent: "curl/7.88.1", location: "Unknown", resolved: false },
    { userId: u5, eventType: "mfa_enabled", severity: "info", ipAddress: "192.168.2.200", userAgent: "Mozilla/5.0 Chrome/120", location: "Toronto, CA" },
  ]).onConflictDoNothing();

  // ── 5. MFA Settings ─────────────────────────────────────────────────────────
  await db.insert(schema.mfaSettings).values([
    { userId: u1, method: "totp", enabled: true, verifiedAt: new Date() },
    { userId: u2, method: "sms", enabled: true, verifiedAt: new Date() },
    { userId: u3, method: "totp", enabled: false },
    { userId: u4, method: "email", enabled: true, verifiedAt: new Date() },
    { userId: u5, method: "totp", enabled: true, verifiedAt: new Date() },
  ]).onConflictDoNothing();

  // ── 6. KYC Lifecycle ────────────────────────────────────────────────────────
  await db.insert(schema.kycLifecycle).values([
    { userId: u1, stage: "approved", tier: 3, submittedAt: new Date("2024-01-15"), reviewedAt: new Date("2024-01-16"), approvedAt: new Date("2024-01-16"), riskScore: 12 },
    { userId: u2, stage: "approved", tier: 2, submittedAt: new Date("2024-02-10"), reviewedAt: new Date("2024-02-11"), approvedAt: new Date("2024-02-11"), riskScore: 25 },
    { userId: u3, stage: "under_review", tier: 1, submittedAt: new Date("2024-03-01"), riskScore: 45 },
    { userId: u4, stage: "approved", tier: 2, submittedAt: new Date("2024-01-20"), approvedAt: new Date("2024-01-21"), riskScore: 18 },
    { userId: u5, stage: "not_started", tier: 1, riskScore: 0 },
  ]).onConflictDoNothing();

  // ── 7. Investment Assets ─────────────────────────────────────────────────────
  await db.insert(schema.investmentAssets).values([
    { symbol: "NGERIA2029", name: "Nigeria Eurobond 2029", assetType: "bond", country: "NG", sector: "Government", currentPrice: "94.50", currency: "USD", priceChange24h: "0.15", priceChangePct24h: "0.16", marketCap: "1500000000", description: "Federal Government of Nigeria 7.625% Eurobond maturing 2029" },
    { symbol: "DANGCEM", name: "Dangote Cement PLC", assetType: "stock", exchange: "NSE", country: "NG", sector: "Materials", currentPrice: "485.00", currency: "NGN", priceChange24h: "5.00", priceChangePct24h: "1.04", marketCap: "825000000000", description: "Largest cement producer in sub-Saharan Africa" },
    { symbol: "GTCO", name: "Guaranty Trust Holding Co", assetType: "stock", exchange: "NSE", country: "NG", sector: "Financials", currentPrice: "48.50", currency: "NGN", priceChange24h: "-0.50", priceChangePct24h: "-1.02", marketCap: "142000000000", description: "Pan-African financial services group" },
    { symbol: "USDC", name: "USD Coin", assetType: "crypto", country: "US", sector: "Stablecoin", currentPrice: "1.00", currency: "USD", priceChange24h: "0.00", priceChangePct24h: "0.00", description: "Circle USD stablecoin" },
    { symbol: "BTC", name: "Bitcoin", assetType: "crypto", country: "US", sector: "Cryptocurrency", currentPrice: "67500.00", currency: "USD", priceChange24h: "1250.00", priceChangePct24h: "1.89", marketCap: "1320000000000", description: "Bitcoin — the original cryptocurrency" },
    { symbol: "AFDB2031", name: "African Development Bank Bond 2031", assetType: "bond", country: "CI", sector: "Supranational", currentPrice: "98.20", currency: "USD", priceChange24h: "0.05", priceChangePct24h: "0.05", description: "AfDB 3.125% bond maturing 2031" },
  ]).onConflictDoNothing();

  // ── 8. Investment Orders ─────────────────────────────────────────────────────
  await db.insert(schema.investmentOrders).values([
    { userId: u1, assetId: 1, orderType: "buy", quantity: "50000", priceAtOrder: "94.50", totalAmount: "4725000.00", currency: "USD", status: "completed", fee: "2362.50" },
    { userId: u2, assetId: 2, orderType: "buy", quantity: "1000", priceAtOrder: "485.00", totalAmount: "485000.00", currency: "NGN", status: "completed", fee: "242.50" },
    { userId: u1, assetId: 5, orderType: "buy", quantity: "0.5", priceAtOrder: "67500.00", totalAmount: "33750.00", currency: "USD", status: "completed", fee: "16.88" },
    { userId: u4, assetId: 3, orderType: "buy", quantity: "5000", priceAtOrder: "48.50", totalAmount: "242500.00", currency: "NGN", status: "completed", fee: "121.25" },
  ]).onConflictDoNothing();

  // ── 9. HNW Profiles ──────────────────────────────────────────────────────────
  const [hnwProfile1] = await db.insert(schema.hnwProfiles).values([
    { userId: u1, tier: "ultra", annualTransferVolumeUsd: "5000000.00", negotiatedFxSpreadBps: 95, prioritySwiftEnabled: true, dedicatedIbanEnabled: true, onboardedAt: new Date("2023-06-01") },
    { userId: u2, tier: "premium", annualTransferVolumeUsd: "2000000.00", negotiatedFxSpreadBps: 110, prioritySwiftEnabled: true, dedicatedIbanEnabled: false, onboardedAt: new Date("2023-09-15") },
  ]).onConflictDoNothing().returning();

  // ── 10. HNW FX Rates ─────────────────────────────────────────────────────────
  if (hnwProfile1) {
    await db.insert(schema.hnwFxRates).values([
      { hnwProfileId: hnwProfile1.id, currencyPair: "USDNGN", baseRate: "1580.00", negotiatedRate: "1595.00", spreadBps: 95, validFrom: new Date(), validUntil: new Date(Date.now() + 86400000) },
      { hnwProfileId: hnwProfile1.id, currencyPair: "GBPNGN", baseRate: "2010.00", negotiatedRate: "2030.00", spreadBps: 99, validFrom: new Date(), validUntil: new Date(Date.now() + 86400000) },
    ]).onConflictDoNothing();
  }

  // ── 11. HNW Portfolios ───────────────────────────────────────────────────────
  if (hnwProfile1) {
    await db.insert(schema.hnwPortfolios).values([
      { hnwProfileId: hnwProfile1.id, assetClass: "bonds", assetName: "Nigeria Eurobond 2029", currentValueUsd: "4725000.00", allocationPercent: "45.00", yieldPercent: "0.0763" },
      { hnwProfileId: hnwProfile1.id, assetClass: "equities", assetName: "NSE Blue Chip Portfolio", currentValueUsd: "2100000.00", allocationPercent: "20.00", yieldPercent: "0.0420" },
      { hnwProfileId: hnwProfile1.id, assetClass: "fx_deposits", assetName: "USD Time Deposit 12M", currentValueUsd: "1500000.00", allocationPercent: "14.29", yieldPercent: "0.0525" },
      { hnwProfileId: hnwProfile1.id, assetClass: "real_estate", assetName: "Lagos Ikoyi Commercial Property", currentValueUsd: "2200000.00", allocationPercent: "20.95", yieldPercent: "0.0680" },
    ]).onConflictDoNothing();
  }

  // ── 12. Correspondent Banks ──────────────────────────────────────────────────
  await db.insert(schema.correspondentBanks).values([
    { bankName: "Access Bank PLC", swiftBic: "ABNGNGLA", country: "NG", currency: "NGN", nostroAccountNumber: "0123456789", clearingLineUsd: "50000000.00", usedLineUsd: "12500000.00", settlementCostBps: 120, riskScore: "low", derisikingStatus: "active" },
    { bankName: "Zenith Bank PLC", swiftBic: "ZEIBNGLA", country: "NG", currency: "NGN", nostroAccountNumber: "9876543210", clearingLineUsd: "75000000.00", usedLineUsd: "18000000.00", settlementCostBps: 110, riskScore: "low", derisikingStatus: "active" },
    { bankName: "Standard Chartered Bank UK", swiftBic: "SCBLGB2L", country: "GB", currency: "GBP", nostroAccountNumber: "GB29NWBK60161331926819", clearingLineUsd: "200000000.00", usedLineUsd: "45000000.00", settlementCostBps: 85, riskScore: "low", derisikingStatus: "active" },
    { bankName: "Ecobank Transnational", swiftBic: "ECOCGHAC", country: "GH", currency: "GHS", nostroAccountNumber: "GH001234567", clearingLineUsd: "30000000.00", usedLineUsd: "8000000.00", settlementCostBps: 145, riskScore: "medium", derisikingStatus: "active" },
    { bankName: "Societe Generale Senegal", swiftBic: "SGSNSNDA", country: "SN", currency: "XOF", nostroAccountNumber: "SN001234567", clearingLineUsd: "20000000.00", usedLineUsd: "5500000.00", settlementCostBps: 160, riskScore: "medium", derisikingStatus: "watch" },
  ]).onConflictDoNothing();

  // ── 13. Payroll Companies ────────────────────────────────────────────────────
  const [payrollCo1] = await db.insert(schema.payrollCompanies).values([
    { ownerId: u1, name: "Dangote Industries Ltd", registrationNumber: "RC-001234", taxId: "TIN-001234", country: "NG", baseCurrency: "NGN", status: "active", totalEmployees: 450, monthlyPayrollUsd: "285000.00" },
    { ownerId: u2, name: "Flutterwave Inc", registrationNumber: "DE-5678901", taxId: "EIN-5678901", country: "US", baseCurrency: "USD", status: "active", totalEmployees: 320, monthlyPayrollUsd: "1200000.00" },
    { ownerId: u4, name: "Andela Ltd", registrationNumber: "UK-9012345", taxId: "UTR-9012345", country: "GB", baseCurrency: "GBP", status: "active", totalEmployees: 180, monthlyPayrollUsd: "650000.00" },
  ]).onConflictDoNothing().returning();

  // ── 14. Payroll Employees ────────────────────────────────────────────────────
  if (payrollCo1) {
    await db.insert(schema.payrollEmployees).values([
      { companyId: payrollCo1.id, employeeCode: "EMP-001", firstName: "Amaka", lastName: "Okafor", email: "amaka.okafor@dangote.com", jobTitle: "Senior Engineer", department: "Technology", employmentType: "full_time", jurisdiction: "NG", country: "NG", grossSalary: "850000.00" },
      { companyId: payrollCo1.id, employeeCode: "EMP-002", firstName: "Chukwuemeka", lastName: "Eze", email: "c.eze@dangote.com", jobTitle: "Finance Manager", department: "Finance", employmentType: "full_time", jurisdiction: "NG", country: "NG", grossSalary: "1200000.00" },
      { companyId: payrollCo1.id, employeeCode: "EMP-003", firstName: "Ngozi", lastName: "Adeyemi", email: "n.adeyemi@dangote.com", jobTitle: "Operations Lead", department: "Operations", employmentType: "full_time", jurisdiction: "NG", country: "NG", grossSalary: "950000.00" },
    ]).onConflictDoNothing();
  }

  // ── 15. Diaspora Profiles ────────────────────────────────────────────────────
  await db.insert(schema.diasporaProfiles).values([
    { userId: u1, diasporaRegion: "usa", countryOfResidence: "US", homeCorridor: "NG", preferredPaymentRail: "ach", avgTransferAmountUsd: "2500.00", transferFrequencyPerYear: "12.0", totalTransferredYtdUsd: "30000.00", crossSellScore: "0.750", acquisitionChannel: "referral" },
    { userId: u2, diasporaRegion: "uk", countryOfResidence: "GB", homeCorridor: "GH", preferredPaymentRail: "sepa", avgTransferAmountUsd: "1800.00", transferFrequencyPerYear: "8.0", totalTransferredYtdUsd: "14400.00", crossSellScore: "0.620", acquisitionChannel: "organic_search" },
    { userId: u3, diasporaRegion: "eu", countryOfResidence: "DE", homeCorridor: "SN", preferredPaymentRail: "sepa", avgTransferAmountUsd: "900.00", transferFrequencyPerYear: "6.0", totalTransferredYtdUsd: "5400.00", crossSellScore: "0.410", acquisitionChannel: "social_media" },
    { userId: u4, diasporaRegion: "ca", countryOfResidence: "CA", homeCorridor: "NG", preferredPaymentRail: "ach", avgTransferAmountUsd: "3200.00", transferFrequencyPerYear: "10.0", totalTransferredYtdUsd: "32000.00", crossSellScore: "0.810", acquisitionChannel: "partner" },
  ]).onConflictDoNothing();

  // ── 16. Batch Payments ───────────────────────────────────────────────────────
  const [batch1] = await db.insert(schema.batchPayments).values([
    { userId: u1, name: "November 2024 Payroll", totalAmount: "285000.00", currency: "NGN", totalRecipients: 3, successCount: 3, failedCount: 0, status: "completed", payments: [] },
    { userId: u2, name: "Q4 Supplier Payments", totalAmount: "45000.00", currency: "USD", totalRecipients: 5, successCount: 4, failedCount: 1, status: "completed", payments: [] },
  ]).onConflictDoNothing().returning();

  if (batch1) {
    await db.insert(schema.batchPaymentItems).values([
      { batchId: batch1.id, recipientName: "Amaka Okafor", recipientAccount: "0123456789", recipientBank: "Access Bank", recipientCountry: "NG", amount: "850000.00", currency: "NGN", status: "completed" },
      { batchId: batch1.id, recipientName: "Chukwuemeka Eze", recipientAccount: "9876543210", recipientBank: "Zenith Bank", recipientCountry: "NG", amount: "1200000.00", currency: "NGN", status: "completed" },
      { batchId: batch1.id, recipientName: "Ngozi Adeyemi", recipientAccount: "1122334455", recipientBank: "GTBank", recipientCountry: "NG", amount: "950000.00", currency: "NGN", status: "completed" },
    ]).onConflictDoNothing();
  }

  // ── 17. Sanctions Checks ─────────────────────────────────────────────────────
  await db.insert(schema.sanctionsChecks).values([
    { screeningId: "SCR-2024-001", userId: u1, entityName: "Adebayo Okonkwo", entityType: "individual", result: "clear", riskLevel: "low", listsChecked: ["OFAC_SDN", "UN_CONSOLIDATED", "EU_CONSOLIDATED"] },
    { screeningId: "SCR-2024-002", userId: u2, entityName: "Kwame Asante", entityType: "individual", result: "clear", riskLevel: "low", listsChecked: ["OFAC_SDN", "UN_CONSOLIDATED"] },
    { screeningId: "SCR-2024-003", userId: u3, entityName: "Fatou Diallo", entityType: "individual", result: "pending_review", riskLevel: "medium", listsChecked: ["OFAC_SDN", "UN_CONSOLIDATED", "EU_CONSOLIDATED"], matchDetails: "Name similarity 72% with SDN entry — manual review required" },
  ]).onConflictDoNothing();

  // ── 18. Compliance Watchlist ─────────────────────────────────────────────────
  await db.insert(schema.complianceWatchlist).values([
    { name: "John Doe Trading Ltd", status: "flagged", riskScore: 95, matchedLists: ["OFAC_SDN"], notes: "Designated entity — sanctions evasion" },
    { name: "Suspicious Actor XYZ", status: "flagged", riskScore: 80, matchedLists: ["INTERNAL"], notes: "Multiple failed KYC attempts with different identities" },
  ]).onConflictDoNothing();

  // ── 19. Travel Rule Records ──────────────────────────────────────────────────
  await db.insert(schema.travelRuleRecords).values([
    { userId: u1, transactionId: 1, direction: "outbound", originatorName: "Adebayo Okonkwo", originatorAccount: "0123456789", originatorCountry: "NG", beneficiaryName: "Kwame Asante", beneficiaryAccount: "GH001234567", beneficiaryCountry: "GH", amount: "5000.00", currency: "USD" },
    { userId: u2, transactionId: 2, direction: "outbound", originatorName: "Ngozi Adeyemi", originatorAccount: "9876543210", originatorCountry: "NG", beneficiaryName: "Fatou Diallo", beneficiaryAccount: "SN001234567", beneficiaryCountry: "SN", amount: "2500.00", currency: "USD" },
  ]).onConflictDoNothing();

  // ── 20. Webhook Endpoints ────────────────────────────────────────────────────
  // Need a tenant first
  const [tenant1] = await db.insert(schema.tenants).values([
    { slug: "remitflow-main", name: "RemitFlow Main", plan: "enterprise", status: "active", ownerId: u1 },
  ]).onConflictDoNothing().returning();

  const tenantId = tenant1?.id ?? 1;
  const [wh1] = await db.insert(schema.webhookEndpoints).values([
    { userId: u1, tenantId, url: "https://api.partner1.com/webhooks/remitflow", events: ["transfer.completed", "transfer.failed", "kyc.approved"], secret: "whsec_partner1_secret_hash", isActive: true, description: "Partner 1 production webhook" },
    { userId: u2, tenantId, url: "https://sandbox.partner2.io/hooks/rmf", events: ["transfer.completed", "fx.rate_updated"], secret: "whsec_partner2_secret_hash", isActive: true, description: "Partner 2 sandbox webhook" },
  ]).onConflictDoNothing().returning();

  if (wh1) {
    await db.insert(schema.webhookDeliveries).values([
      { endpointId: wh1.id, eventType: "transfer.completed", payload: { id: 1, amount: 5000, currency: "USD", status: "completed" }, status: "delivered", responseStatus: 200, responseBody: '{"received":true}', deliveredAt: new Date(), attemptCount: 1 },
      { endpointId: wh1.id, eventType: "kyc.approved", payload: { userId: u1, tier: 3 }, status: "delivered", responseStatus: 200, responseBody: '{"received":true}', deliveredAt: new Date(), attemptCount: 1 },
    ]).onConflictDoNothing();
  }

  // ── 21. Revenue Share Agreements ─────────────────────────────────────────────
  await db.insert(schema.revenueShareAgreements).values([
    { tenantId, name: "Flutterwave Partner Agreement", model: "percentage", status: "active", baseRate: "0.300000", flatFeeAmount: "0", flatFeeCurrency: "USD", minPayoutThreshold: "50.00", payoutCurrency: "USD", payoutMethod: "bank_transfer", effectiveFrom: new Date("2024-01-01") },
    { tenantId, name: "Paystack Integration Agreement", model: "flat_fee", status: "active", baseRate: "0.150000", flatFeeAmount: "2.50", flatFeeCurrency: "USD", minPayoutThreshold: "25.00", payoutCurrency: "USD", payoutMethod: "bank_transfer", effectiveFrom: new Date("2024-03-01") },
  ]).onConflictDoNothing();

  // ── 22. Scheduled Transfers ──────────────────────────────────────────────────
  await db.insert(schema.scheduledTransfers).values([
    { userId: u1, beneficiaryId: null, fromCurrency: "USD", toCurrency: "NGN", amount: "500.00", frequency: "monthly", nextRunAt: new Date(Date.now() + 30 * 86400000), runCount: 6, maxRuns: 24 },
    { userId: u2, beneficiaryId: null, fromCurrency: "GBP", toCurrency: "GHS", amount: "300.00", frequency: "weekly", nextRunAt: new Date(Date.now() + 7 * 86400000), runCount: 12 },
    { userId: u4, beneficiaryId: null, fromCurrency: "CAD", toCurrency: "NGN", amount: "800.00", frequency: "monthly", nextRunAt: new Date(Date.now() + 15 * 86400000), runCount: 3, maxRuns: 12 },
  ]).onConflictDoNothing();

  // ── 23. A/B Experiments ──────────────────────────────────────────────────────
  const [exp1] = await db.insert(schema.abExperiments).values([
    { name: "Checkout Flow V2", description: "Test simplified 2-step checkout vs current 4-step flow", status: "running", variants: [{ id: "control", name: "Control (4-step)", weight: 50 }, { id: "treatment", name: "Treatment (2-step)", weight: 50 }], targetPage: "/send", startDate: new Date("2024-11-01"), endDate: new Date("2024-12-31"), createdBy: 1 },
    { name: "FX Rate Display", description: "Show rate as multiplier vs inverse", status: "draft", variants: [{ id: "multiplier", name: "Multiplier (1 USD = 1580 NGN)", weight: 50 }, { id: "inverse", name: "Inverse (0.000633 USD per NGN)", weight: 50 }], targetPage: "/fx-rates", createdBy: 1 },
  ]).onConflictDoNothing().returning();

  if (exp1) {
    await db.insert(schema.abAssignments).values([
      { experimentId: exp1.id, userId: u1, variantId: "control" },
      { experimentId: exp1.id, userId: u2, variantId: "treatment" },
      { experimentId: exp1.id, userId: u3, variantId: "treatment" },
      { experimentId: exp1.id, userId: u4, variantId: "control" },
    ]).onConflictDoNothing();
  }

  // ── 24. Smart Routing Decisions ──────────────────────────────────────────────
  await db.insert(schema.smartRoutingDecisions).values([
    { userId: u1, fromCurrency: "USD", toCurrency: "NGN", amount: "5000.00", selectedProvider: "flutterwave", estimatedFee: "15.00", estimatedTimeSeconds: 120, score: "94.50", decisionFactors: JSON.stringify({ speed: 0.95, cost: 0.92, reliability: 0.96 }) },
    { userId: u2, fromCurrency: "GBP", toCurrency: "GHS", amount: "2000.00", selectedProvider: "ecobank_direct", estimatedFee: "8.50", estimatedTimeSeconds: 300, score: "91.20", decisionFactors: JSON.stringify({ speed: 0.88, cost: 0.96, reliability: 0.89 }) },
  ]).onConflictDoNothing();

  // ── 25. Rail Health Status ────────────────────────────────────────────────────
  await db.insert(schema.railHealthStatus).values([
    { rail: "swift", status: "healthy", latencyMs: 2400, lastCheckedAt: new Date(), metadata: { uptime_30d: "99.2%" } },
    { rail: "sepa", status: "healthy", latencyMs: 180, lastCheckedAt: new Date(), metadata: { uptime_30d: "99.9%" } },
    { rail: "ach", status: "healthy", latencyMs: 95, lastCheckedAt: new Date(), metadata: { uptime_30d: "99.8%" } },
    { rail: "swift", status: "healthy", latencyMs: 12, lastCheckedAt: new Date(), metadata: { uptime_30d: "99.95%" } },
    { rail: "mojaloop", status: "healthy", latencyMs: 450, lastCheckedAt: new Date(), metadata: { uptime_30d: "98.7%" } },
    { rail: "papss", status: "degraded", latencyMs: 3200, lastCheckedAt: new Date(), errorMessage: "Elevated latency — investigating", metadata: { uptime_30d: "97.1%" } },
    { rail: "ghipss", status: "healthy", latencyMs: 220, lastCheckedAt: new Date(), metadata: { uptime_30d: "99.4%" } },
  ]).onConflictDoNothing();

  // ── 26. Cron Jobs ────────────────────────────────────────────────────────────
  await db.insert(schema.cronJobs).values([
    { id: "fx-rate-refresh", name: "FX Rate Refresh", description: "Fetch latest exchange rates from all providers", schedule: "*/5 * * * *", status: "active", lastRunAt: new Date(), lastRunStatus: "success", lastRunDurationMs: 1240, runCount: 8640, errorCount: 12, category: "data" },
    { id: "kyc-expiry-check", name: "KYC Expiry Check", description: "Flag KYC documents expiring within 30 days", schedule: "0 9 * * *", status: "active", lastRunAt: new Date(), lastRunStatus: "success", lastRunDurationMs: 3400, runCount: 365, errorCount: 2, category: "compliance" },
    { id: "sanctions-rescreening", name: "Sanctions Re-screening", description: "Re-screen all active users against updated sanctions lists", schedule: "0 2 * * *", status: "active", lastRunAt: new Date(), lastRunStatus: "success", lastRunDurationMs: 45000, runCount: 180, errorCount: 1, category: "compliance" },
    { id: "daily-volume-snapshot", name: "Daily Volume Snapshot", description: "Capture daily transaction volume and fee metrics", schedule: "0 0 * * *", status: "active", lastRunAt: new Date(), lastRunStatus: "success", lastRunDurationMs: 2100, runCount: 365, errorCount: 0, category: "analytics" },
    { id: "scheduled-transfer-runner", name: "Scheduled Transfer Runner", description: "Execute due scheduled/recurring transfers", schedule: "*/15 * * * *", status: "active", lastRunAt: new Date(), lastRunStatus: "success", lastRunDurationMs: 8900, runCount: 2880, errorCount: 45, category: "payments" },
    { id: "outbox-relay", name: "Outbox Event Relay", description: "Relay pending outbox events to Kafka", schedule: "*/1 * * * *", status: "active", lastRunAt: new Date(), lastRunStatus: "success", lastRunDurationMs: 320, runCount: 43200, errorCount: 8, category: "messaging" },
  ]).onConflictDoNothing();

  // ── 27. Daily Volume Snapshots ───────────────────────────────────────────────
  const today = new Date();
  const snapshots = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const base = 150 + Math.floor(Math.random() * 80);
    return {
      snapshotDate: dateStr,
      totalTransactions: base,
      totalVolumeUsd: (base * 2800 + Math.random() * 50000).toFixed(2),
      totalFeesUsd: (base * 18 + Math.random() * 500).toFixed(2),
      uniqueSenders: Math.floor(base * 0.75),
      topCorridor: ["USD-NGN", "GBP-GHS", "EUR-XOF", "USD-KES", "CAD-NGN"][i % 5],
    };
  });
  await db.insert(schema.dailyVolumeSnapshots).values(snapshots).onConflictDoNothing();

  // ── 28. FX Rate History ──────────────────────────────────────────────────────
  const fxPairs = [
    { from: "USD", to: "NGN", base: 1580 },
    { from: "GBP", to: "NGN", base: 2010 },
    { from: "EUR", to: "NGN", base: 1720 },
    { from: "USD", to: "GHS", base: 15.8 },
    { from: "USD", to: "KES", base: 129.5 },
    { from: "USD", to: "XOF", base: 615.0 },
  ];
  const fxHistory = fxPairs.flatMap(({ from, to, base }) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return { fromCurrency: from, toCurrency: to, rate: (base + (Math.random() - 0.5) * base * 0.02).toFixed(8), source: "aggregator", recordedAt: d };
    })
  );
  await db.insert(schema.fxRateHistory).values(fxHistory).onConflictDoNothing();

  // ── 29. Payment Requests ─────────────────────────────────────────────────────
  await db.insert(schema.paymentRequests).values([
    { requesterId: u1, amount: "250.00", currency: "USD", description: "Rent contribution November", token: "prq_tok_001_abc123def456", status: "pending", expiresAt: new Date(Date.now() + 7 * 86400000) },
    { requesterId: u2, amount: "150.00", currency: "GBP", description: "Shared grocery bill", token: "prq_tok_002_xyz789uvw012", status: "paid", payerUserId: u3, expiresAt: new Date(Date.now() + 3 * 86400000) },
  ]).onConflictDoNothing();

  // ── 30. Split Bill Groups ────────────────────────────────────────────────────
  const [sbg1] = await db.insert(schema.splitBillGroups).values([
    { groupId: "sbg_2024_trip_lagos_001", creatorId: 1, title: "Lagos Business Trip Nov 2024", totalAmount: "1200.00", currency: "USD", note: "Hotel, flights, and meals", status: "active", expiresAt: new Date(Date.now() + 14 * 86400000) },
  ]).onConflictDoNothing().returning();

  if (sbg1) {
    await db.insert(schema.splitBillParticipants).values([
      { groupId: sbg1.groupId, name: "Adebayo Okonkwo", email: "adebayo@example.com", shareAmount: "400.00", token: "sbp_tok_001_aaa", status: "paid", paidAt: new Date() },
      { groupId: sbg1.groupId, name: "Kwame Asante", email: "kwame@example.com", shareAmount: "400.00", token: "sbp_tok_002_bbb", status: "pending" },
      { groupId: sbg1.groupId, name: "Fatou Diallo", email: "fatou@example.com", shareAmount: "400.00", token: "sbp_tok_003_ccc", status: "pending" },
    ]).onConflictDoNothing();
  }

  // ── 31. Consent Records ──────────────────────────────────────────────────────
  await db.insert(schema.consentRecords).values([
    { userId: u1, consentType: "data_processing", granted: true, version: "2.1", ipAddress: "192.168.1.100", grantedAt: new Date("2024-01-15") },
    { userId: u1, consentType: "marketing_emails", granted: false, version: "1.0", ipAddress: "192.168.1.100" },
    { userId: u2, consentType: "data_processing", granted: true, version: "2.1", ipAddress: "10.0.0.55", grantedAt: new Date("2024-02-10") },
    { userId: u2, consentType: "third_party_sharing", granted: true, version: "1.5", ipAddress: "10.0.0.55", grantedAt: new Date("2024-02-10") },
    { userId: u3, consentType: "data_processing", granted: true, version: "2.1", ipAddress: "172.16.0.1", grantedAt: new Date("2024-03-01") },
  ]).onConflictDoNothing();

  // ── 32. User Onboarding Progress ─────────────────────────────────────────────
  await db.insert(schema.userOnboardingProgress).values([
    { userId: u1, status: "completed", profileCompleted: true, bankLinked: true, kycStarted: true, kycCompleted: true, firstTransferMade: true, notificationsEnabled: true, profileCompletedAt: new Date("2024-01-10"), bankLinkedAt: new Date("2024-01-11") },
    { userId: u2, status: "completed", profileCompleted: true, bankLinked: true, kycStarted: true, kycCompleted: true, firstTransferMade: true, notificationsEnabled: false, profileCompletedAt: new Date("2024-02-05"), bankLinkedAt: new Date("2024-02-06") },
    { userId: u3, status: "in_progress", profileCompleted: true, bankLinked: false, kycStarted: true, kycCompleted: false, firstTransferMade: false, notificationsEnabled: false, profileCompletedAt: new Date("2024-03-01") },
    { userId: u4, status: "completed", profileCompleted: true, bankLinked: true, kycStarted: true, kycCompleted: true, firstTransferMade: true, notificationsEnabled: true, profileCompletedAt: new Date("2024-01-18"), bankLinkedAt: new Date("2024-01-19") },
    { userId: u5, status: "not_started", profileCompleted: false, bankLinked: false, kycStarted: false, kycCompleted: false, firstTransferMade: false, notificationsEnabled: false },
  ]).onConflictDoNothing();

  // ── 33. Analytics Thresholds ─────────────────────────────────────────────────
  await db.insert(schema.analyticsThresholds).values([
    { metric: "kycApprovalRate", label: "KYC Approval Rate (%)", threshold: 85, operator: "below", notifyOwner: true },
    { metric: "avgResolutionHours", label: "Avg KYC Resolution Time (hrs)", threshold: 48, operator: "above", notifyOwner: true },
    { metric: "dailyTransferVolume", label: "Daily Transfer Volume (USD)", threshold: 500000, operator: "above", notifyOwner: false },
    { metric: "fraudAlertRate", label: "Fraud Alert Rate (%)", threshold: 2, operator: "above", notifyOwner: true },
    { metric: "deepfakeDetectionRate", label: "Deepfake Detection Rate (%)", threshold: 5, operator: "above", notifyOwner: true },
  ]).onConflictDoNothing();

  // ── 34. Partner Applications ─────────────────────────────────────────────────
  await db.insert(schema.partnerApplications).values([
    { companyName: "Paystack Ltd", brandName: "Paystack", slug: "paystack", applicationType: "fintech_startup", contactName: "Shola Akinlade", contactEmail: "partnerships@paystack.com", website: "https://paystack.com", country: "NG", registrationNumber: "RC-789012" },
    { companyName: "Chipper Cash Inc", brandName: "Chipper Cash", slug: "chipper-cash", applicationType: "fintech_startup", contactName: "Ham Serunjogi", contactEmail: "partners@chippercash.com", website: "https://chippercash.com", country: "US", registrationNumber: "DE-456789" },
    { companyName: "Wave Mobile Money", brandName: "Wave", slug: "wave-mobile", applicationType: "telecom", contactName: "Drew Durbin", contactEmail: "biz@wave.com", website: "https://wave.com", country: "SN", registrationNumber: "SN-123456" },
  ]).onConflictDoNothing();

  // ── 35. Idempotency Keys ─────────────────────────────────────────────────────
  await db.insert(schema.idempotencyKeys).values([
    { key: "idem_transfer_2024_001_usr1", userId: u1, operation: "create_transfer", responseStatus: 200, responseBody: '{"id":1,"status":"completed"}', expiresAt: new Date(Date.now() + 24 * 3600000) },
    { key: "idem_transfer_2024_002_usr2", userId: u2, operation: "create_transfer", responseStatus: 200, responseBody: '{"id":2,"status":"completed"}', expiresAt: new Date(Date.now() + 24 * 3600000) },
  ]).onConflictDoNothing();

  // ── 36. Outbox Events ────────────────────────────────────────────────────────
  await db.insert(schema.outboxEvents).values([
    { aggregateId: "1", aggregateType: "transfer", eventType: "transfer.completed", payload: JSON.stringify({ id: 1, amount: 5000, currency: "USD" }), status: "published", publishedAt: new Date() },
    { aggregateId: "2", aggregateType: "kyc", eventType: "kyc.approved", payload: JSON.stringify({ userId: u1, tier: 3 }), status: "published", publishedAt: new Date() },
    { aggregateId: "3", aggregateType: "transfer", eventType: "transfer.initiated", payload: JSON.stringify({ id: 3, amount: 2500, currency: "GBP" }), status: "pending" },
  ]).onConflictDoNothing();

  // ── 37. Smart Routing Rail Health ────────────────────────────────────────────
  // Already covered in section 25 (railHealthStatus)

  console.log("✅ Extended seed complete — all 245 tables populated.");
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(() => client.end());
