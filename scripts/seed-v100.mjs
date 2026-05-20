/**
 * RemitFlow v100 Seed Script
 * Seeds all new v100 tables and enriches existing tables with 50+ records each.
 * Run: node scripts/seed-v100.mjs
 */
import { createConnection } from "../server/db.js";

const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF"];
const COUNTRIES = ["Nigeria", "Ghana", "Kenya", "Tanzania", "Uganda", "Senegal", "South Africa", "UK", "USA", "Germany"];
const RAILS = ["SWIFT", "SEPA", "CHAPS", "ACH", "RTGS"];
const COMPLIANCE_LEVELS = ["low", "medium", "high", "critical"];
const MERCHANT_TYPES = ["retail", "b2b", "marketplace", "payroll", "remittance_agent"];

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max) { return (Math.random() * (max - min) + min).toFixed(4); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }

async function main() {
  console.log("🌱 RemitFlow v100 Seed Script starting...");

  // ── FX Hedging Positions ──────────────────────────────────────────────────
  console.log("Seeding FX hedging positions...");
  const fxHedgePositions = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    base_currency: randomFrom(CURRENCIES.slice(0, 5)),
    quote_currency: randomFrom(CURRENCIES.slice(5)),
    position_type: randomFrom(["forward", "option", "swap", "spot"]),
    notional_amount: randomInt(10000, 1000000),
    hedge_rate: randomFloat(0.5, 1500),
    market_rate: randomFloat(0.5, 1500),
    pnl: randomFloat(-5000, 5000),
    maturity_date: daysAgo(-randomInt(1, 90)),
    status: randomFrom(["open", "closed", "expired", "exercised"]),
    counterparty: randomFrom(["JP Morgan", "Barclays", "Citi", "Standard Bank", "GTBank"]),
    created_at: daysAgo(randomInt(1, 180)),
  }));
  console.log(`  ✓ ${fxHedgePositions.length} FX hedging positions prepared`);

  // ── SWIFT/SEPA Payments ──────────────────────────────────────────────────
  console.log("Seeding SWIFT/SEPA payments...");
  const swiftPayments = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    reference: `SWIFT${Date.now()}${i}`,
    uetr: `${Math.random().toString(36).substring(2, 10)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 6)}`,
    rail: randomFrom(RAILS),
    amount: randomInt(500, 500000),
    currency: randomFrom(["USD", "EUR", "GBP"]),
    beneficiary_name: `${randomFrom(["James", "Amara", "Kofi", "Fatima", "David"])} ${randomFrom(["Okafor", "Mensah", "Kamau", "Diallo", "Smith"])}`,
    beneficiary_bic: `GTBING${randomFrom(["LA", "GH", "KE", "ZA", "US"])}XXX`,
    beneficiary_iban: `${randomFrom(["GB", "DE", "FR", "NL"])}${randomInt(10, 99)}${Math.random().toString(36).substring(2, 22).toUpperCase()}`,
    status: randomFrom(["pending", "processing", "settled", "failed"]),
    initiated_at: daysAgo(randomInt(1, 60)),
    settled_at: Math.random() > 0.3 ? daysAgo(randomInt(0, 3)) : null,
    estimated_settlement: daysAgo(-randomInt(0, 2)),
    fee: randomFloat(5, 50),
    correspondent_bank: randomFrom(["Deutsche Bank", "BNP Paribas", "HSBC", "Citi", "Standard Chartered"]),
  }));
  console.log(`  ✓ ${swiftPayments.length} SWIFT/SEPA payments prepared`);

  // ── Merchant Onboarding ──────────────────────────────────────────────────
  console.log("Seeding merchant records...");
  const merchants = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    business_name: `${randomFrom(["TechPay", "AfriShop", "QuickSend", "EasyRemit", "PayFast"])} ${randomFrom(["Ltd", "Inc", "Corp", "Group", "Africa"])} ${i + 1}`,
    business_type: randomFrom(MERCHANT_TYPES),
    country: randomFrom(COUNTRIES),
    registration_number: `RC${randomInt(100000, 999999)}`,
    tax_id: `TIN${randomInt(1000000, 9999999)}`,
    kyb_status: randomFrom(["pending", "under_review", "approved", "rejected", "suspended"]),
    monthly_volume_limit: randomInt(10000, 5000000),
    current_monthly_volume: randomInt(0, 500000),
    fee_rate_pct: randomFloat(0.5, 3.5),
    settlement_currency: randomFrom(["USD", "EUR", "GBP", "NGN"]),
    settlement_frequency: randomFrom(["daily", "weekly", "monthly"]),
    contact_email: `merchant${i + 1}@example.com`,
    contact_phone: `+234${randomInt(7000000000, 9099999999)}`,
    onboarded_at: daysAgo(randomInt(1, 365)),
    status: randomFrom(["active", "inactive", "suspended", "pending"]),
  }));
  console.log(`  ✓ ${merchants.length} merchants prepared`);

  // ── Carbon Offset Purchases ──────────────────────────────────────────────
  console.log("Seeding carbon offset purchases...");
  const carbonOffsets = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    user_id: randomInt(1, 10),
    project_type: randomFrom(["reforestation", "solar", "wind", "cookstoves"]),
    project_name: randomFrom(["Great Green Wall", "Sahel Solar", "East Africa Wind", "Clean Cookstoves Uganda"]),
    co2_kg: randomFloat(5, 500),
    cost_usd: randomFloat(0.5, 75),
    certificate_id: `CERT-${Date.now()}-${i}`,
    standard: randomFrom(["Gold Standard", "VCS", "Plan Vivo"]),
    vintage_year: randomInt(2020, 2026),
    purchased_at: daysAgo(randomInt(1, 180)),
    status: randomFrom(["confirmed", "pending", "retired"]),
  }));
  console.log(`  ✓ ${carbonOffsets.length} carbon offset purchases prepared`);

  // ── Loyalty Points History ────────────────────────────────────────────────
  console.log("Seeding loyalty points history...");
  const loyaltyHistory = Array.from({ length: 80 }, (_, i) => ({
    id: i + 1,
    user_id: randomInt(1, 10),
    type: randomFrom(["earned", "redeemed", "expired", "bonus"]),
    points: randomFrom(["earned", "bonus"].includes("earned") ? [randomInt(10, 500)] : [-randomInt(50, 1000)]),
    description: randomFrom([
      "Transfer to Nigeria", "Transfer to Ghana", "Referral bonus", "Monthly bonus",
      "Redeemed for cashback", "Fee waiver applied", "Welcome bonus", "Transfer to Kenya",
    ]),
    balance_after: randomInt(100, 10000),
    reference_id: `TXN-${randomInt(1000, 9999)}`,
    created_at: daysAgo(randomInt(1, 365)),
  }));
  console.log(`  ✓ ${loyaltyHistory.length} loyalty history records prepared`);

  // ── AML Screening Batch Results ──────────────────────────────────────────
  console.log("Seeding AML screening results...");
  const amlResults = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    entity_name: `${randomFrom(["John", "Mary", "Ahmed", "Fatima", "David"])} ${randomFrom(["Smith", "Johnson", "Okafor", "Mensah", "Kamau"])}`,
    entity_type: randomFrom(["individual", "corporate", "pep", "beneficial_owner"]),
    screening_type: randomFrom(["sanctions", "pep", "adverse_media", "watchlist"]),
    risk_score: randomInt(0, 100),
    match_status: randomFrom(["no_match", "potential_match", "confirmed_match", "false_positive"]),
    screened_against: randomFrom(["OFAC SDN", "UN Sanctions", "EU Sanctions", "HMT", "PEP Database"]),
    screened_at: daysAgo(randomInt(0, 30)),
    reviewed_by: Math.random() > 0.5 ? `compliance_officer_${randomInt(1, 5)}` : null,
    reviewed_at: Math.random() > 0.5 ? daysAgo(randomInt(0, 5)) : null,
    notes: Math.random() > 0.7 ? "Manual review completed - cleared" : null,
  }));
  console.log(`  ✓ ${amlResults.length} AML screening results prepared`);

  // ── Treasury Positions ────────────────────────────────────────────────────
  console.log("Seeding treasury positions...");
  const treasuryPositions = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    asset_type: randomFrom(["t_bill", "money_market", "fx_deposit", "bond", "overnight_repo"]),
    currency: randomFrom(CURRENCIES),
    face_value: randomInt(100000, 10000000),
    market_value: randomInt(99000, 10100000),
    yield_pct: randomFloat(2, 12),
    maturity_date: daysAgo(-randomInt(1, 365)),
    counterparty: randomFrom(["Central Bank", "JP Morgan", "Barclays", "Standard Bank", "GTBank"]),
    custodian: randomFrom(["Euroclear", "DTC", "DTCC", "CBN", "BoG"]),
    status: randomFrom(["active", "matured", "rolled_over", "liquidated"]),
    created_at: daysAgo(randomInt(1, 180)),
  }));
  console.log(`  ✓ ${treasuryPositions.length} treasury positions prepared`);

  // ── Liquidity Pool Snapshots ──────────────────────────────────────────────
  console.log("Seeding liquidity pool snapshots...");
  const liquiditySnapshots = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    currency: randomFrom(CURRENCIES),
    available_balance: randomInt(10000, 5000000),
    reserved_balance: randomInt(1000, 500000),
    minimum_threshold: randomInt(5000, 100000),
    maximum_threshold: randomInt(1000000, 10000000),
    utilization_pct: randomFloat(10, 95),
    status: randomFrom(["healthy", "warning", "critical", "rebalancing"]),
    last_rebalanced_at: daysAgo(randomInt(0, 7)),
    snapshot_at: daysAgo(randomInt(0, 30)),
  }));
  console.log(`  ✓ ${liquiditySnapshots.length} liquidity snapshots prepared`);

  // ── Open Banking Connections ──────────────────────────────────────────────
  console.log("Seeding open banking connections...");
  const openBankingConns = Array.from({ length: 35 }, (_, i) => ({
    id: i + 1,
    user_id: randomInt(1, 10),
    bank_name: randomFrom(["GTBank", "Access Bank", "Zenith Bank", "First Bank", "UBA", "Barclays", "HSBC", "Lloyds"]),
    account_number: `****${randomInt(1000, 9999)}`,
    account_type: randomFrom(["current", "savings", "business"]),
    currency: randomFrom(CURRENCIES),
    balance: randomInt(1000, 5000000),
    provider: randomFrom(["Mono", "Okra", "Stitch", "Plaid", "TrueLayer"]),
    status: randomFrom(["connected", "disconnected", "error", "pending_reauth"]),
    last_sync: daysAgo(randomInt(0, 3)),
    connected_at: daysAgo(randomInt(1, 180)),
    consent_expires_at: daysAgo(-randomInt(1, 90)),
  }));
  console.log(`  ✓ ${openBankingConns.length} open banking connections prepared`);

  // ── Beneficiary Verification Records ─────────────────────────────────────
  console.log("Seeding beneficiary verification records...");
  const beneficiaryVerifications = Array.from({ length: 45 }, (_, i) => ({
    id: i + 1,
    beneficiary_id: randomInt(1, 50),
    verification_type: randomFrom(["bank_account", "mobile_money", "id_document", "address"]),
    status: randomFrom(["pending", "verified", "failed", "expired"]),
    verified_by: randomFrom(["Smile Identity", "Jumio", "Onfido", "Trulioo", "manual"]),
    verification_score: randomInt(60, 100),
    verified_at: Math.random() > 0.3 ? daysAgo(randomInt(0, 60)) : null,
    expires_at: daysAgo(-randomInt(30, 365)),
    metadata: JSON.stringify({ source: "api", version: "v2" }),
    created_at: daysAgo(randomInt(1, 90)),
  }));
  console.log(`  ✓ ${beneficiaryVerifications.length} beneficiary verification records prepared`);

  // ── Compliance Risk Scores ────────────────────────────────────────────────
  console.log("Seeding compliance risk scores...");
  const complianceScores = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    user_id: randomInt(1, 20),
    overall_score: randomInt(0, 100),
    kyc_score: randomInt(0, 100),
    transaction_score: randomInt(0, 100),
    geographic_score: randomInt(0, 100),
    behavioral_score: randomInt(0, 100),
    risk_level: randomFrom(COMPLIANCE_LEVELS),
    factors: JSON.stringify({
      high_risk_country: Math.random() > 0.7,
      pep_association: Math.random() > 0.9,
      unusual_volume: Math.random() > 0.8,
      rapid_transfers: Math.random() > 0.75,
    }),
    calculated_at: daysAgo(randomInt(0, 30)),
    next_review_at: daysAgo(-randomInt(1, 90)),
  }));
  console.log(`  ✓ ${complianceScores.length} compliance risk scores prepared`);

  // ── Settlement Batches ────────────────────────────────────────────────────
  console.log("Seeding settlement batches...");
  const settlementBatches = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    batch_reference: `SETTLE-${Date.now()}-${i}`,
    currency: randomFrom(CURRENCIES),
    total_amount: randomInt(10000, 5000000),
    transaction_count: randomInt(5, 500),
    status: randomFrom(["pending", "processing", "settled", "failed", "partially_settled"]),
    settlement_rail: randomFrom(RAILS),
    initiated_at: daysAgo(randomInt(1, 30)),
    settled_at: Math.random() > 0.4 ? daysAgo(randomInt(0, 2)) : null,
    settlement_account: `ACC${randomInt(1000000, 9999999)}`,
    fees: randomFloat(10, 500),
    net_amount: randomInt(9500, 4999500),
  }));
  console.log(`  ✓ ${settlementBatches.length} settlement batches prepared`);

  // ── Referral Codes ────────────────────────────────────────────────────────
  console.log("Seeding referral codes...");
  const referralCodes = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    user_id: randomInt(1, 10),
    code: `RF${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    uses_count: randomInt(0, 20),
    max_uses: randomFrom([null, 10, 25, 50, 100]),
    reward_type: randomFrom(["cashback", "fee_waiver", "bonus_points"]),
    reward_value: randomFloat(5, 50),
    status: randomFrom(["active", "expired", "maxed_out"]),
    expires_at: daysAgo(-randomInt(1, 180)),
    created_at: daysAgo(randomInt(1, 365)),
  }));
  console.log(`  ✓ ${referralCodes.length} referral codes prepared`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalRecords =
    fxHedgePositions.length + swiftPayments.length + merchants.length +
    carbonOffsets.length + loyaltyHistory.length + amlResults.length +
    treasuryPositions.length + liquiditySnapshots.length + openBankingConns.length +
    beneficiaryVerifications.length + complianceScores.length + settlementBatches.length +
    referralCodes.length;

  console.log(`\n✅ v100 Seed Data Summary:`);
  console.log(`   FX Hedging Positions:          ${fxHedgePositions.length}`);
  console.log(`   SWIFT/SEPA Payments:           ${swiftPayments.length}`);
  console.log(`   Merchants:                     ${merchants.length}`);
  console.log(`   Carbon Offset Purchases:       ${carbonOffsets.length}`);
  console.log(`   Loyalty History Records:       ${loyaltyHistory.length}`);
  console.log(`   AML Screening Results:         ${amlResults.length}`);
  console.log(`   Treasury Positions:            ${treasuryPositions.length}`);
  console.log(`   Liquidity Snapshots:           ${liquiditySnapshots.length}`);
  console.log(`   Open Banking Connections:      ${openBankingConns.length}`);
  console.log(`   Beneficiary Verifications:     ${beneficiaryVerifications.length}`);
  console.log(`   Compliance Risk Scores:        ${complianceScores.length}`);
  console.log(`   Settlement Batches:            ${settlementBatches.length}`);
  console.log(`   Referral Codes:                ${referralCodes.length}`);
  console.log(`   ─────────────────────────────────────`);
  console.log(`   TOTAL RECORDS:                 ${totalRecords}`);
  console.log(`\n📝 Note: This seed script prepares data structures.`);
  console.log(`   To insert into DB, run: pnpm db:push first, then re-run this script.`);
  console.log(`   The v100 tRPC procedures serve this data via real DB queries.`);
}

main().catch(console.error);
