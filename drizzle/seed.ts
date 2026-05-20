/**
 * RemitFlow — Database Seed Script (v143)
 *
 * Populates the database with realistic demo data for development,
 * testing, and staging environments.
 *
 * Usage:
 *   pnpm tsx drizzle/seed.ts
 *   # or
 *   npx tsx drizzle/seed.ts
 *
 * WARNING: This script is DESTRUCTIVE — it truncates core tables before
 * inserting. Never run against production.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { randomBytes } from "crypto";
import * as schema from "./schema";
import { eq } from "drizzle-orm";

const url = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "";
const client = postgres(url, { max: 5, connect_timeout: 10 });
const db = drizzle(client, { schema });

// ── Helpers ────────────────────────────────────────────────────────────────

function ref(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 RemitFlow seed starting…");

  // ── 1. Users ─────────────────────────────────────────────────────────────
  console.log("  → users");
  const [alice, bob, carol, dave, eve] = await db
    .insert(schema.users)
    .values([
      {
        openId: "seed-alice-001",
        email: "alice@remitflow.demo",
        name: "Alice Okonkwo",
        role: "admin",
        kycTier: "tier3",
        kycVerifiedAt: daysAgo(90),
        phone: "+2348012345678",
        country: "NG",
        currency: "NGN",
        createdAt: daysAgo(180),
        updatedAt: daysAgo(1),
      },
      {
        openId: "seed-bob-002",
        email: "bob@remitflow.demo",
        name: "Bob Mensah",
        role: "user",
        kycTier: "tier2",
        kycVerifiedAt: daysAgo(60),
        phone: "+233244567890",
        country: "GH",
        currency: "GHS",
        createdAt: daysAgo(120),
        updatedAt: daysAgo(2),
      },
      {
        openId: "seed-carol-003",
        email: "carol@remitflow.demo",
        name: "Carol Diallo",
        role: "user",
        kycTier: "tier2",
        kycVerifiedAt: daysAgo(45),
        phone: "+221771234567",
        country: "SN",
        currency: "XOF",
        createdAt: daysAgo(90),
        updatedAt: daysAgo(3),
      },
      {
        openId: "seed-dave-004",
        email: "dave@remitflow.demo",
        name: "Dave Kamau",
        role: "user",
        kycTier: "tier1",
        phone: "+254712345678",
        country: "KE",
        currency: "KES",
        createdAt: daysAgo(30),
        updatedAt: daysAgo(5),
      },
      {
        openId: "seed-eve-005",
        email: "eve@remitflow.demo",
        name: "Eve Nwosu",
        role: "partner",
        kycTier: "tier3",
        kycVerifiedAt: daysAgo(120),
        phone: "+2348087654321",
        country: "NG",
        currency: "NGN",
        createdAt: daysAgo(200),
        updatedAt: daysAgo(1),
      },
    ])
    .onConflictDoNothing()
    .returning();

  if (!alice) {
    console.log("  ℹ  Users already seeded — skipping.");
    await client.end();
    return;
  }

  // ── 2. Wallets ────────────────────────────────────────────────────────────
  console.log("  → wallets");
  await db.insert(schema.wallets).values([
    { userId: alice.id, currency: "NGN", balance: "485000.00", status: "active", createdAt: daysAgo(180) },
    { userId: alice.id, currency: "USD", balance: "1250.50", status: "active", createdAt: daysAgo(180) },
    { userId: bob.id, currency: "GHS", balance: "12500.00", status: "active", createdAt: daysAgo(120) },
    { userId: bob.id, currency: "USD", balance: "320.00", status: "active", createdAt: daysAgo(120) },
    { userId: carol.id, currency: "XOF", balance: "750000.00", status: "active", createdAt: daysAgo(90) },
    { userId: dave.id, currency: "KES", balance: "45000.00", status: "active", createdAt: daysAgo(30) },
    { userId: eve.id, currency: "NGN", balance: "2500000.00", status: "active", createdAt: daysAgo(200) },
    { userId: eve.id, currency: "USD", balance: "8750.00", status: "active", createdAt: daysAgo(200) },
  ]).onConflictDoNothing();

  // ── 3. Beneficiaries ──────────────────────────────────────────────────────
  console.log("  → beneficiaries");
  await db.insert(schema.beneficiaries).values([
    {
      userId: alice.id,
      name: "Chidi Okonkwo",
      accountNumber: "0123456789",
      bankCode: "044",
      bankName: "Access Bank",
      country: "NG",
      currency: "NGN",
      createdAt: daysAgo(150),
    },
    {
      userId: alice.id,
      name: "Amara Diallo",
      accountNumber: "SN-221-7712345",
      bankCode: "SGBS",
      bankName: "Société Générale Sénégal",
      country: "SN",
      currency: "XOF",
      createdAt: daysAgo(100),
    },
    {
      userId: bob.id,
      name: "Kwame Mensah",
      accountNumber: "GH-024-4567890",
      bankCode: "GCB",
      bankName: "GCB Bank",
      country: "GH",
      currency: "GHS",
      createdAt: daysAgo(80),
    },
    {
      userId: dave.id,
      name: "Wanjiru Kamau",
      accountNumber: "KE-712-345678",
      bankCode: "KCB",
      bankName: "KCB Bank",
      country: "KE",
      currency: "KES",
      createdAt: daysAgo(20),
    },
  ]).onConflictDoNothing();

  // ── 4. Transactions ───────────────────────────────────────────────────────
  console.log("  → transactions");
  const txRows = [
    // Alice → Senegal (completed)
    {
      userId: alice.id,
      reference: ref("TXN"),
      type: "send" as const,
      status: "completed" as const,
      fromCurrency: "NGN",
      toCurrency: "XOF",
      fromAmount: "50000.00",
      toAmount: "82500.00",
      fxRate: "1.65",
      fee: "500.00",
      recipientName: "Amara Diallo",
      recipientCountry: "SN",
      description: "Family support",
      completedAt: daysAgo(5),
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
    },
    // Alice → Ghana (completed)
    {
      userId: alice.id,
      reference: ref("TXN"),
      type: "send" as const,
      status: "completed" as const,
      fromCurrency: "NGN",
      toCurrency: "GHS",
      fromAmount: "75000.00",
      toAmount: "450.00",
      fxRate: "0.006",
      fee: "750.00",
      recipientName: "Kwame Mensah",
      recipientCountry: "GH",
      description: "Business payment",
      completedAt: daysAgo(12),
      createdAt: daysAgo(12),
      updatedAt: daysAgo(12),
    },
    // Alice topup
    {
      userId: alice.id,
      reference: ref("TXN"),
      type: "topup" as const,
      status: "completed" as const,
      fromCurrency: "NGN",
      toCurrency: "NGN",
      fromAmount: "200000.00",
      toAmount: "200000.00",
      fxRate: "1.00",
      fee: "0.00",
      description: "Wallet top-up via card",
      completedAt: daysAgo(20),
      createdAt: daysAgo(20),
      updatedAt: daysAgo(20),
    },
    // Bob → Kenya (processing)
    {
      userId: bob.id,
      reference: ref("TXN"),
      type: "send" as const,
      status: "processing" as const,
      fromCurrency: "GHS",
      toCurrency: "KES",
      fromAmount: "500.00",
      toAmount: "7250.00",
      fxRate: "14.5",
      fee: "5.00",
      recipientName: "Wanjiru Kamau",
      recipientCountry: "KE",
      description: "School fees",
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(1),
    },
    // Carol → Nigeria (pending)
    {
      userId: carol.id,
      reference: ref("TXN"),
      type: "send" as const,
      status: "pending" as const,
      fromCurrency: "XOF",
      toCurrency: "NGN",
      fromAmount: "100000.00",
      toAmount: "60000.00",
      fxRate: "0.60",
      fee: "1000.00",
      recipientName: "Chidi Okonkwo",
      recipientCountry: "NG",
      description: "Rent payment",
      createdAt: hoursAgo(1),
      updatedAt: hoursAgo(1),
    },
    // Dave exchange
    {
      userId: dave.id,
      reference: ref("TXN"),
      type: "exchange" as const,
      status: "completed" as const,
      fromCurrency: "KES",
      toCurrency: "USD",
      fromAmount: "13000.00",
      toAmount: "100.00",
      fxRate: "0.0077",
      fee: "130.00",
      description: "FX exchange",
      completedAt: daysAgo(3),
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
    // Alice failed
    {
      userId: alice.id,
      reference: ref("TXN"),
      type: "send" as const,
      status: "failed" as const,
      fromCurrency: "NGN",
      toCurrency: "USD",
      fromAmount: "500000.00",
      toAmount: "312.50",
      fxRate: "0.000625",
      fee: "5000.00",
      failureReason: "Recipient bank declined — account dormant",
      recipientName: "Unknown Recipient",
      recipientCountry: "US",
      createdAt: daysAgo(7),
      updatedAt: daysAgo(7),
    },
  ];

  await db.insert(schema.transactions).values(txRows).onConflictDoNothing();

  // ── 5. Savings Goals ──────────────────────────────────────────────────────
  console.log("  → savingsGoals");
  await db.insert(schema.savingsGoals).values([
    {
      userId: alice.id,
      name: "Emergency Fund",
      targetAmount: "500000.00",
      currentAmount: "185000.00",
      currency: "NGN",
      targetDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      status: "active",
      autoSave: true,
      autoSaveAmount: "10000.00",
      createdAt: daysAgo(60),
    },
    {
      userId: alice.id,
      name: "Holiday Travel",
      targetAmount: "1000.00",
      currentAmount: "350.00",
      currency: "USD",
      targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      status: "active",
      autoSave: false,
      createdAt: daysAgo(30),
    },
    {
      userId: bob.id,
      name: "School Fees",
      targetAmount: "5000.00",
      currentAmount: "5000.00",
      currency: "GHS",
      targetDate: daysAgo(5),
      status: "completed",
      autoSave: false,
      createdAt: daysAgo(90),
    },
  ]).onConflictDoNothing();

  // ── 6. FX Alerts ─────────────────────────────────────────────────────────
  console.log("  → fxAlerts");
  await db.insert(schema.fxAlerts).values([
    {
      userId: alice.id,
      fromCurrency: "NGN",
      toCurrency: "USD",
      targetRate: "0.00065",
      direction: "above",
      isActive: true,
      createdAt: daysAgo(10),
    },
    {
      userId: alice.id,
      fromCurrency: "NGN",
      toCurrency: "GBP",
      targetRate: "0.00050",
      direction: "below",
      isActive: true,
      createdAt: daysAgo(5),
    },
    {
      userId: bob.id,
      fromCurrency: "GHS",
      toCurrency: "USD",
      targetRate: "0.0650",
      direction: "above",
      isActive: false,
      triggeredAt: daysAgo(2),
      createdAt: daysAgo(15),
    },
  ]).onConflictDoNothing();

  // ── 7. Notifications ──────────────────────────────────────────────────────
  console.log("  → notifications");
  await db.insert(schema.notifications).values([
    {
      userId: alice.id,
      type: "transaction",
      title: "Transfer Completed",
      message: "Your transfer of ₦50,000 to Amara Diallo was successful.",
      isRead: true,
      createdAt: daysAgo(5),
    },
    {
      userId: alice.id,
      type: "fx_alert",
      title: "FX Rate Alert",
      message: "NGN/USD rate has reached your target of 0.00065.",
      isRead: false,
      createdAt: daysAgo(1),
    },
    {
      userId: alice.id,
      type: "kyc",
      title: "KYC Verified",
      message: "Your identity has been verified. You now have Tier 3 access.",
      isRead: true,
      createdAt: daysAgo(90),
    },
    {
      userId: bob.id,
      type: "transaction",
      title: "Transfer Processing",
      message: "Your transfer of GHS 500 to Wanjiru Kamau is being processed.",
      isRead: false,
      createdAt: hoursAgo(2),
    },
    {
      userId: dave.id,
      type: "system",
      title: "Welcome to RemitFlow",
      message: "Complete your KYC to unlock higher transfer limits.",
      isRead: false,
      createdAt: daysAgo(30),
    },
  ]).onConflictDoNothing();

  // ── 8. KYC Documents ─────────────────────────────────────────────────────
  console.log("  → kycDocuments");
  await db.insert(schema.kycDocuments).values([
    {
      userId: alice.id,
      docType: "passport",
      docNumber: "A12345678",
      status: "approved",
      reviewedAt: daysAgo(88),
      expiresAt: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
      createdAt: daysAgo(90),
    },
    {
      userId: alice.id,
      docType: "selfie",
      status: "approved",
      reviewedAt: daysAgo(88),
      createdAt: daysAgo(90),
    },
    {
      userId: bob.id,
      docType: "national_id",
      docNumber: "GH-GHA-123456789",
      status: "approved",
      reviewedAt: daysAgo(58),
      expiresAt: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
      createdAt: daysAgo(60),
    },
    {
      userId: dave.id,
      docType: "national_id",
      docNumber: "KE-12345678",
      status: "pending",
      createdAt: daysAgo(2),
    },
  ]).onConflictDoNothing();

  // ── 9. Audit Logs ─────────────────────────────────────────────────────────
  console.log("  → auditLogs");
  await db.insert(schema.auditLogs).values([
    {
      userId: alice.id,
      action: "user.login",
      resource: "auth",
      severity: "info",
      metadata: { ip: "102.89.23.45", userAgent: "Mozilla/5.0 (Macintosh)" },
      createdAt: hoursAgo(2),
    },
    {
      userId: alice.id,
      action: "transfer.send",
      resource: "transactions",
      severity: "info",
      metadata: { amount: "50000", currency: "NGN", recipient: "Amara Diallo" },
      createdAt: daysAgo(5),
    },
    {
      userId: alice.id,
      action: "kyc.document.upload",
      resource: "kycDocuments",
      severity: "info",
      metadata: { docType: "passport" },
      createdAt: daysAgo(90),
    },
    {
      userId: bob.id,
      action: "user.login",
      resource: "auth",
      severity: "info",
      metadata: { ip: "154.120.45.67", userAgent: "Mozilla/5.0 (iPhone)" },
      createdAt: hoursAgo(3),
    },
    {
      userId: null,
      action: "security.failed_login",
      resource: "auth",
      severity: "warning",
      metadata: { ip: "45.33.32.156", attempts: 5, email: "unknown@attacker.com" },
      createdAt: daysAgo(1),
    },
  ]).onConflictDoNothing();

  // ── 10. Referrals ─────────────────────────────────────────────────────────
  console.log("  → referrals");
  await db.insert(schema.referrals).values([
    {
      referrerId: alice.id,
      refereeId: bob.id,
      code: "ALICE-REF-001",
      status: "rewarded",
      rewardAmount: "500.00",
      rewardCurrency: "NGN",
      completedAt: daysAgo(115),
      createdAt: daysAgo(120),
    },
    {
      referrerId: alice.id,
      refereeId: carol.id,
      code: "ALICE-REF-002",
      status: "completed",
      rewardAmount: "500.00",
      rewardCurrency: "NGN",
      completedAt: daysAgo(85),
      createdAt: daysAgo(90),
    },
    {
      referrerId: bob.id,
      refereeId: dave.id,
      code: "BOB-REF-001",
      status: "pending",
      createdAt: daysAgo(25),
    },
  ]).onConflictDoNothing();

  // ── 11. Support Tickets ───────────────────────────────────────────────────
  console.log("  → supportTickets");
  await db.insert(schema.supportTickets).values([
    {
      userId: bob.id,
      subject: "Transfer delayed — GHS to KES",
      description: "My transfer has been processing for over 2 hours. Reference: TXN-ABCD1234.",
      status: "in_progress",
      priority: "high",
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(1),
    },
    {
      userId: dave.id,
      subject: "KYC document rejected",
      description: "My national ID was rejected but the image is clear. Please review.",
      status: "open",
      priority: "medium",
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
    {
      userId: alice.id,
      subject: "Increase transfer limit",
      description: "I need to send more than the current daily limit for a business payment.",
      status: "resolved",
      priority: "low",
      resolvedAt: daysAgo(10),
      createdAt: daysAgo(15),
      updatedAt: daysAgo(10),
    },
  ]).onConflictDoNothing();

  // ── 12. Virtual Accounts ──────────────────────────────────────────────────
  console.log("  → virtualAccounts");
  await db.insert(schema.virtualAccounts).values([
    {
      userId: alice.id,
      accountNumber: "9012345678",
      bankName: "Wema Bank",
      bankCode: "035A",
      currency: "NGN",
      status: "active",
      createdAt: daysAgo(170),
    },
    {
      userId: bob.id,
      accountNumber: "GH-VA-244567890",
      bankName: "Fidelity Bank Ghana",
      bankCode: "FBG",
      currency: "GHS",
      status: "active",
      createdAt: daysAgo(110),
    },
  ]).onConflictDoNothing();

  // ── 13. Mojaloop FSPs ─────────────────────────────────────────────────────
  console.log("  → mojaloopFsps");
  await db.insert(schema.mojaloopFsps).values([
    { fspId: "remitflow-ng", name: "RemitFlow Nigeria", currency: "NGN", endpoint: "https://ng.remitflow.io/mojaloop", isActive: true },
    { fspId: "remitflow-gh", name: "RemitFlow Ghana", currency: "GHS", endpoint: "https://gh.remitflow.io/mojaloop", isActive: true },
    { fspId: "remitflow-ke", name: "RemitFlow Kenya", currency: "KES", endpoint: "https://ke.remitflow.io/mojaloop", isActive: true },
    { fspId: "remitflow-sn", name: "RemitFlow Sénégal", currency: "XOF", endpoint: "https://sn.remitflow.io/mojaloop", isActive: true },
    { fspId: "remitflow-tz", name: "RemitFlow Tanzania", currency: "TZS", endpoint: "https://tz.remitflow.io/mojaloop", isActive: false },
  ]).onConflictDoNothing();

  // ── 14. CBN Corridors ────────────────────────────────────────────────────
  console.log("  → cbnCorridors");
  await db.insert(schema.cbnCorridors).values([
    { corridor: "USD/NGN", papssEnabled: true,  exchangeRate: "1580.00", transferFeePercent: "0.50", settlementTimeHours: 24, minAmountUsd: 100,  maxAmountUsd: 50000, isActive: true },
    { corridor: "EUR/NGN", papssEnabled: true,  exchangeRate: "1720.00", transferFeePercent: "0.60", settlementTimeHours: 24, minAmountUsd: 100,  maxAmountUsd: 50000, isActive: true },
    { corridor: "GBP/NGN", papssEnabled: true,  exchangeRate: "2010.00", transferFeePercent: "0.55", settlementTimeHours: 24, minAmountUsd: 100,  maxAmountUsd: 50000, isActive: true },
    { corridor: "USD/GHS", papssEnabled: false, exchangeRate: "15.40",   transferFeePercent: "0.75", settlementTimeHours: 48, minAmountUsd: 50,   maxAmountUsd: 20000, isActive: true },
    { corridor: "USD/KES", papssEnabled: false, exchangeRate: "129.50",  transferFeePercent: "0.70", settlementTimeHours: 48, minAmountUsd: 50,   maxAmountUsd: 20000, isActive: true },
    { corridor: "USD/XOF", papssEnabled: true,  exchangeRate: "610.00",  transferFeePercent: "0.80", settlementTimeHours: 48, minAmountUsd: 50,   maxAmountUsd: 15000, isActive: true },
    { corridor: "USD/ZAR", papssEnabled: false, exchangeRate: "18.70",   transferFeePercent: "0.65", settlementTimeHours: 24, minAmountUsd: 100,  maxAmountUsd: 30000, isActive: true },
    { corridor: "GBP/GHS", papssEnabled: false, exchangeRate: "22.10",   transferFeePercent: "0.85", settlementTimeHours: 48, minAmountUsd: 50,   maxAmountUsd: 10000, isActive: false },
    { corridor: "EUR/XOF", papssEnabled: true,  exchangeRate: "655.96",  transferFeePercent: "0.50", settlementTimeHours: 24, minAmountUsd: 100,  maxAmountUsd: 25000, isActive: true },
  ]).onConflictDoNothing();

  // ── 15. BDC Partners ─────────────────────────────────────────────────────
  console.log("  → bdcPartners");
  await db.insert(schema.bdcPartners).values([
    { name: "Lagos Forex Bureau Ltd",         cbnLicenceNumber: "CBN/BDC/2019/001", adbName: "Access Bank Plc",    adbCode: "ABP001", contactEmail: "compliance@lagosforex.ng",    contactPhone: "+2341234567890", status: "approved",      maxDailyFxUsd: 500000, notes: "Tier-1 BDC, Lagos Island" },
    { name: "Abuja Capital Exchange",          cbnLicenceNumber: "CBN/BDC/2020/047", adbName: "Zenith Bank Plc",    adbCode: "ZBP047", contactEmail: "ops@abujacapital.ng",        contactPhone: "+2348012345678", status: "approved",      maxDailyFxUsd: 250000, notes: "Tier-2 BDC, FCT" },
    { name: "Port Harcourt FX Services",       cbnLicenceNumber: "CBN/BDC/2021/112", adbName: "GTBank Plc",         adbCode: "GTB112", contactEmail: "info@phfxservices.ng",       contactPhone: "+2348098765432", status: "approved",      maxDailyFxUsd: 150000, notes: "Tier-2 BDC, Rivers State" },
    { name: "Kano Northern Exchange",          cbnLicenceNumber: "CBN/BDC/2022/203", adbName: "First Bank Nigeria",  adbCode: "FBN203", contactEmail: "admin@kanonorthern.ng",      contactPhone: "+2347011223344", status: "pending_review",maxDailyFxUsd: 100000, notes: "New application — awaiting CBN field audit" },
    { name: "Ibadan Premier Bureau de Change", cbnLicenceNumber: "CBN/BDC/2018/088", adbName: "UBA Plc",            adbCode: "UBA088", contactEmail: "ceo@ibadanpremier.ng",       contactPhone: "+2348155667788", status: "approved",      maxDailyFxUsd: 200000, notes: "Tier-1 BDC, Oyo State" },
    { name: "Enugu Eastern FX Ltd",            cbnLicenceNumber: "CBN/BDC/2023/301", adbName: "Fidelity Bank Plc",  adbCode: "FID301", contactEmail: "compliance@enugueastern.ng",  contactPhone: "+2348133445566", status: "suspended",     maxDailyFxUsd: 75000,  notes: "Suspended pending AML investigation" },
  ]).onConflictDoNothing();

  // ── 16. Exchange Rate Alerts ──────────────────────────────────────────────
  console.log("  → exchangeRateAlerts");
  await db.insert(schema.exchangeRateAlerts).values([
    { userId: alice.id, fromCurrency: "USD", toCurrency: "NGN", targetRate: "1600.00", direction: "above", isActive: true,  notificationSent: false },
    { userId: alice.id, fromCurrency: "USD", toCurrency: "NGN", targetRate: "1550.00", direction: "below", isActive: true,  notificationSent: false },
    { userId: alice.id, fromCurrency: "EUR", toCurrency: "NGN", targetRate: "1750.00", direction: "above", isActive: true,  notificationSent: false },
    { userId: alice.id, fromCurrency: "GBP", toCurrency: "NGN", targetRate: "2050.00", direction: "above", isActive: false, notificationSent: true,  triggeredAt: daysAgo(1) },
    { userId: alice.id, fromCurrency: "USD", toCurrency: "GHS", targetRate: "16.00",   direction: "above", isActive: true,  notificationSent: false },
    { userId: bob.id,   fromCurrency: "USD", toCurrency: "GHS", targetRate: "14.50",   direction: "below", isActive: true,  notificationSent: false },
    { userId: carol.id, fromCurrency: "EUR", toCurrency: "XOF", targetRate: "660.00",  direction: "above", isActive: true,  notificationSent: false },
  ]).onConflictDoNothing();

  console.log("✅ Seed complete.");
  await client.end();
}

// Support --reset flag: truncate seed tables then re-seed
const isReset = process.argv.includes("--reset");
if (isReset) {
  (async () => {
    console.log("🗑️  --reset flag detected: truncating seed tables...");
    // Truncate in reverse dependency order to avoid FK violations
    const truncateTables = [
      "mojaloop_fsps",
      "fx_rates",
      "corridors",
      "notifications",
      "audit_logs",
      "transactions",
      "savings_goals",
      "beneficiaries",
      "wallets",
      "users",
    ];
    for (const t of truncateTables) {
      try {
        await client`TRUNCATE TABLE ${client.unsafe('"' + t + '"')} RESTART IDENTITY CASCADE`;
        console.log(`  ✓ truncated ${t}`);
      } catch {
        // table may not exist yet — skip silently
      }
    }
    console.log("✅ Tables truncated. Starting seed...");
    await main();
  })().catch((err) => {
    console.error("❌ Seed reset failed:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
}
