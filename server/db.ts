import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { applyTenantGuc, getRequestTenantContext } from "./_core/tenantGuc";
import {
  InsertUser, auditLogs, batchPayments, beneficiaries, bnplPlans, cards, caseComments,
  cbdcWallets, complianceCases, directDebitMandates, disputes, fxAlerts, fxRateCache,
  kycDocuments, notificationPreferences, notifications, rateLocks, recurringPayments,
  referrals, savingsGoals, splitBillGroups, splitBillParticipants, stablecoinWallets,
  supportTickets, transactions, users, userLockouts, virtualAccounts, wallets,
  outboundAnnualUsage, crossSellOffers,
} from "../drizzle/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
let _client: ReturnType<typeof postgres> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _readDb: any = null;
let _readClient: ReturnType<typeof postgres> | null = null;

export async function closeDb() {
  if (_client) {
    try { await _client.end(); } catch { /* ignore */ }
    _client = null;
    _db = null;
  }
  if (_readClient) {
    try { await _readClient.end(); } catch { /* ignore */ }
    _readClient = null;
    _readDb = null;
  }
}

function buildPoolConfig() {
  return {
    max: parseInt(process.env.DB_POOL_MAX || (process.env.NODE_ENV === "test" ? "10" : "100"), 10),
    idle_timeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || "20", 10),
    max_lifetime: parseInt(process.env.DB_POOL_MAX_LIFETIME || "900", 10),
    connect_timeout: 5,
    prepare: true,
    fetch_types: false,
    // Prevent runaway queries from blocking the connection pool
    types: undefined,
    connection: {
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || "30000", 10),
      lock_timeout: parseInt(process.env.DB_LOCK_TIMEOUT || "10000", 10),
      idle_in_transaction_session_timeout: parseInt(process.env.DB_IDLE_TX_TIMEOUT || "30000", 10),
    },
  };
}

async function tryConnect(url: string): Promise<{ client: ReturnType<typeof postgres>; db: ReturnType<typeof drizzle> } | null> {
  try {
    const probe = postgres(url, { max: 1, connect_timeout: 3 });
    await probe`SELECT 1`;
    await probe.end();
    const client = postgres(url, buildPoolConfig());
    const db = drizzle(client);
    return { client, db };
  } catch {
    logger.warn("[Database] Could not reach", url.replace(/:[^:@]+@/, ":***@").split("?")[0]);
    return null;
  }
}

export async function getDb() {
  if (!_db) {
    const localUrl = process.env.LOCAL_DATABASE_URL;
    const remoteUrl = process.env.DATABASE_URL;
    const urlsToTry = [localUrl, remoteUrl].filter(Boolean) as string[];
    for (const url of urlsToTry) {
      const result = await tryConnect(url);
      if (result) {
        _client = result.client;
        _db = result.db;
        logger.info("[Database] Primary connected:", url.replace(/:[^:@]+@/, ":***@").split("?")[0]);
        break;
      }
    }
    if (!_db) logger.warn("[Database] All primary connection attempts failed");

    // Read replica (for analytics/reporting queries)
    const replicaUrl = process.env.DATABASE_REPLICA_URL;
    if (replicaUrl) {
      const replicaResult = await tryConnect(replicaUrl);
      if (replicaResult) {
        _readClient = replicaResult.client;
        _readDb = replicaResult.db;
        logger.info("[Database] Read replica connected:", replicaUrl.replace(/:[^:@]+@/, ":***@").split("?")[0]);
      }
    }
  }
  return _db;
}

/** Read-optimized DB connection (falls back to primary if no replica configured) */
export async function getReadDb() {
  await getDb();
  return _readDb || _db;
}

/** Throws if DB unavailable instead of returning null — use for critical operations */
export async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<{ isNew: boolean }> {
  if (!user.openId) throw new Error("User openId is required");
  const db = await getDb();
  if (!db) { logger.warn("[DB] upsertUser: no DB"); return { isNew: false }; }
  const existing = await getUserByOpenId(user.openId);
  const isNew = !existing;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const fields = ["name", "email", "loginMethod"] as const;
  for (const f of fields) {
    if (user[f] !== undefined) { values[f] = user[f] ?? null; updateSet[f] = user[f] ?? null; }
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
  const dbUser = await getUserByOpenId(user.openId);
  if (dbUser) await autoSeedUser(dbUser.id);
  return { isNew };
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

/**
 * Demo-data seeder. This fabricates funded wallets, counterparties, cards and
 * transactions for UI demos. It must NEVER run in production — it creates fake
 * money. It runs only when explicitly opted in via ENABLE_DEMO_SEED=true in a
 * non-production environment. Default: off.
 */
const DEMO_SEED_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.ENABLE_DEMO_SEED === "true";

async function autoSeedUser(userId: number) {
  if (!DEMO_SEED_ENABLED) {
    if (process.env.ENABLE_DEMO_SEED === "true" && process.env.NODE_ENV === "production") {
      logger.error("[DB] ENABLE_DEMO_SEED=true ignored in production — refusing to fabricate demo wallets");
    }
    return;
  }
  const db = await getDb();
  if (!db) return;
  const existing = await db.select({ id: wallets.id }).from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (existing.length > 0) return;
  const now = new Date();
  const d = (days: number) => { const dt = new Date(now); dt.setDate(dt.getDate() - days); return dt; };
  const nextYear = new Date(now); nextYear.setFullYear(nextYear.getFullYear() + 1);
  const nextMonth = new Date(now); nextMonth.setMonth(nextMonth.getMonth() + 1);
  const ts = Date.now();
  await db.insert(wallets).values([
    { userId, currency: "NGN", balance: "2850000.00", isDefault: true, status: "active" },
    { userId, currency: "USD", balance: "1852.50", isDefault: false, status: "active" },
    { userId, currency: "GBP", balance: "1245.00", isDefault: false, status: "active" },
    { userId, currency: "EUR", balance: "980.00", isDefault: false, status: "active" },
    { userId, currency: "KES", balance: "245000.00", isDefault: false, status: "active" },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.insert(transactions).values([
    { userId, type: "send", status: "completed", fromCurrency: "NGN", fromAmount: "50000", toCurrency: "USD", toAmount: "32.50", fee: "250", fxRate: "1538.46", reference: `RF${ts}01`, description: "Transfer to Emeka Okafor", recipientName: "Emeka Okafor", recipientAccount: "0123456789", recipientBank: "First Bank", recipientCountry: "Nigeria", createdAt: d(1) },
    { userId, type: "receive", status: "completed", fromCurrency: "USD", fromAmount: "500", toCurrency: "NGN", toAmount: "769230", fee: "0", fxRate: "1538.46", reference: `RF${ts}02`, description: "Payment from Kwame Asante", recipientName: "Kwame Asante", recipientCountry: "Ghana", createdAt: d(2) },
    { userId, type: "exchange", status: "completed", fromCurrency: "USD", fromAmount: "200", toCurrency: "GBP", toAmount: "158.50", fee: "2", fxRate: "0.7925", reference: `RF${ts}03`, description: "USD to GBP exchange", createdAt: d(3) },
    { userId, type: "topup", status: "completed", fromCurrency: "NGN", fromAmount: "500000", fee: "0", reference: `RF${ts}04`, description: "Wallet top-up via bank transfer", createdAt: d(5) },
    { userId, type: "send", status: "completed", fromCurrency: "NGN", fromAmount: "25000", toCurrency: "NGN", toAmount: "25000", fee: "125", fxRate: "1", reference: `RF${ts}05`, description: "Rent payment", recipientName: "Landlord Holdings Ltd", recipientAccount: "9876543210", recipientBank: "GTBank", recipientCountry: "Nigeria", createdAt: d(7) },
    { userId, type: "airtime", status: "completed", fromCurrency: "NGN", fromAmount: "500", fee: "0", reference: `RF${ts}06`, description: "MTN airtime top-up 08012345678", createdAt: d(8) },
    { userId, type: "bill", status: "completed", fromCurrency: "NGN", fromAmount: "15000", fee: "0", reference: `RF${ts}07`, description: "DSTV Premium subscription", createdAt: d(10) },
    { userId, type: "send", status: "pending", fromCurrency: "USD", fromAmount: "150", toCurrency: "KES", toAmount: "19500", fee: "3", fxRate: "130", reference: `RF${ts}08`, description: "Transfer to Amina Wanjiru", recipientName: "Amina Wanjiru", recipientBank: "M-Pesa", recipientCountry: "Kenya", createdAt: d(0) },
    { userId, type: "receive", status: "completed", fromCurrency: "GBP", fromAmount: "300", toCurrency: "NGN", toAmount: "585000", fee: "0", fxRate: "1950", reference: `RF${ts}09`, description: "Salary payment from TechCorp Ltd", recipientName: "TechCorp Ltd", recipientCountry: "UK", createdAt: d(14) },
    { userId, type: "send", status: "failed", fromCurrency: "USD", fromAmount: "75", toCurrency: "GHS", toAmount: "900", fee: "1.5", fxRate: "12", reference: `RF${ts}10`, description: "Transfer failed - insufficient funds", recipientName: "Kofi Mensah", recipientCountry: "Ghana", createdAt: d(15) },
  ] as Parameters<typeof db.insert>[0] extends { values: infer V } ? V : never);
  await db.insert(beneficiaries).values([
    { userId, name: "Emeka Okafor", accountNumber: "0123456789", bankName: "First Bank", bankCode: "011", currency: "NGN", country: "Nigeria", isFavorite: true },
    { userId, name: "Amina Wanjiru", accountNumber: "+254712345678", bankName: "M-Pesa", bankCode: "MPESA", currency: "KES", country: "Kenya", isFavorite: true },
    { userId, name: "Kwame Asante", accountNumber: "GH-1234567890", bankName: "GCB Bank", bankCode: "GCB", currency: "GHS", country: "Ghana", isFavorite: false },
    { userId, name: "Fatima Al-Hassan", accountNumber: "SA-9876543210", bankName: "Al Rajhi Bank", bankCode: "RAJHI", currency: "SAR", country: "Saudi Arabia", isFavorite: false },
    { userId, name: "Chidi Nwachukwu", accountNumber: "9876543210", bankName: "GTBank", bankCode: "058", currency: "NGN", country: "Nigeria", isFavorite: true },
  ]);
  await db.insert(cards).values([
    { userId, type: "virtual", brand: "visa", last4: "4242", expiryMonth: "12", expiryYear: "2027", status: "active", currency: "USD", spendLimit: "5000.00", cardholderName: "DEMO USER" },
    { userId, type: "virtual", brand: "mastercard", last4: "5555", expiryMonth: "08", expiryYear: "2026", status: "active", currency: "GBP", spendLimit: "2000.00", cardholderName: "DEMO USER" },
    { userId, type: "physical", brand: "verve", last4: "6011", expiryMonth: "03", expiryYear: "2028", status: "frozen", currency: "NGN", spendLimit: "500000.00", cardholderName: "DEMO USER" },
  ]);
  await db.insert(savingsGoals).values([
    { userId, name: "Emergency Fund", emoji: "🛡️", targetAmount: "500000.00", currentAmount: "320000.00", currency: "NGN", targetDate: nextYear, autoSave: true, autoSaveAmount: "20000.00", status: "active" },
    { userId, name: "MacBook Pro", emoji: "💻", targetAmount: "2000.00", currentAmount: "850.00", currency: "USD", targetDate: nextYear, autoSave: true, autoSaveAmount: "150.00", status: "active" },
    { userId, name: "Vacation to Dubai", emoji: "✈️", targetAmount: "1500.00", currentAmount: "1500.00", currency: "USD", status: "completed" },
  ]);
  await db.insert(fxAlerts).values([
    { userId, fromCurrency: "USD", toCurrency: "NGN", targetRate: "1600.000000", direction: "above", isActive: true, triggered: false },
    { userId, fromCurrency: "GBP", toCurrency: "NGN", targetRate: "1800.000000", direction: "below", isActive: true, triggered: false },
    { userId, fromCurrency: "EUR", toCurrency: "NGN", targetRate: "1700.000000", direction: "above", isActive: false, triggered: true },
  ]);
  await db.insert(kycDocuments).values([
    { userId, docType: "national_id", status: "approved", fileUrl: "https://placehold.co/400x250?text=National+ID" },
    { userId, docType: "selfie", status: "approved", fileUrl: "https://placehold.co/400x400?text=Selfie" },
    { userId, docType: "utility_bill", status: "pending" },
  ]);
  await db.insert(notifications).values([
    { userId, title: "Transfer Successful", message: "Your transfer of ₦50,000 to Emeka Okafor has been completed.", type: "transaction", isRead: false },
    { userId, title: "KYC Approved", message: "Your National ID has been verified. You are now Tier 1 verified.", type: "kyc", isRead: false },
    { userId, title: "FX Alert Triggered", message: "GBP/NGN has reached your target rate of 1,800.", type: "fx_alert", isRead: true },
    { userId, title: "Security Alert", message: "New login detected from Lagos, Nigeria. If this was not you, secure your account.", type: "security", isRead: false },
    { userId, title: "Welcome to RemitFlow!", message: "Your account is set up. Start by adding money to your wallet.", type: "system", isRead: true },
  ]);
  await db.insert(auditLogs).values([
    { userId, action: "LOGIN", description: "User logged in successfully", ipAddress: "197.210.54.12", userAgent: "Chrome 122 / Windows", severity: "info" },
    { userId, action: "TRANSFER_INITIATED", description: "Transfer of NGN 50,000 to Emeka Okafor", ipAddress: "197.210.54.12", userAgent: "Chrome 122 / Windows", severity: "info" },
    { userId, action: "KYC_SUBMITTED", description: "National ID document submitted for review", ipAddress: "197.210.54.12", userAgent: "Chrome 122 / Windows", severity: "info" },
    { userId, action: "CARD_CREATED", description: "Virtual Visa card created", ipAddress: "197.210.54.12", userAgent: "Chrome 122 / Windows", severity: "info" },
  ]);
  await db.insert(virtualAccounts).values([
    { userId, currency: "GBP", bank: "Barclays Bank", accountNumber: "12345678", accountName: "DEMO USER", sortCode: "20-00-00", swiftCode: "BARCGB22" },
    { userId, currency: "EUR", bank: "Deutsche Bank", accountNumber: "DE89370400440532013000", accountName: "DEMO USER", iban: "DE89370400440532013000", swiftCode: "DEUTDEDB" },
    { userId, currency: "USD", bank: "JPMorgan Chase", accountNumber: "000123456789", accountName: "DEMO USER", routingNumber: "021000021", swiftCode: "CHASUS33" },
  ]);
  await db.insert(recurringPayments).values([
    { userId, name: "Netflix Subscription", recipientName: "Netflix Inc", recipientAccount: "NETFLIX-001", recipientBank: "Stripe", amount: "4500.00", currency: "NGN", frequency: "monthly", nextRunAt: nextMonth, status: "active" },
    { userId, name: "Rent Payment", recipientName: "Landlord Holdings", recipientAccount: "9876543210", recipientBank: "GTBank", amount: "150000.00", currency: "NGN", frequency: "monthly", nextRunAt: nextMonth, status: "active" },
    { userId, name: "Savings Auto-Transfer", recipientName: "Emergency Fund", amount: "20000.00", currency: "NGN", frequency: "monthly", nextRunAt: nextMonth, status: "active" },
  ]);
  // ── BNPL Plans ──────────────────────────────────────────────────────────────
  await db.insert(bnplPlans).values([
    { userId, merchant: "Jumia", description: "Samsung Galaxy A54 — 6 installments", totalAmount: "450.00", currency: "USD", installmentAmount: "75.00", installmentsTotal: 6, installmentsPaid: 2, nextPaymentAt: nextMonth, status: "active" },
    { userId, merchant: "Konga", description: "HP Laptop — 3 installments", totalAmount: "900.00", currency: "USD", installmentAmount: "300.00", installmentsTotal: 3, installmentsPaid: 3, status: "completed" },
  ]).onConflictDoNothing();
  // ── Disputes ─────────────────────────────────────────────────────────────────
  await db.insert(disputes).values([
    { userId, transactionId: null, type: "not_received", description: "Sent ₦50,000 to wrong account — recipient not found", status: "under_review", amount: "50000.00", currency: "NGN" },
    { userId, transactionId: null, type: "wrong_amount", description: "Charged $25 instead of $15 for airtime top-up", status: "resolved", amount: "25.00", currency: "USD" },
  ]).onConflictDoNothing();
  // ── Referrals ────────────────────────────────────────────────────────────────
  await db.insert(referrals).values([
    { referrerId: userId, referredId: userId, status: "rewarded", rewardAmount: "10.00", rewardCurrency: "USD" },
    { referrerId: userId, referredId: userId, status: "completed", rewardAmount: "10.00", rewardCurrency: "USD" },
    { referrerId: userId, referredId: userId, status: "pending" },
  ]).onConflictDoNothing();
  // ── Batch Payments ───────────────────────────────────────────────────────────
  await db.insert(batchPayments).values([
    { userId, name: "March Payroll", description: "Staff salary disbursement", currency: "NGN", totalAmount: "4500000.00", recipientCount: 12, status: "completed" },
    { userId, name: "Supplier Payments", description: "Q1 vendor payments", currency: "USD", totalAmount: "8500.00", recipientCount: 5, status: "processing" },
  ]).onConflictDoNothing();
  // ── Rate Locks ───────────────────────────────────────────────────────────────
  await db.insert(rateLocks).values([
    { userId, fromCurrency: "USD", toCurrency: "NGN", lockedRate: "1538.460000", amount: "500.00", expiresAt: new Date(Date.now() + 15 * 60 * 1000), status: "active" },
    { userId, fromCurrency: "GBP", toCurrency: "NGN", lockedRate: "1941.230000", amount: "200.00", expiresAt: new Date(Date.now() - 60 * 60 * 1000), status: "expired" },
  ]).onConflictDoNothing();
  // ── Direct Debit Mandates ────────────────────────────────────────────────────
  await db.insert(directDebitMandates).values([
    { userId, reference: `DD-${userId}-001`, creditorName: "Netflix", creditorAccount: "NETFLIX-001", creditorBank: "Stripe", amount: "4500.00", currency: "NGN", frequency: "monthly", nextDebitAt: nextMonth, status: "active" },
    { userId, reference: `DD-${userId}-002`, creditorName: "Spotify", creditorAccount: "SPOTIFY-001", creditorBank: "Stripe", amount: "2000.00", currency: "NGN", frequency: "monthly", nextDebitAt: nextMonth, status: "active" },
  ]).onConflictDoNothing();
  // ── Split Bill Groups ────────────────────────────────────────────────────────
  const [splitGroup] = await db.insert(splitBillGroups).values([
    { creatorId: userId, title: "Lagos Dinner — April", description: "Team dinner at Nok by Alara", totalAmount: "85000.00", currency: "NGN", participantCount: 4, status: "active" },
  ]).returning().catch(() => []);
  if (splitGroup) {
    await db.insert(splitBillParticipants).values([
      { groupId: splitGroup.id, userId, name: "You", email: null, shareAmount: "21250.00", status: "paid" },
    ]).onConflictDoNothing();
  }
  // ── Stablecoin Wallets ───────────────────────────────────────────────────────
  await db.insert(stablecoinWallets).values([
    { userId, symbol: "USDT", network: "Ethereum", address: `0x${userId.toString(16).padStart(40, '0')}`, balance: "250.000000", usdValue: "250.00" },
    { userId, symbol: "USDC", network: "Polygon", address: `0x${(userId + 1).toString(16).padStart(40, '0')}`, balance: "100.000000", usdValue: "100.00" },
    { userId, symbol: "cUSD", network: "Celo", address: `0x${(userId + 2).toString(16).padStart(40, '0')}`, balance: "50.000000", usdValue: "50.00" },
  ]).onConflictDoNothing();
  // ── CBDC Wallets ─────────────────────────────────────────────────────────────
  await db.insert(cbdcWallets).values([
    { userId, currency: "eNaira", issuer: "Central Bank of Nigeria", balance: "50000.000000", walletAddress: `eNGN-${userId}-DEMO`, status: "active" },
    { userId, currency: "eCedi", issuer: "Bank of Ghana", balance: "1200.000000", walletAddress: `eGHS-${userId}-DEMO`, status: "active" },
  ]).onConflictDoNothing();
  // ── Support Tickets ──────────────────────────────────────────────────────────
  await db.insert(supportTickets).values([
    { userId, subject: "Transfer delayed — 48 hours pending", description: "My transfer to Kenya has been pending for 2 days. Reference: TXN-2024-001.", status: "open", priority: "high" },
    { userId, subject: "Card declined at POS", description: "My virtual Visa card was declined at a Lagos supermarket.", status: "resolved", priority: "medium" },
  ]).onConflictDoNothing();
  const code = `RF${userId}${randomBytes(3).toString("hex").toUpperCase()}`;
  await db.update(users).set({ kycTier: "tier1", referralCode: code }).where(eq(users.id, userId));
  logger.info(`[DB] Auto-seeded demo data for user ${userId} (v121)`);
}

export async function getWalletsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.status, "active")));
}

export async function getWalletByUserAndCurrency(userId: number, currency: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.currency, currency))).limit(1);
  return result[0];
}

export async function getTransactionsByUserId(userId: number, opts?: { limit?: number; offset?: number; type?: string; status?: string; search?: string }) {
  const db = await getDb();
  if (!db) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [eq(transactions.userId, userId)];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (opts?.type && opts.type !== "all") conditions.push(eq(transactions.type, opts.type as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (opts?.status && opts.status !== "all") conditions.push(eq(transactions.status, opts.status as any));
  if (opts?.search) conditions.push(or(like(transactions.description, `%${opts.search}%`), like(transactions.reference, `%${opts.search}%`), like(transactions.recipientName, `%${opts.search}%`)));
  return db.select().from(transactions).where(and(...conditions)).orderBy(desc(transactions.createdAt)).limit(opts?.limit ?? 50).offset(opts?.offset ?? 0);
}

export async function createTransaction(data: {
  userId: number; type: string; status?: string; fromCurrency: string; fromAmount: string;
  toCurrency?: string; toAmount?: string; fee?: string; fxRate?: string; reference?: string;
  description?: string; recipientName?: string; recipientAccount?: string; recipientBank?: string; recipientCountry?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const ref = data.reference || `RF${Date.now()}${randomBytes(2).toString("hex").toUpperCase()}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.insert(transactions).values({ ...data, reference: ref, status: (data.status || "completed") as any, type: data.type as any });
  return ref;
}

export async function getBeneficiariesByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(beneficiaries).where(eq(beneficiaries.userId, userId)).orderBy(desc(beneficiaries.isFavorite), beneficiaries.name);
}

export async function getCardsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cards).where(eq(cards.userId, userId)).orderBy(desc(cards.createdAt));
}

export async function getSavingsGoalsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)).orderBy(desc(savingsGoals.createdAt));
}

export async function getFxAlertsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(fxAlerts).where(eq(fxAlerts.userId, userId)).orderBy(desc(fxAlerts.createdAt));
}

export async function getKycDocsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(kycDocuments).where(eq(kycDocuments.userId, userId)).orderBy(desc(kycDocuments.createdAt));
}

export async function getNotificationsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(50);
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return Number(result[0]?.count ?? 0);
}

export async function getAuditLogsByUserId(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

export async function createAuditLog(data: { userId: number; action: string; description?: string; ipAddress?: string; userAgent?: string; severity?: "info" | "warning" | "critical"; targetId?: number; targetType?: string; metadata?: unknown }) {
  const db = await getDb();
  if (!db) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.insert(auditLogs).values({ ...data, severity: (data.severity || "info") as any });
}

// ─── Transactional Outbox Helpers ─────────────────────────────────────────────
// Canonical outbox_events columns (migration 0000 + 0076 + 0083):
//   aggregate_id, aggregate_type, event_type, payload (text), status,
//   retry_count, max_retries, published_at, failed_at, next_retry_at,
//   error_message, locked_at, locked_by, created_at
// The outbox worker (server/workers/outbox.worker.ts) routes on aggregate_type
// (Fluvio topic name or "dapr.*" routing key) and publishes payload verbatim.

export interface OutboxEventInput {
  /** Partition/ordering key — FIFO is preserved per aggregate_id. */
  aggregateId: string;
  /** Fluvio topic (e.g. "transfer-events") or Dapr routing key ("dapr.*"). */
  aggregateType: string;
  eventType: string;
  /** Serializable payload — stored as JSON text. */
  payload: unknown;
  maxRetries?: number;
}

/**
 * Insert an outbox event inside an existing transaction. ALWAYS use this (or
 * withTransactionOutbox) for outbox writes so the domain change and its event
 * commit or roll back atomically — a bare INSERT outside the transaction is
 * the classic dual-write bug.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insertOutboxEvent(tx: any, event: OutboxEventInput): Promise<void> {
  const payloadText = typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload);
  await tx.execute(sql`
    INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status, max_retries, created_at)
    VALUES (${event.aggregateId}, ${event.aggregateType}, ${event.eventType}, ${payloadText}, 'pending', ${event.maxRetries ?? 5}, NOW())
  `);
}

/**
 * Run `operation` inside a single database transaction and append outbox
 * events in the SAME transaction — domain write + event publish are atomic.
 * When a request tenant context is bound (tRPC tenant middleware), the RLS
 * GUCs (app.current_tenant_id / app.current_user_id) are set on the
 * transaction before any other statement. Throws (and rolls everything back)
 * when the DB is unavailable.
 */
export async function withTransactionOutbox<T>(
  operation: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    emit: (event: OutboxEventInput) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const db = await requireDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db.transaction(async (tx: any) => {
    // Set RLS GUCs when running inside a request context; outside a request
    // (workers/cron) there is deliberately no tenant binding.
    await applyTenantGuc(tx, { required: getRequestTenantContext() !== undefined });
    const emit = (event: OutboxEventInput) => insertOutboxEvent(tx, event);
    return operation(tx, emit);
  });
}

export async function getVirtualAccountsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(virtualAccounts).where(eq(virtualAccounts.userId, userId));
}

export async function getRecurringPaymentsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(recurringPayments).where(eq(recurringPayments.userId, userId)).orderBy(desc(recurringPayments.createdAt));
}

export async function getBatchPaymentsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(batchPayments).where(eq(batchPayments.userId, userId)).orderBy(desc(batchPayments.createdAt));
}

export async function getReferralsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(referrals).where(eq(referrals.referrerId, userId)).orderBy(desc(referrals.createdAt));
}

export async function getDisputesByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(disputes).where(eq(disputes.userId, userId)).orderBy(desc(disputes.createdAt));
}

export async function getCachedFxRates(base: string): Promise<Record<string, number> | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(fxRateCache).where(eq(fxRateCache.baseCurrency, base)).orderBy(desc(fxRateCache.fetchedAt)).limit(1);
  if (!result[0]) return null;
  const age = Date.now() - new Date(result[0].fetchedAt).getTime();
  if (age > 30 * 60 * 1000) return null;
  return result[0].rates as Record<string, number>;
}

export async function saveFxRates(base: string, rates: Record<string, number>) {
  const db = await getDb();
  if (!db) return;
  await db.insert(fxRateCache).values({ baseCurrency: base, rates });
}

export async function getNotificationPreferences(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
}

export async function upsertNotificationPreference(
  userId: number,
  category: string,
  emailEnabled: boolean,
  inAppEnabled: boolean,
  pushEnabled: boolean
) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(notificationPreferences)
    .values({ userId, category, emailEnabled, inAppEnabled, pushEnabled })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.category],
      set: { emailEnabled, inAppEnabled, pushEnabled },
    });
}

export async function getCaseCommentsByCaseId(caseId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(caseComments).where(eq(caseComments.caseId, caseId)).orderBy(caseComments.createdAt);
}

// ─── User Lockout DB Helpers (v148) ──────────────────────────────────────────
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export async function getUserLockout(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(userLockouts).where(eq(userLockouts.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function recordLoginFailure(userId: number): Promise<{ locked: boolean; retryAfterSec: number }> {
  const db = await getDb();
  if (!db) return { locked: false, retryAfterSec: 0 };
  const now = new Date();
  const existing = await getUserLockout(userId);
  const newAttempts = (existing?.failedAttempts ?? 0) + 1;
  const shouldLock = newAttempts >= LOCKOUT_MAX_ATTEMPTS;
  const lockExpiresAt = shouldLock ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null;
  await db
    .insert(userLockouts)
    .values({
      userId,
      failedAttempts: newAttempts,
      lastFailedAt: now,
      lockedAt: shouldLock ? now : undefined,
      lockExpiresAt: lockExpiresAt ?? undefined,
    })
    .onConflictDoUpdate({
      target: [userLockouts.userId],
      set: {
        failedAttempts: newAttempts,
        lastFailedAt: now,
        lockedAt: shouldLock ? now : undefined,
        lockExpiresAt: lockExpiresAt ?? undefined,
        updatedAt: now,
      },
    });
  const retryAfterSec = shouldLock ? Math.ceil(LOCKOUT_DURATION_MS / 1000) : 0;
  // ─── v150: Send lockout notification email when account is locked ──────────
  if (shouldLock) {
    try {
      const { notifyOwner } = await import("./_core/notification.js");
      // Fetch user email for the notification
      const userRow = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      const userEmail = userRow[0]?.email ?? `user #${userId}`;
      const userName = userRow[0]?.name ?? `User #${userId}`;
      const unlockTime = new Date(now.getTime() + LOCKOUT_DURATION_MS).toLocaleString("en-US", { timeZone: "UTC" });
      await notifyOwner({
        title: `⚠️ Account Locked: ${userName}`,
        content: `The account for ${userName} (${userEmail}) has been temporarily locked after ${LOCKOUT_MAX_ATTEMPTS} consecutive failed login attempts.\n\nLock expires: ${unlockTime} UTC\nUser ID: ${userId}\n\nIf this was not the user, their account may be under a credential-stuffing attack. Consider reviewing the SIEM events in the Security Dashboard.`,
      });
      // ─── v151: Persist notification timestamp to prevent duplicate emails ───
      try {
        await db.update(userLockouts)
          .set({ notificationSentAt: new Date(), updatedAt: new Date() })
          .where(eq(userLockouts.userId, userId));
      } catch (_) { /* swallow */ }
    } catch (_) { /* swallow — notification failure must never block auth */ }
  }
  return { locked: shouldLock, retryAfterSec };
}
export async function checkDbUserLockout(userId: number): Promise<{ locked: boolean; retryAfterSec: number }> {
  const db = await getDb();
  if (!db) return { locked: false, retryAfterSec: 0 };
  const row = await getUserLockout(userId);
  if (!row || !row.lockExpiresAt) return { locked: false, retryAfterSec: 0 };
  const now = Date.now();
  const expiresAt = new Date(row.lockExpiresAt).getTime();
  if (now < expiresAt) {
    return { locked: true, retryAfterSec: Math.ceil((expiresAt - now) / 1000) };
  }
  // Lockout expired — clear it
  await db.delete(userLockouts).where(eq(userLockouts.userId, userId));
  return { locked: false, retryAfterSec: 0 };
}

export async function clearDbUserLockout(userId: number, adminId?: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(userLockouts)
    .set({ lockedAt: null, lockExpiresAt: null, failedAttempts: 0, unlockedAt: new Date(), unlockedByAdminId: adminId ?? null, updatedAt: new Date() })
    .where(eq(userLockouts.userId, userId));
}

export async function resetLoginAttempts(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(userLockouts).where(eq(userLockouts.userId, userId));
}

export async function getAllUserLockouts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userLockouts).orderBy(desc(userLockouts.updatedAt));
}
export async function getLockoutHistoryForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(userLockouts)
    .where(eq(userLockouts.userId, userId))
    .orderBy(desc(userLockouts.updatedAt));
}

// ─── v150: Lockout trends — daily lockout counts for the last N days ─────────
export async function getLockoutTrends(days = 30): Promise<Array<{ date: string; lockouts: number; attempts: number }>> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      date: sql<string>`DATE(${userLockouts.lockedAt})`,
      lockouts: sql<number>`COUNT(CASE WHEN ${userLockouts.lockedAt} IS NOT NULL THEN 1 END)::int`,
      attempts: sql<number>`SUM(${userLockouts.failedAttempts})::int`,
    })
    .from(userLockouts)
    .where(sql`${userLockouts.updatedAt} >= ${since}`)
    .groupBy(sql`DATE(${userLockouts.lockedAt})`)
    .orderBy(sql`DATE(${userLockouts.lockedAt}) ASC`);
  return rows.filter((r: any) => r.date !== null) as Array<{ date: string; lockouts: number; attempts: number }>;
}

// ─── v152: Self-service unlock flow ─────────────────────────────────────────
const UNLOCK_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const UNLOCK_REQUEST_COOLDOWN_MS = 60 * 60 * 1000; // 1 request per hour

export async function requestSelfUnlock(userId: number): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database unavailable" };
  const row = await getUserLockout(userId);
  if (!row || !row.lockExpiresAt) return { ok: false, error: "Account is not locked" };
  // Rate-limit: only 1 request per hour
  if (row.unlockRequestedAt) {
    const elapsed = Date.now() - new Date(row.unlockRequestedAt).getTime();
    if (elapsed < UNLOCK_REQUEST_COOLDOWN_MS) {
      const waitMin = Math.ceil((UNLOCK_REQUEST_COOLDOWN_MS - elapsed) / 60000);
      return { ok: false, error: `Please wait ${waitMin} more minute(s) before requesting another unlock.` };
    }
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + UNLOCK_TOKEN_TTL_MS);
  await db.update(userLockouts)
    .set({ unlockToken: token, unlockTokenExpiresAt: expiresAt, unlockRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(userLockouts.userId, userId));
  // Send unlock link via owner notification (proxied to user in production)
  try {
    const { notifyOwner } = await import("./_core/notification.js");
    const userRow = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const userName = userRow[0]?.name ?? `User #${userId}`;
    // v153: Include full clickable unlock URL in the notification email body
    // In production the VITE_APP_ORIGIN env var holds the deployed domain.
    // Fallback to a relative path so it works in dev/staging too.
    const appOrigin = (typeof process !== "undefined" && process.env.VITE_APP_ORIGIN)
      ? process.env.VITE_APP_ORIGIN.replace(/\/$/, "")
      : "";
    const unlockUrl = `${appOrigin}/unlock?token=${token}`;
    await notifyOwner({
      title: `🔓 Unlock Request: ${userName}`,
      content: `User ${userName} (ID: ${userId}) has requested a self-service account unlock.\n\nClick the link below to unlock your account:\n${unlockUrl}\n\nThis link expires at: ${expiresAt.toUTCString()}\n\nIf you did not request this, ignore this email — your account remains locked.`,
    });
  } catch { /* swallow */ }
  return { ok: true };
}

export async function verifySelfUnlockToken(token: string): Promise<{ ok: boolean; error?: string; userId?: number }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database unavailable" };
  const rows = await db.select().from(userLockouts)
    .where(eq(userLockouts.unlockToken, token))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Invalid or expired unlock token" };
  if (!row.unlockTokenExpiresAt || new Date(row.unlockTokenExpiresAt) < new Date()) {
    return { ok: false, error: "Unlock token has expired. Please request a new one." };
  }
  // Clear lockout and token
  await db.update(userLockouts)
    .set({
      lockedAt: null, lockExpiresAt: null, failedAttempts: 0,
      unlockToken: null, unlockTokenExpiresAt: null,
      unlockedAt: new Date(), updatedAt: new Date(),
    })
    .where(eq(userLockouts.userId, row.userId));
  return { ok: true, userId: row.userId };
}


// ─── v199: Outbound Annual Usage helpers ─────────────────────────────────────
export async function getAnnualUsage(userId: number, purposeCode: string, year: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(outboundAnnualUsage)
    .where(and(eq(outboundAnnualUsage.userId, userId), eq(outboundAnnualUsage.purposeCode, purposeCode.toUpperCase()), eq(outboundAnnualUsage.calendarYear, year)))
    .limit(1);
  return rows[0] ?? null;
}

export async function incrementAnnualUsage(userId: number, purposeCode: string, amountUsd: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const year = new Date().getFullYear();
  const code = purposeCode.toUpperCase();
  const existing = await getAnnualUsage(userId, code, year);
  if (existing) {
    const newUsed = (safeParseAmount(existing.usedUsd as string) + amountUsd).toFixed(2);
    await db.update(outboundAnnualUsage)
      .set({ usedUsd: newUsed, lastTransactionAt: new Date(), updatedAt: new Date() })
      .where(and(eq(outboundAnnualUsage.userId, userId), eq(outboundAnnualUsage.purposeCode, code), eq(outboundAnnualUsage.calendarYear, year)));
  } else {
    await db.insert(outboundAnnualUsage).values({ userId, purposeCode: code, calendarYear: year, usedUsd: amountUsd.toFixed(2), lastTransactionAt: new Date() });
  }
}

export async function getAllAnnualUsageForUser(userId: number, year: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(outboundAnnualUsage)
    .where(and(eq(outboundAnnualUsage.userId, userId), eq(outboundAnnualUsage.calendarYear, year)));
}

// ─── v199: Cross-Sell Offer helpers ──────────────────────────────────────────
export async function getActiveCrossSellOffer(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const rows = await db.select().from(crossSellOffers)
    .where(and(eq(crossSellOffers.userId, userId), eq(crossSellOffers.status, "pending")))
    .orderBy(desc(crossSellOffers.createdAt))
    .limit(1);
  const offer = rows[0];
  if (!offer) return null;
  // Check expiry
  if (offer.expiresAt && new Date(offer.expiresAt) < now) {
    await db.update(crossSellOffers).set({ status: "expired" }).where(eq(crossSellOffers.id, offer.id));
    return null;
  }
  return offer;
}

export async function createCrossSellOffer(data: {
  userId: number;
  offerType: "savings_account" | "diaspora_bond" | "insurance" | "investment_fund" | "credit_card";
  score: number;
  segment?: string;
  headline?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const rows = await db.insert(crossSellOffers).values({
    userId: data.userId,
    offerType: data.offerType,
    score: data.score.toFixed(4),
    segment: data.segment,
    headline: data.headline,
    body: data.body,
    ctaLabel: data.ctaLabel,
    ctaUrl: data.ctaUrl,
    status: "pending",
    expiresAt,
  }).returning();
  return rows[0];
}

export async function respondToCrossSellOffer(offerId: number, response: "accepted" | "dismissed") {
  const db = await getDb();
  if (!db) return;
  await db.update(crossSellOffers)
    .set({ status: response, respondedAt: new Date() })
    .where(eq(crossSellOffers.id, offerId));
}

export async function markCrossSellOfferShown(offerId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(crossSellOffers)
    .set({ status: "shown", shownAt: new Date() })
    .where(and(eq(crossSellOffers.id, offerId), eq(crossSellOffers.status, "pending")));
}

// ─── v201: Auto-generated CRUD helpers for all schema tables ─────────────────
import { scheduledTransferRuns, consentRecords, paymentMetrics, mojaloopTransfers, posTerminals, agentAccounts, kybRecords, idempotencyKeys, outboxEvents, erasureRequests } from '../drizzle/schema';
import { chatSessions, chatMessages, impersonationTokens, fraudAlerts, analyticsThresholds, marketListings, marketOrders, talentProfiles, talentOpportunities, talentBookings } from '../drizzle/schema';
import { communityFunds, fundProposals, fundVotes, diasporaCollectives, diasporaCollectiveMembers, investmentOpportunities, marketRatings, familyMembers, familyBudgets, investmentAssets } from '../drizzle/schema';
import { userInvestments, investmentWatchlist, investmentOrders, investmentPriceHistory, tenants, tenantUsers, featureFlags, tenantFeatureFlags, userFeatureFlags, whiteLabelConfigs } from '../drizzle/schema';
import { travelRuleRecords, partnerInviteCodes, tenantOnboardingSessions, partnerPayouts, webhookEndpoints, webhookDeliveries, apiKeys, paymentGatewayLogs, complianceWatchlist, fxRateHistory } from '../drizzle/schema';
import { systemConfig, ngxStocks, stockWatchlists, ngxOrders, realEstateListings, realEstateInvestments, startupDeals, startupInvestments, paypalTransactions, flutterwaveTransactions } from '../drizzle/schema';
import { corridorMarginHistory, pushSubscriptions, apiKeyUsageLogs, stripeReceipts, fxAlertTriggerHistory, treasuryPositions, slaIncidents, chargebackCases, smartRoutingDecisions, complianceReports } from '../drizzle/schema';
import { developerSandboxSessions, sandboxScenarios, complianceAlerts, securityEvents, mfaSettings, transferAuditTrail, feeRules, promoCodes, promoRedemptions, dailyVolumeSnapshots } from '../drizzle/schema';
import { userNotifPrefs, scheduledTransfers, exchangeRateAlerts, nifiPipelineRuns, dbtRunHistory, airflowDagRuns, tenantConfigs, sanctionsChecks, bulkPaymentBatches, openBankingConsents } from '../drizzle/schema';
import { regulatoryReports, fraudModelRuns, partnerApplications, partnerApplicationComments, partnerApiKeys, partnerWebhooks, userOnboardingProgress, complianceEmailConfig, abExperiments, abAssignments } from '../drizzle/schema';
import { abEvents, referralBonuses, documentVaultTable, rateAlertHistory, docReminderPrefs, docReminderLog, velocityRules, velocityOverrides, velocityWhitelist, kycLifecycle } from '../drizzle/schema';
import { kycLifecycleHistory, documentRenewals, webhookRetryQueue, apiKeyRotationLog, batchPaymentItems, systemConfigAuditLog, kafkaConsumerMetrics, transactionExports, ipLoginHistory, cbdcMintBurnLog } from '../drizzle/schema';
import { communityActivityFeed, ctrAutoFlags, mojaloopFsps, bulkUserActionLog, stripeWebhookRetryLog, revenueShareAgreements, revenueShareTiers, revenueShareLedger, revenueShareReports, chatSessionMeta } from '../drizzle/schema';
import { chatAgentStatus, chatCannedResponses, agreementTemplates, partnerDigitalAgreements, agreementSignatures, cronJobs, apiChangelogs, securityIncidents, paymentRequests, pushNotificationPreferences } from '../drizzle/schema';
import { bricspayTransfers, mbridgeTransfers, ghipssTransfers, africbdcTransfers, papssTransfers, railHealthStatus, settlementAccounts, bmatchRateSnapshots, walletFundingEvents, bdcPartners } from '../drizzle/schema';
import { bdcLiquidityRequests, cbnComplianceExports, cbnCorridors, westAfricanCorridors, xofPayoutAccounts, ecowasComplianceChecks, immigrantWorkerProfiles, tieredKycSessions, agentCashinTransactions, hnwProfiles } from '../drizzle/schema';
import { hnwFxRates, hnwRelationshipManagers, hnwPortfolios, correspondentBanks, clearingLines, correspondentRiskScores, derisikingAlerts, smeTradeBulkBatches, smeTradePayments, formMDocuments } from '../drizzle/schema';
import { diasporaUsaProfiles, achPaymentMethods, usComplianceDisclosures, diasporaEuProfiles, sepaPaymentMethods, diasporaCanadaProfiles, interacPaymentMethods, westAfricaTransfers, immigrantWorkerKyc, hnwClientProfiles } from '../drizzle/schema';
import { hnwRateLocks, hnwTransfers, hnwRmRequests, correspondentBanksV200, correspondentSettlements, smeTradeBatches, diasporaProfiles, diasporaOfferClaims, transfers } from '../drizzle/schema';
import { logger } from './_core/logger';
import { safeParseAmount } from "./lib/safeDecimal";


// ── scheduledTransferRuns ──
export async function getScheduledTransferRuns(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(scheduledTransferRuns).limit(100);
    return rows;
  } catch { return []; }
}

export async function createScheduledTransferRuns(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(scheduledTransferRuns).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateScheduledTransferRuns(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(scheduledTransferRuns).set(data).where((scheduledTransferRuns as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteScheduledTransferRuns(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(scheduledTransferRuns).where((scheduledTransferRuns as any).id === id);
    return true;
  } catch { return false; }
}

// ── consentRecords ──
export async function getConsentRecords(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(consentRecords).limit(100);
    return rows;
  } catch { return []; }
}

export async function createConsentRecords(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(consentRecords).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateConsentRecords(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(consentRecords).set(data).where((consentRecords as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteConsentRecords(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(consentRecords).where((consentRecords as any).id === id);
    return true;
  } catch { return false; }
}

// ── paymentMetrics ──
export async function getPaymentMetrics(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(paymentMetrics).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPaymentMetrics(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(paymentMetrics).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePaymentMetrics(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(paymentMetrics).set(data).where((paymentMetrics as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePaymentMetrics(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(paymentMetrics).where((paymentMetrics as any).id === id);
    return true;
  } catch { return false; }
}

// ── mojaloopTransfers ──
export async function getMojaloopTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(mojaloopTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createMojaloopTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(mojaloopTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateMojaloopTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(mojaloopTransfers).set(data).where((mojaloopTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteMojaloopTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(mojaloopTransfers).where((mojaloopTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── posTerminals ──
export async function getPosTerminals(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(posTerminals).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPosTerminals(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(posTerminals).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePosTerminals(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(posTerminals).set(data).where((posTerminals as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePosTerminals(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(posTerminals).where((posTerminals as any).id === id);
    return true;
  } catch { return false; }
}

// ── agentAccounts ──
export async function getAgentAccounts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(agentAccounts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAgentAccounts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(agentAccounts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAgentAccounts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(agentAccounts).set(data).where((agentAccounts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAgentAccounts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(agentAccounts).where((agentAccounts as any).id === id);
    return true;
  } catch { return false; }
}

// ── kybRecords ──
export async function getKybRecords(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(kybRecords).limit(100);
    return rows;
  } catch { return []; }
}

export async function createKybRecords(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(kybRecords).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateKybRecords(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(kybRecords).set(data).where((kybRecords as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteKybRecords(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(kybRecords).where((kybRecords as any).id === id);
    return true;
  } catch { return false; }
}

// ── idempotencyKeys ──
export async function getIdempotencyKeys(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(idempotencyKeys).limit(100);
    return rows;
  } catch { return []; }
}

export async function createIdempotencyKeys(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(idempotencyKeys).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateIdempotencyKeys(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(idempotencyKeys).set(data).where((idempotencyKeys as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteIdempotencyKeys(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(idempotencyKeys).where((idempotencyKeys as any).id === id);
    return true;
  } catch { return false; }
}

// ── outboxEvents ──
export async function getOutboxEvents(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(outboxEvents).limit(100);
    return rows;
  } catch { return []; }
}

export async function createOutboxEvents(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(outboxEvents).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateOutboxEvents(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(outboxEvents).set(data).where((outboxEvents as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteOutboxEvents(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(outboxEvents).where((outboxEvents as any).id === id);
    return true;
  } catch { return false; }
}

// ── erasureRequests ──
export async function getErasureRequests(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(erasureRequests).limit(100);
    return rows;
  } catch { return []; }
}

export async function createErasureRequests(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(erasureRequests).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateErasureRequests(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(erasureRequests).set(data).where((erasureRequests as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteErasureRequests(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(erasureRequests).where((erasureRequests as any).id === id);
    return true;
  } catch { return false; }
}

// ── chatSessions ──
export async function getChatSessions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(chatSessions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createChatSessions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(chatSessions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateChatSessions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(chatSessions).set(data).where((chatSessions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteChatSessions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(chatSessions).where((chatSessions as any).id === id);
    return true;
  } catch { return false; }
}

// ── chatMessages ──
export async function getChatMessages(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(chatMessages).limit(100);
    return rows;
  } catch { return []; }
}

export async function createChatMessages(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(chatMessages).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateChatMessages(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(chatMessages).set(data).where((chatMessages as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteChatMessages(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(chatMessages).where((chatMessages as any).id === id);
    return true;
  } catch { return false; }
}

// ── impersonationTokens ──
export async function getImpersonationTokens(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(impersonationTokens).limit(100);
    return rows;
  } catch { return []; }
}

export async function createImpersonationTokens(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(impersonationTokens).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateImpersonationTokens(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(impersonationTokens).set(data).where((impersonationTokens as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteImpersonationTokens(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(impersonationTokens).where((impersonationTokens as any).id === id);
    return true;
  } catch { return false; }
}

// ── fraudAlerts ──
export async function getFraudAlerts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(fraudAlerts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFraudAlerts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(fraudAlerts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFraudAlerts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(fraudAlerts).set(data).where((fraudAlerts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFraudAlerts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(fraudAlerts).where((fraudAlerts as any).id === id);
    return true;
  } catch { return false; }
}

// ── analyticsThresholds ──
export async function getAnalyticsThresholds(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(analyticsThresholds).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAnalyticsThresholds(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(analyticsThresholds).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAnalyticsThresholds(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(analyticsThresholds).set(data).where((analyticsThresholds as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAnalyticsThresholds(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(analyticsThresholds).where((analyticsThresholds as any).id === id);
    return true;
  } catch { return false; }
}

// ── marketListings ──
export async function getMarketListings(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(marketListings).limit(100);
    return rows;
  } catch { return []; }
}

export async function createMarketListings(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(marketListings).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateMarketListings(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(marketListings).set(data).where((marketListings as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteMarketListings(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(marketListings).where((marketListings as any).id === id);
    return true;
  } catch { return false; }
}

// ── marketOrders ──
export async function getMarketOrders(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(marketOrders).limit(100);
    return rows;
  } catch { return []; }
}

export async function createMarketOrders(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(marketOrders).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateMarketOrders(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(marketOrders).set(data).where((marketOrders as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteMarketOrders(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(marketOrders).where((marketOrders as any).id === id);
    return true;
  } catch { return false; }
}

// ── talentProfiles ──
export async function getTalentProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(talentProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTalentProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(talentProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTalentProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(talentProfiles).set(data).where((talentProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTalentProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(talentProfiles).where((talentProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── talentOpportunities ──
export async function getTalentOpportunities(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(talentOpportunities).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTalentOpportunities(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(talentOpportunities).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTalentOpportunities(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(talentOpportunities).set(data).where((talentOpportunities as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTalentOpportunities(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(talentOpportunities).where((talentOpportunities as any).id === id);
    return true;
  } catch { return false; }
}

// ── talentBookings ──
export async function getTalentBookings(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(talentBookings).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTalentBookings(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(talentBookings).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTalentBookings(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(talentBookings).set(data).where((talentBookings as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTalentBookings(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(talentBookings).where((talentBookings as any).id === id);
    return true;
  } catch { return false; }
}

// ── communityFunds ──
export async function getCommunityFunds(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(communityFunds).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCommunityFunds(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(communityFunds).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCommunityFunds(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(communityFunds).set(data).where((communityFunds as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCommunityFunds(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(communityFunds).where((communityFunds as any).id === id);
    return true;
  } catch { return false; }
}

// ── fundProposals ──
export async function getFundProposals(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(fundProposals).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFundProposals(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(fundProposals).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFundProposals(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(fundProposals).set(data).where((fundProposals as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFundProposals(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(fundProposals).where((fundProposals as any).id === id);
    return true;
  } catch { return false; }
}

// ── fundVotes ──
export async function getFundVotes(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(fundVotes).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFundVotes(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(fundVotes).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFundVotes(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(fundVotes).set(data).where((fundVotes as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFundVotes(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(fundVotes).where((fundVotes as any).id === id);
    return true;
  } catch { return false; }
}

// ── diasporaCollectives ──
export async function getDiasporaCollectives(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(diasporaCollectives).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDiasporaCollectives(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(diasporaCollectives).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDiasporaCollectives(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(diasporaCollectives).set(data).where((diasporaCollectives as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDiasporaCollectives(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(diasporaCollectives).where((diasporaCollectives as any).id === id);
    return true;
  } catch { return false; }
}

// ── diasporaCollectiveMembers ──
export async function getDiasporaCollectiveMembers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(diasporaCollectiveMembers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDiasporaCollectiveMembers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(diasporaCollectiveMembers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDiasporaCollectiveMembers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(diasporaCollectiveMembers).set(data).where((diasporaCollectiveMembers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDiasporaCollectiveMembers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(diasporaCollectiveMembers).where((diasporaCollectiveMembers as any).id === id);
    return true;
  } catch { return false; }
}

// ── investmentOpportunities ──
export async function getInvestmentOpportunities(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(investmentOpportunities).limit(100);
    return rows;
  } catch { return []; }
}

export async function createInvestmentOpportunities(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(investmentOpportunities).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateInvestmentOpportunities(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(investmentOpportunities).set(data).where((investmentOpportunities as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteInvestmentOpportunities(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(investmentOpportunities).where((investmentOpportunities as any).id === id);
    return true;
  } catch { return false; }
}

// ── marketRatings ──
export async function getMarketRatings(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(marketRatings).limit(100);
    return rows;
  } catch { return []; }
}

export async function createMarketRatings(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(marketRatings).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateMarketRatings(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(marketRatings).set(data).where((marketRatings as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteMarketRatings(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(marketRatings).where((marketRatings as any).id === id);
    return true;
  } catch { return false; }
}

// ── familyMembers ──
export async function getFamilyMembers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(familyMembers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFamilyMembers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(familyMembers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFamilyMembers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(familyMembers).set(data).where((familyMembers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFamilyMembers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(familyMembers).where((familyMembers as any).id === id);
    return true;
  } catch { return false; }
}

// ── familyBudgets ──
export async function getFamilyBudgets(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(familyBudgets).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFamilyBudgets(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(familyBudgets).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFamilyBudgets(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(familyBudgets).set(data).where((familyBudgets as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFamilyBudgets(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(familyBudgets).where((familyBudgets as any).id === id);
    return true;
  } catch { return false; }
}

// ── investmentAssets ──
export async function getInvestmentAssets(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(investmentAssets).limit(100);
    return rows;
  } catch { return []; }
}

export async function createInvestmentAssets(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(investmentAssets).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateInvestmentAssets(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(investmentAssets).set(data).where((investmentAssets as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteInvestmentAssets(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(investmentAssets).where((investmentAssets as any).id === id);
    return true;
  } catch { return false; }
}

// ── userInvestments ──
export async function getUserInvestments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(userInvestments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createUserInvestments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(userInvestments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateUserInvestments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(userInvestments).set(data).where((userInvestments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteUserInvestments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(userInvestments).where((userInvestments as any).id === id);
    return true;
  } catch { return false; }
}

// ── investmentWatchlist ──
export async function getInvestmentWatchlist(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(investmentWatchlist).limit(100);
    return rows;
  } catch { return []; }
}

export async function createInvestmentWatchlist(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(investmentWatchlist).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateInvestmentWatchlist(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(investmentWatchlist).set(data).where((investmentWatchlist as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteInvestmentWatchlist(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(investmentWatchlist).where((investmentWatchlist as any).id === id);
    return true;
  } catch { return false; }
}

// ── investmentOrders ──
export async function getInvestmentOrders(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(investmentOrders).limit(100);
    return rows;
  } catch { return []; }
}

export async function createInvestmentOrders(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(investmentOrders).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateInvestmentOrders(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(investmentOrders).set(data).where((investmentOrders as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteInvestmentOrders(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(investmentOrders).where((investmentOrders as any).id === id);
    return true;
  } catch { return false; }
}

// ── investmentPriceHistory ──
export async function getInvestmentPriceHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(investmentPriceHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createInvestmentPriceHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(investmentPriceHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateInvestmentPriceHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(investmentPriceHistory).set(data).where((investmentPriceHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteInvestmentPriceHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(investmentPriceHistory).where((investmentPriceHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── tenants ──
export async function getTenants(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(tenants).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTenants(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(tenants).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTenants(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(tenants).set(data).where((tenants as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTenants(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(tenants).where((tenants as any).id === id);
    return true;
  } catch { return false; }
}

// ── tenantUsers ──
export async function getTenantUsers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(tenantUsers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTenantUsers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(tenantUsers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTenantUsers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(tenantUsers).set(data).where((tenantUsers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTenantUsers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(tenantUsers).where((tenantUsers as any).id === id);
    return true;
  } catch { return false; }
}

// ── featureFlags ──
export async function getFeatureFlags(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(featureFlags).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFeatureFlags(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(featureFlags).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFeatureFlags(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(featureFlags).set(data).where((featureFlags as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFeatureFlags(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(featureFlags).where((featureFlags as any).id === id);
    return true;
  } catch { return false; }
}

// ── tenantFeatureFlags ──
export async function getTenantFeatureFlags(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(tenantFeatureFlags).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTenantFeatureFlags(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(tenantFeatureFlags).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTenantFeatureFlags(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(tenantFeatureFlags).set(data).where((tenantFeatureFlags as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTenantFeatureFlags(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(tenantFeatureFlags).where((tenantFeatureFlags as any).id === id);
    return true;
  } catch { return false; }
}

// ── userFeatureFlags ──
export async function getUserFeatureFlags(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(userFeatureFlags).limit(100);
    return rows;
  } catch { return []; }
}

export async function createUserFeatureFlags(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(userFeatureFlags).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateUserFeatureFlags(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(userFeatureFlags).set(data).where((userFeatureFlags as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteUserFeatureFlags(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(userFeatureFlags).where((userFeatureFlags as any).id === id);
    return true;
  } catch { return false; }
}

// ── whiteLabelConfigs ──
export async function getWhiteLabelConfigs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(whiteLabelConfigs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createWhiteLabelConfigs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(whiteLabelConfigs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateWhiteLabelConfigs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(whiteLabelConfigs).set(data).where((whiteLabelConfigs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteWhiteLabelConfigs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(whiteLabelConfigs).where((whiteLabelConfigs as any).id === id);
    return true;
  } catch { return false; }
}

// ── travelRuleRecords ──
export async function getTravelRuleRecords(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(travelRuleRecords).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTravelRuleRecords(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(travelRuleRecords).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTravelRuleRecords(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(travelRuleRecords).set(data).where((travelRuleRecords as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTravelRuleRecords(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(travelRuleRecords).where((travelRuleRecords as any).id === id);
    return true;
  } catch { return false; }
}

// ── partnerInviteCodes ──
export async function getPartnerInviteCodes(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(partnerInviteCodes).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPartnerInviteCodes(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(partnerInviteCodes).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePartnerInviteCodes(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(partnerInviteCodes).set(data).where((partnerInviteCodes as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePartnerInviteCodes(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(partnerInviteCodes).where((partnerInviteCodes as any).id === id);
    return true;
  } catch { return false; }
}

// ── tenantOnboardingSessions ──
export async function getTenantOnboardingSessions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(tenantOnboardingSessions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTenantOnboardingSessions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(tenantOnboardingSessions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTenantOnboardingSessions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(tenantOnboardingSessions).set(data).where((tenantOnboardingSessions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTenantOnboardingSessions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(tenantOnboardingSessions).where((tenantOnboardingSessions as any).id === id);
    return true;
  } catch { return false; }
}

// ── partnerPayouts ──
export async function getPartnerPayouts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(partnerPayouts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPartnerPayouts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(partnerPayouts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePartnerPayouts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(partnerPayouts).set(data).where((partnerPayouts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePartnerPayouts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(partnerPayouts).where((partnerPayouts as any).id === id);
    return true;
  } catch { return false; }
}

// ── webhookEndpoints ──
export async function getWebhookEndpoints(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(webhookEndpoints).limit(100);
    return rows;
  } catch { return []; }
}

export async function createWebhookEndpoints(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(webhookEndpoints).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateWebhookEndpoints(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(webhookEndpoints).set(data).where((webhookEndpoints as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteWebhookEndpoints(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(webhookEndpoints).where((webhookEndpoints as any).id === id);
    return true;
  } catch { return false; }
}

// ── webhookDeliveries ──
export async function getWebhookDeliveries(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(webhookDeliveries).limit(100);
    return rows;
  } catch { return []; }
}

export async function createWebhookDeliveries(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(webhookDeliveries).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateWebhookDeliveries(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(webhookDeliveries).set(data).where((webhookDeliveries as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteWebhookDeliveries(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(webhookDeliveries).where((webhookDeliveries as any).id === id);
    return true;
  } catch { return false; }
}

// ── apiKeys ──
export async function getApiKeys(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(apiKeys).limit(100);
    return rows;
  } catch { return []; }
}

export async function createApiKeys(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(apiKeys).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateApiKeys(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(apiKeys).set(data).where((apiKeys as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteApiKeys(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(apiKeys).where((apiKeys as any).id === id);
    return true;
  } catch { return false; }
}

// ── paymentGatewayLogs ──
export async function getPaymentGatewayLogs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(paymentGatewayLogs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPaymentGatewayLogs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(paymentGatewayLogs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePaymentGatewayLogs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(paymentGatewayLogs).set(data).where((paymentGatewayLogs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePaymentGatewayLogs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(paymentGatewayLogs).where((paymentGatewayLogs as any).id === id);
    return true;
  } catch { return false; }
}

// ── complianceWatchlist ──
export async function getComplianceWatchlist(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(complianceWatchlist).limit(100);
    return rows;
  } catch { return []; }
}

export async function createComplianceWatchlist(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(complianceWatchlist).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateComplianceWatchlist(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(complianceWatchlist).set(data).where((complianceWatchlist as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteComplianceWatchlist(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(complianceWatchlist).where((complianceWatchlist as any).id === id);
    return true;
  } catch { return false; }
}

// ── fxRateHistory ──
export async function getFxRateHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(fxRateHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFxRateHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(fxRateHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFxRateHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(fxRateHistory).set(data).where((fxRateHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFxRateHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(fxRateHistory).where((fxRateHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── systemConfig ──
export async function getSystemConfig(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(systemConfig).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSystemConfig(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(systemConfig).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSystemConfig(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(systemConfig).set(data).where((systemConfig as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSystemConfig(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(systemConfig).where((systemConfig as any).id === id);
    return true;
  } catch { return false; }
}

// ── ngxStocks ──
export async function getNgxStocks(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(ngxStocks).limit(100);
    return rows;
  } catch { return []; }
}

export async function createNgxStocks(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(ngxStocks).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateNgxStocks(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(ngxStocks).set(data).where((ngxStocks as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteNgxStocks(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(ngxStocks).where((ngxStocks as any).id === id);
    return true;
  } catch { return false; }
}

// ── stockWatchlists ──
export async function getStockWatchlists(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(stockWatchlists).limit(100);
    return rows;
  } catch { return []; }
}

export async function createStockWatchlists(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(stockWatchlists).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateStockWatchlists(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(stockWatchlists).set(data).where((stockWatchlists as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteStockWatchlists(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(stockWatchlists).where((stockWatchlists as any).id === id);
    return true;
  } catch { return false; }
}

// ── ngxOrders ──
export async function getNgxOrders(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(ngxOrders).limit(100);
    return rows;
  } catch { return []; }
}

export async function createNgxOrders(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(ngxOrders).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateNgxOrders(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(ngxOrders).set(data).where((ngxOrders as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteNgxOrders(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(ngxOrders).where((ngxOrders as any).id === id);
    return true;
  } catch { return false; }
}

// ── realEstateListings ──
export async function getRealEstateListings(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(realEstateListings).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRealEstateListings(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(realEstateListings).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRealEstateListings(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(realEstateListings).set(data).where((realEstateListings as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRealEstateListings(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(realEstateListings).where((realEstateListings as any).id === id);
    return true;
  } catch { return false; }
}

// ── realEstateInvestments ──
export async function getRealEstateInvestments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(realEstateInvestments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRealEstateInvestments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(realEstateInvestments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRealEstateInvestments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(realEstateInvestments).set(data).where((realEstateInvestments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRealEstateInvestments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(realEstateInvestments).where((realEstateInvestments as any).id === id);
    return true;
  } catch { return false; }
}

// ── startupDeals ──
export async function getStartupDeals(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(startupDeals).limit(100);
    return rows;
  } catch { return []; }
}

export async function createStartupDeals(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(startupDeals).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateStartupDeals(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(startupDeals).set(data).where((startupDeals as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteStartupDeals(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(startupDeals).where((startupDeals as any).id === id);
    return true;
  } catch { return false; }
}

// ── startupInvestments ──
export async function getStartupInvestments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(startupInvestments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createStartupInvestments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(startupInvestments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateStartupInvestments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(startupInvestments).set(data).where((startupInvestments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteStartupInvestments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(startupInvestments).where((startupInvestments as any).id === id);
    return true;
  } catch { return false; }
}

// ── paypalTransactions ──
export async function getPaypalTransactions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(paypalTransactions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPaypalTransactions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(paypalTransactions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePaypalTransactions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(paypalTransactions).set(data).where((paypalTransactions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePaypalTransactions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(paypalTransactions).where((paypalTransactions as any).id === id);
    return true;
  } catch { return false; }
}

// ── flutterwaveTransactions ──
export async function getFlutterwaveTransactions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(flutterwaveTransactions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFlutterwaveTransactions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(flutterwaveTransactions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFlutterwaveTransactions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(flutterwaveTransactions).set(data).where((flutterwaveTransactions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFlutterwaveTransactions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(flutterwaveTransactions).where((flutterwaveTransactions as any).id === id);
    return true;
  } catch { return false; }
}

// ── corridorMarginHistory ──
export async function getCorridorMarginHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(corridorMarginHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCorridorMarginHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(corridorMarginHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCorridorMarginHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(corridorMarginHistory).set(data).where((corridorMarginHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCorridorMarginHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(corridorMarginHistory).where((corridorMarginHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── pushSubscriptions ──
export async function getPushSubscriptions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(pushSubscriptions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPushSubscriptions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(pushSubscriptions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePushSubscriptions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(pushSubscriptions).set(data).where((pushSubscriptions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePushSubscriptions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(pushSubscriptions).where((pushSubscriptions as any).id === id);
    return true;
  } catch { return false; }
}

// ── apiKeyUsageLogs ──
export async function getApiKeyUsageLogs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(apiKeyUsageLogs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createApiKeyUsageLogs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(apiKeyUsageLogs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateApiKeyUsageLogs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(apiKeyUsageLogs).set(data).where((apiKeyUsageLogs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteApiKeyUsageLogs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(apiKeyUsageLogs).where((apiKeyUsageLogs as any).id === id);
    return true;
  } catch { return false; }
}

// ── stripeReceipts ──
export async function getStripeReceipts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(stripeReceipts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createStripeReceipts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(stripeReceipts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateStripeReceipts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(stripeReceipts).set(data).where((stripeReceipts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteStripeReceipts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(stripeReceipts).where((stripeReceipts as any).id === id);
    return true;
  } catch { return false; }
}

// ── fxAlertTriggerHistory ──
export async function getFxAlertTriggerHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(fxAlertTriggerHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFxAlertTriggerHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(fxAlertTriggerHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFxAlertTriggerHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(fxAlertTriggerHistory).set(data).where((fxAlertTriggerHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFxAlertTriggerHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(fxAlertTriggerHistory).where((fxAlertTriggerHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── treasuryPositions ──
export async function getTreasuryPositions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(treasuryPositions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTreasuryPositions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(treasuryPositions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTreasuryPositions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(treasuryPositions).set(data).where((treasuryPositions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTreasuryPositions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(treasuryPositions).where((treasuryPositions as any).id === id);
    return true;
  } catch { return false; }
}

// ── slaIncidents ──
export async function getSlaIncidents(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(slaIncidents).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSlaIncidents(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(slaIncidents).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSlaIncidents(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(slaIncidents).set(data).where((slaIncidents as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSlaIncidents(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(slaIncidents).where((slaIncidents as any).id === id);
    return true;
  } catch { return false; }
}

// ── chargebackCases ──
export async function getChargebackCases(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(chargebackCases).limit(100);
    return rows;
  } catch { return []; }
}

export async function createChargebackCases(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(chargebackCases).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateChargebackCases(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(chargebackCases).set(data).where((chargebackCases as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteChargebackCases(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(chargebackCases).where((chargebackCases as any).id === id);
    return true;
  } catch { return false; }
}

// ── smartRoutingDecisions ──
export async function getSmartRoutingDecisions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(smartRoutingDecisions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSmartRoutingDecisions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(smartRoutingDecisions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSmartRoutingDecisions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(smartRoutingDecisions).set(data).where((smartRoutingDecisions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSmartRoutingDecisions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(smartRoutingDecisions).where((smartRoutingDecisions as any).id === id);
    return true;
  } catch { return false; }
}

// ── complianceReports ──
export async function getComplianceReports(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(complianceReports).limit(100);
    return rows;
  } catch { return []; }
}

export async function createComplianceReports(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(complianceReports).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateComplianceReports(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(complianceReports).set(data).where((complianceReports as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteComplianceReports(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(complianceReports).where((complianceReports as any).id === id);
    return true;
  } catch { return false; }
}

// ── developerSandboxSessions ──
export async function getDeveloperSandboxSessions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(developerSandboxSessions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDeveloperSandboxSessions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(developerSandboxSessions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDeveloperSandboxSessions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(developerSandboxSessions).set(data).where((developerSandboxSessions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDeveloperSandboxSessions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(developerSandboxSessions).where((developerSandboxSessions as any).id === id);
    return true;
  } catch { return false; }
}

// ── sandboxScenarios ──
export async function getSandboxScenarios(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(sandboxScenarios).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSandboxScenarios(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(sandboxScenarios).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSandboxScenarios(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(sandboxScenarios).set(data).where((sandboxScenarios as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSandboxScenarios(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(sandboxScenarios).where((sandboxScenarios as any).id === id);
    return true;
  } catch { return false; }
}

// ── complianceAlerts ──
export async function getComplianceAlerts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(complianceAlerts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createComplianceAlerts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(complianceAlerts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateComplianceAlerts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(complianceAlerts).set(data).where((complianceAlerts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteComplianceAlerts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(complianceAlerts).where((complianceAlerts as any).id === id);
    return true;
  } catch { return false; }
}

// ── securityEvents ──
export async function getSecurityEvents(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(securityEvents).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSecurityEvents(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(securityEvents).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSecurityEvents(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(securityEvents).set(data).where((securityEvents as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSecurityEvents(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(securityEvents).where((securityEvents as any).id === id);
    return true;
  } catch { return false; }
}

// ── mfaSettings ──
export async function getMfaSettings(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(mfaSettings).limit(100);
    return rows;
  } catch { return []; }
}

export async function createMfaSettings(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(mfaSettings).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateMfaSettings(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(mfaSettings).set(data).where((mfaSettings as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteMfaSettings(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(mfaSettings).where((mfaSettings as any).id === id);
    return true;
  } catch { return false; }
}

// ── transferAuditTrail ──
export async function getTransferAuditTrail(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(transferAuditTrail).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTransferAuditTrail(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(transferAuditTrail).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTransferAuditTrail(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(transferAuditTrail).set(data).where((transferAuditTrail as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTransferAuditTrail(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(transferAuditTrail).where((transferAuditTrail as any).id === id);
    return true;
  } catch { return false; }
}

// ── feeRules ──
export async function getFeeRules(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(feeRules).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFeeRules(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(feeRules).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFeeRules(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(feeRules).set(data).where((feeRules as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFeeRules(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(feeRules).where((feeRules as any).id === id);
    return true;
  } catch { return false; }
}

// ── promoCodes ──
export async function getPromoCodes(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(promoCodes).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPromoCodes(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(promoCodes).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePromoCodes(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(promoCodes).set(data).where((promoCodes as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePromoCodes(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(promoCodes).where((promoCodes as any).id === id);
    return true;
  } catch { return false; }
}

// ── promoRedemptions ──
export async function getPromoRedemptions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(promoRedemptions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPromoRedemptions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(promoRedemptions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePromoRedemptions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(promoRedemptions).set(data).where((promoRedemptions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePromoRedemptions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(promoRedemptions).where((promoRedemptions as any).id === id);
    return true;
  } catch { return false; }
}

// ── dailyVolumeSnapshots ──
export async function getDailyVolumeSnapshots(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(dailyVolumeSnapshots).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDailyVolumeSnapshots(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(dailyVolumeSnapshots).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDailyVolumeSnapshots(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(dailyVolumeSnapshots).set(data).where((dailyVolumeSnapshots as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDailyVolumeSnapshots(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(dailyVolumeSnapshots).where((dailyVolumeSnapshots as any).id === id);
    return true;
  } catch { return false; }
}

// ── userNotifPrefs ──
export async function getUserNotifPrefs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(userNotifPrefs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createUserNotifPrefs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(userNotifPrefs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateUserNotifPrefs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(userNotifPrefs).set(data).where((userNotifPrefs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteUserNotifPrefs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(userNotifPrefs).where((userNotifPrefs as any).id === id);
    return true;
  } catch { return false; }
}

// ── scheduledTransfers ──
export async function getScheduledTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(scheduledTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createScheduledTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(scheduledTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateScheduledTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(scheduledTransfers).set(data).where((scheduledTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteScheduledTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(scheduledTransfers).where((scheduledTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── exchangeRateAlerts ──
export async function getExchangeRateAlerts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(exchangeRateAlerts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createExchangeRateAlerts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(exchangeRateAlerts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateExchangeRateAlerts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(exchangeRateAlerts).set(data).where((exchangeRateAlerts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteExchangeRateAlerts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(exchangeRateAlerts).where((exchangeRateAlerts as any).id === id);
    return true;
  } catch { return false; }
}

// ── nifiPipelineRuns ──
export async function getNifiPipelineRuns(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(nifiPipelineRuns).limit(100);
    return rows;
  } catch { return []; }
}

export async function createNifiPipelineRuns(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(nifiPipelineRuns).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateNifiPipelineRuns(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(nifiPipelineRuns).set(data).where((nifiPipelineRuns as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteNifiPipelineRuns(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(nifiPipelineRuns).where((nifiPipelineRuns as any).id === id);
    return true;
  } catch { return false; }
}

// ── dbtRunHistory ──
export async function getDbtRunHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(dbtRunHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDbtRunHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(dbtRunHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDbtRunHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(dbtRunHistory).set(data).where((dbtRunHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDbtRunHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(dbtRunHistory).where((dbtRunHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── airflowDagRuns ──
export async function getAirflowDagRuns(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(airflowDagRuns).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAirflowDagRuns(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(airflowDagRuns).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAirflowDagRuns(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(airflowDagRuns).set(data).where((airflowDagRuns as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAirflowDagRuns(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(airflowDagRuns).where((airflowDagRuns as any).id === id);
    return true;
  } catch { return false; }
}

// ── tenantConfigs ──
export async function getTenantConfigs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(tenantConfigs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTenantConfigs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(tenantConfigs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTenantConfigs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(tenantConfigs).set(data).where((tenantConfigs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTenantConfigs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(tenantConfigs).where((tenantConfigs as any).id === id);
    return true;
  } catch { return false; }
}

// ── sanctionsChecks ──
export async function getSanctionsChecks(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(sanctionsChecks).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSanctionsChecks(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(sanctionsChecks).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSanctionsChecks(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(sanctionsChecks).set(data).where((sanctionsChecks as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSanctionsChecks(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(sanctionsChecks).where((sanctionsChecks as any).id === id);
    return true;
  } catch { return false; }
}

// ── bulkPaymentBatches ──
export async function getBulkPaymentBatches(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(bulkPaymentBatches).limit(100);
    return rows;
  } catch { return []; }
}

export async function createBulkPaymentBatches(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(bulkPaymentBatches).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateBulkPaymentBatches(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(bulkPaymentBatches).set(data).where((bulkPaymentBatches as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteBulkPaymentBatches(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(bulkPaymentBatches).where((bulkPaymentBatches as any).id === id);
    return true;
  } catch { return false; }
}

// ── openBankingConsents ──
export async function getOpenBankingConsents(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(openBankingConsents).limit(100);
    return rows;
  } catch { return []; }
}

export async function createOpenBankingConsents(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(openBankingConsents).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateOpenBankingConsents(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(openBankingConsents).set(data).where((openBankingConsents as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteOpenBankingConsents(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(openBankingConsents).where((openBankingConsents as any).id === id);
    return true;
  } catch { return false; }
}

// ── regulatoryReports ──
export async function getRegulatoryReports(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(regulatoryReports).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRegulatoryReports(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(regulatoryReports).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRegulatoryReports(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(regulatoryReports).set(data).where((regulatoryReports as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRegulatoryReports(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(regulatoryReports).where((regulatoryReports as any).id === id);
    return true;
  } catch { return false; }
}

// ── fraudModelRuns ──
export async function getFraudModelRuns(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(fraudModelRuns).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFraudModelRuns(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(fraudModelRuns).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFraudModelRuns(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(fraudModelRuns).set(data).where((fraudModelRuns as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFraudModelRuns(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(fraudModelRuns).where((fraudModelRuns as any).id === id);
    return true;
  } catch { return false; }
}

// ── partnerApplications ──
export async function getPartnerApplications(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(partnerApplications).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPartnerApplications(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(partnerApplications).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePartnerApplications(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(partnerApplications).set(data).where((partnerApplications as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePartnerApplications(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(partnerApplications).where((partnerApplications as any).id === id);
    return true;
  } catch { return false; }
}

// ── partnerApplicationComments ──
export async function getPartnerApplicationComments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(partnerApplicationComments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPartnerApplicationComments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(partnerApplicationComments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePartnerApplicationComments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(partnerApplicationComments).set(data).where((partnerApplicationComments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePartnerApplicationComments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(partnerApplicationComments).where((partnerApplicationComments as any).id === id);
    return true;
  } catch { return false; }
}

// ── partnerApiKeys ──
export async function getPartnerApiKeys(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(partnerApiKeys).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPartnerApiKeys(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(partnerApiKeys).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePartnerApiKeys(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(partnerApiKeys).set(data).where((partnerApiKeys as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePartnerApiKeys(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(partnerApiKeys).where((partnerApiKeys as any).id === id);
    return true;
  } catch { return false; }
}

// ── partnerWebhooks ──
export async function getPartnerWebhooks(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(partnerWebhooks).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPartnerWebhooks(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(partnerWebhooks).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePartnerWebhooks(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(partnerWebhooks).set(data).where((partnerWebhooks as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePartnerWebhooks(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(partnerWebhooks).where((partnerWebhooks as any).id === id);
    return true;
  } catch { return false; }
}

// ── userOnboardingProgress ──
export async function getUserOnboardingProgress(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(userOnboardingProgress).limit(100);
    return rows;
  } catch { return []; }
}

export async function createUserOnboardingProgress(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(userOnboardingProgress).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateUserOnboardingProgress(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(userOnboardingProgress).set(data).where((userOnboardingProgress as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteUserOnboardingProgress(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(userOnboardingProgress).where((userOnboardingProgress as any).id === id);
    return true;
  } catch { return false; }
}

// ── complianceEmailConfig ──
export async function getComplianceEmailConfig(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(complianceEmailConfig).limit(100);
    return rows;
  } catch { return []; }
}

export async function createComplianceEmailConfig(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(complianceEmailConfig).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateComplianceEmailConfig(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(complianceEmailConfig).set(data).where((complianceEmailConfig as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteComplianceEmailConfig(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(complianceEmailConfig).where((complianceEmailConfig as any).id === id);
    return true;
  } catch { return false; }
}

// ── abExperiments ──
export async function getAbExperiments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(abExperiments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAbExperiments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(abExperiments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAbExperiments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(abExperiments).set(data).where((abExperiments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAbExperiments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(abExperiments).where((abExperiments as any).id === id);
    return true;
  } catch { return false; }
}

// ── abAssignments ──
export async function getAbAssignments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(abAssignments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAbAssignments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(abAssignments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAbAssignments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(abAssignments).set(data).where((abAssignments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAbAssignments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(abAssignments).where((abAssignments as any).id === id);
    return true;
  } catch { return false; }
}

// ── abEvents ──
export async function getAbEvents(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(abEvents).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAbEvents(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(abEvents).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAbEvents(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(abEvents).set(data).where((abEvents as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAbEvents(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(abEvents).where((abEvents as any).id === id);
    return true;
  } catch { return false; }
}

// ── referralBonuses ──
export async function getReferralBonuses(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(referralBonuses).limit(100);
    return rows;
  } catch { return []; }
}

export async function createReferralBonuses(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(referralBonuses).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateReferralBonuses(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(referralBonuses).set(data).where((referralBonuses as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteReferralBonuses(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(referralBonuses).where((referralBonuses as any).id === id);
    return true;
  } catch { return false; }
}

// ── documentVaultTable ──
export async function getDocumentVaultTable(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(documentVaultTable).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDocumentVaultTable(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(documentVaultTable).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDocumentVaultTable(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(documentVaultTable).set(data).where((documentVaultTable as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDocumentVaultTable(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(documentVaultTable).where((documentVaultTable as any).id === id);
    return true;
  } catch { return false; }
}

// ── rateAlertHistory ──
export async function getRateAlertHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(rateAlertHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRateAlertHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(rateAlertHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRateAlertHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(rateAlertHistory).set(data).where((rateAlertHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRateAlertHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(rateAlertHistory).where((rateAlertHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── docReminderPrefs ──
export async function getDocReminderPrefs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(docReminderPrefs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDocReminderPrefs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(docReminderPrefs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDocReminderPrefs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(docReminderPrefs).set(data).where((docReminderPrefs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDocReminderPrefs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(docReminderPrefs).where((docReminderPrefs as any).id === id);
    return true;
  } catch { return false; }
}

// ── docReminderLog ──
export async function getDocReminderLog(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(docReminderLog).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDocReminderLog(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(docReminderLog).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDocReminderLog(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(docReminderLog).set(data).where((docReminderLog as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDocReminderLog(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(docReminderLog).where((docReminderLog as any).id === id);
    return true;
  } catch { return false; }
}

// ── velocityRules ──
export async function getVelocityRules(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(velocityRules).limit(100);
    return rows;
  } catch { return []; }
}

export async function createVelocityRules(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(velocityRules).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateVelocityRules(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(velocityRules).set(data).where((velocityRules as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteVelocityRules(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(velocityRules).where((velocityRules as any).id === id);
    return true;
  } catch { return false; }
}

// ── velocityOverrides ──
export async function getVelocityOverrides(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(velocityOverrides).limit(100);
    return rows;
  } catch { return []; }
}

export async function createVelocityOverrides(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(velocityOverrides).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateVelocityOverrides(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(velocityOverrides).set(data).where((velocityOverrides as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteVelocityOverrides(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(velocityOverrides).where((velocityOverrides as any).id === id);
    return true;
  } catch { return false; }
}

// ── velocityWhitelist ──
export async function getVelocityWhitelist(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(velocityWhitelist).limit(100);
    return rows;
  } catch { return []; }
}

export async function createVelocityWhitelist(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(velocityWhitelist).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateVelocityWhitelist(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(velocityWhitelist).set(data).where((velocityWhitelist as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteVelocityWhitelist(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(velocityWhitelist).where((velocityWhitelist as any).id === id);
    return true;
  } catch { return false; }
}

// ── kycLifecycle ──
export async function getKycLifecycle(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(kycLifecycle).limit(100);
    return rows;
  } catch { return []; }
}

export async function createKycLifecycle(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(kycLifecycle).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateKycLifecycle(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(kycLifecycle).set(data).where((kycLifecycle as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteKycLifecycle(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(kycLifecycle).where((kycLifecycle as any).id === id);
    return true;
  } catch { return false; }
}

// ── kycLifecycleHistory ──
export async function getKycLifecycleHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(kycLifecycleHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createKycLifecycleHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(kycLifecycleHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateKycLifecycleHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(kycLifecycleHistory).set(data).where((kycLifecycleHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteKycLifecycleHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(kycLifecycleHistory).where((kycLifecycleHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── documentRenewals ──
export async function getDocumentRenewals(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(documentRenewals).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDocumentRenewals(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(documentRenewals).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDocumentRenewals(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(documentRenewals).set(data).where((documentRenewals as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDocumentRenewals(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(documentRenewals).where((documentRenewals as any).id === id);
    return true;
  } catch { return false; }
}

// ── webhookRetryQueue ──
export async function getWebhookRetryQueue(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(webhookRetryQueue).limit(100);
    return rows;
  } catch { return []; }
}

export async function createWebhookRetryQueue(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(webhookRetryQueue).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateWebhookRetryQueue(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(webhookRetryQueue).set(data).where((webhookRetryQueue as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteWebhookRetryQueue(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(webhookRetryQueue).where((webhookRetryQueue as any).id === id);
    return true;
  } catch { return false; }
}

// ── apiKeyRotationLog ──
export async function getApiKeyRotationLog(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(apiKeyRotationLog).limit(100);
    return rows;
  } catch { return []; }
}

export async function createApiKeyRotationLog(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(apiKeyRotationLog).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateApiKeyRotationLog(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(apiKeyRotationLog).set(data).where((apiKeyRotationLog as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteApiKeyRotationLog(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(apiKeyRotationLog).where((apiKeyRotationLog as any).id === id);
    return true;
  } catch { return false; }
}

// ── batchPaymentItems ──
export async function getBatchPaymentItems(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(batchPaymentItems).limit(100);
    return rows;
  } catch { return []; }
}

export async function createBatchPaymentItems(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(batchPaymentItems).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateBatchPaymentItems(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(batchPaymentItems).set(data).where((batchPaymentItems as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteBatchPaymentItems(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(batchPaymentItems).where((batchPaymentItems as any).id === id);
    return true;
  } catch { return false; }
}

// ── systemConfigAuditLog ──
export async function getSystemConfigAuditLog(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(systemConfigAuditLog).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSystemConfigAuditLog(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(systemConfigAuditLog).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSystemConfigAuditLog(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(systemConfigAuditLog).set(data).where((systemConfigAuditLog as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSystemConfigAuditLog(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(systemConfigAuditLog).where((systemConfigAuditLog as any).id === id);
    return true;
  } catch { return false; }
}

// ── kafkaConsumerMetrics ──
export async function getKafkaConsumerMetrics(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(kafkaConsumerMetrics).limit(100);
    return rows;
  } catch { return []; }
}

export async function createKafkaConsumerMetrics(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(kafkaConsumerMetrics).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateKafkaConsumerMetrics(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(kafkaConsumerMetrics).set(data).where((kafkaConsumerMetrics as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteKafkaConsumerMetrics(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(kafkaConsumerMetrics).where((kafkaConsumerMetrics as any).id === id);
    return true;
  } catch { return false; }
}

// ── transactionExports ──
export async function getTransactionExports(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(transactionExports).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTransactionExports(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(transactionExports).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTransactionExports(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(transactionExports).set(data).where((transactionExports as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTransactionExports(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(transactionExports).where((transactionExports as any).id === id);
    return true;
  } catch { return false; }
}

// ── ipLoginHistory ──
export async function getIpLoginHistory(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(ipLoginHistory).limit(100);
    return rows;
  } catch { return []; }
}

export async function createIpLoginHistory(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(ipLoginHistory).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateIpLoginHistory(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(ipLoginHistory).set(data).where((ipLoginHistory as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteIpLoginHistory(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(ipLoginHistory).where((ipLoginHistory as any).id === id);
    return true;
  } catch { return false; }
}

// ── cbdcMintBurnLog ──
export async function getCbdcMintBurnLog(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(cbdcMintBurnLog).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCbdcMintBurnLog(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(cbdcMintBurnLog).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCbdcMintBurnLog(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(cbdcMintBurnLog).set(data).where((cbdcMintBurnLog as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCbdcMintBurnLog(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(cbdcMintBurnLog).where((cbdcMintBurnLog as any).id === id);
    return true;
  } catch { return false; }
}

// ── communityActivityFeed ──
export async function getCommunityActivityFeed(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(communityActivityFeed).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCommunityActivityFeed(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(communityActivityFeed).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCommunityActivityFeed(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(communityActivityFeed).set(data).where((communityActivityFeed as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCommunityActivityFeed(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(communityActivityFeed).where((communityActivityFeed as any).id === id);
    return true;
  } catch { return false; }
}

// ── ctrAutoFlags ──
export async function getCtrAutoFlags(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(ctrAutoFlags).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCtrAutoFlags(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(ctrAutoFlags).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCtrAutoFlags(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(ctrAutoFlags).set(data).where((ctrAutoFlags as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCtrAutoFlags(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(ctrAutoFlags).where((ctrAutoFlags as any).id === id);
    return true;
  } catch { return false; }
}

// ── mojaloopFsps ──
export async function getMojaloopFsps(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(mojaloopFsps).limit(100);
    return rows;
  } catch { return []; }
}

export async function createMojaloopFsps(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(mojaloopFsps).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateMojaloopFsps(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(mojaloopFsps).set(data).where((mojaloopFsps as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteMojaloopFsps(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(mojaloopFsps).where((mojaloopFsps as any).id === id);
    return true;
  } catch { return false; }
}

// ── bulkUserActionLog ──
export async function getBulkUserActionLog(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(bulkUserActionLog).limit(100);
    return rows;
  } catch { return []; }
}

export async function createBulkUserActionLog(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(bulkUserActionLog).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateBulkUserActionLog(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(bulkUserActionLog).set(data).where((bulkUserActionLog as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteBulkUserActionLog(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(bulkUserActionLog).where((bulkUserActionLog as any).id === id);
    return true;
  } catch { return false; }
}

// ── stripeWebhookRetryLog ──
export async function getStripeWebhookRetryLog(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(stripeWebhookRetryLog).limit(100);
    return rows;
  } catch { return []; }
}

export async function createStripeWebhookRetryLog(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(stripeWebhookRetryLog).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateStripeWebhookRetryLog(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(stripeWebhookRetryLog).set(data).where((stripeWebhookRetryLog as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteStripeWebhookRetryLog(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(stripeWebhookRetryLog).where((stripeWebhookRetryLog as any).id === id);
    return true;
  } catch { return false; }
}

// ── revenueShareAgreements ──
export async function getRevenueShareAgreements(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(revenueShareAgreements).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRevenueShareAgreements(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(revenueShareAgreements).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRevenueShareAgreements(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(revenueShareAgreements).set(data).where((revenueShareAgreements as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRevenueShareAgreements(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(revenueShareAgreements).where((revenueShareAgreements as any).id === id);
    return true;
  } catch { return false; }
}

// ── revenueShareTiers ──
export async function getRevenueShareTiers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(revenueShareTiers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRevenueShareTiers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(revenueShareTiers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRevenueShareTiers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(revenueShareTiers).set(data).where((revenueShareTiers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRevenueShareTiers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(revenueShareTiers).where((revenueShareTiers as any).id === id);
    return true;
  } catch { return false; }
}

// ── revenueShareLedger ──
export async function getRevenueShareLedger(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(revenueShareLedger).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRevenueShareLedger(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(revenueShareLedger).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRevenueShareLedger(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(revenueShareLedger).set(data).where((revenueShareLedger as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRevenueShareLedger(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(revenueShareLedger).where((revenueShareLedger as any).id === id);
    return true;
  } catch { return false; }
}

// ── revenueShareReports ──
export async function getRevenueShareReports(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(revenueShareReports).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRevenueShareReports(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(revenueShareReports).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRevenueShareReports(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(revenueShareReports).set(data).where((revenueShareReports as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRevenueShareReports(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(revenueShareReports).where((revenueShareReports as any).id === id);
    return true;
  } catch { return false; }
}

// ── chatSessionMeta ──
export async function getChatSessionMeta(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(chatSessionMeta).limit(100);
    return rows;
  } catch { return []; }
}

export async function createChatSessionMeta(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(chatSessionMeta).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateChatSessionMeta(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(chatSessionMeta).set(data).where((chatSessionMeta as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteChatSessionMeta(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(chatSessionMeta).where((chatSessionMeta as any).id === id);
    return true;
  } catch { return false; }
}

// ── chatAgentStatus ──
export async function getChatAgentStatus(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(chatAgentStatus).limit(100);
    return rows;
  } catch { return []; }
}

export async function createChatAgentStatus(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(chatAgentStatus).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateChatAgentStatus(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(chatAgentStatus).set(data).where((chatAgentStatus as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteChatAgentStatus(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(chatAgentStatus).where((chatAgentStatus as any).id === id);
    return true;
  } catch { return false; }
}

// ── chatCannedResponses ──
export async function getChatCannedResponses(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(chatCannedResponses).limit(100);
    return rows;
  } catch { return []; }
}

export async function createChatCannedResponses(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(chatCannedResponses).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateChatCannedResponses(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(chatCannedResponses).set(data).where((chatCannedResponses as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteChatCannedResponses(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(chatCannedResponses).where((chatCannedResponses as any).id === id);
    return true;
  } catch { return false; }
}

// ── agreementTemplates ──
export async function getAgreementTemplates(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(agreementTemplates).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAgreementTemplates(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(agreementTemplates).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAgreementTemplates(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(agreementTemplates).set(data).where((agreementTemplates as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAgreementTemplates(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(agreementTemplates).where((agreementTemplates as any).id === id);
    return true;
  } catch { return false; }
}

// ── partnerDigitalAgreements ──
export async function getPartnerDigitalAgreements(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(partnerDigitalAgreements).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPartnerDigitalAgreements(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(partnerDigitalAgreements).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePartnerDigitalAgreements(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(partnerDigitalAgreements).set(data).where((partnerDigitalAgreements as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePartnerDigitalAgreements(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(partnerDigitalAgreements).where((partnerDigitalAgreements as any).id === id);
    return true;
  } catch { return false; }
}

// ── agreementSignatures ──
export async function getAgreementSignatures(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(agreementSignatures).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAgreementSignatures(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(agreementSignatures).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAgreementSignatures(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(agreementSignatures).set(data).where((agreementSignatures as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAgreementSignatures(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(agreementSignatures).where((agreementSignatures as any).id === id);
    return true;
  } catch { return false; }
}

// ── cronJobs ──
export async function getCronJobs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(cronJobs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCronJobs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(cronJobs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCronJobs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(cronJobs).set(data).where((cronJobs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCronJobs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(cronJobs).where((cronJobs as any).id === id);
    return true;
  } catch { return false; }
}

// ── apiChangelogs ──
export async function getApiChangelogs(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(apiChangelogs).limit(100);
    return rows;
  } catch { return []; }
}

export async function createApiChangelogs(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(apiChangelogs).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateApiChangelogs(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(apiChangelogs).set(data).where((apiChangelogs as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteApiChangelogs(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(apiChangelogs).where((apiChangelogs as any).id === id);
    return true;
  } catch { return false; }
}

// ── securityIncidents ──
export async function getSecurityIncidents(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(securityIncidents).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSecurityIncidents(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(securityIncidents).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSecurityIncidents(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(securityIncidents).set(data).where((securityIncidents as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSecurityIncidents(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(securityIncidents).where((securityIncidents as any).id === id);
    return true;
  } catch { return false; }
}

// ── paymentRequests ──
export async function getPaymentRequests(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(paymentRequests).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPaymentRequests(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(paymentRequests).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePaymentRequests(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(paymentRequests).set(data).where((paymentRequests as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePaymentRequests(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(paymentRequests).where((paymentRequests as any).id === id);
    return true;
  } catch { return false; }
}

// ── pushNotificationPreferences ──
export async function getPushNotificationPreferences(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(pushNotificationPreferences).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPushNotificationPreferences(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(pushNotificationPreferences).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePushNotificationPreferences(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(pushNotificationPreferences).set(data).where((pushNotificationPreferences as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePushNotificationPreferences(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(pushNotificationPreferences).where((pushNotificationPreferences as any).id === id);
    return true;
  } catch { return false; }
}

// ── bricspayTransfers ──
export async function getBricspayTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(bricspayTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createBricspayTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(bricspayTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateBricspayTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(bricspayTransfers).set(data).where((bricspayTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteBricspayTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(bricspayTransfers).where((bricspayTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── mbridgeTransfers ──
export async function getMbridgeTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(mbridgeTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createMbridgeTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(mbridgeTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateMbridgeTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(mbridgeTransfers).set(data).where((mbridgeTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteMbridgeTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(mbridgeTransfers).where((mbridgeTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── ghipssTransfers ──
export async function getGhipssTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(ghipssTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createGhipssTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(ghipssTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateGhipssTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(ghipssTransfers).set(data).where((ghipssTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteGhipssTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(ghipssTransfers).where((ghipssTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── africbdcTransfers ──
export async function getAfricbdcTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(africbdcTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAfricbdcTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(africbdcTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAfricbdcTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(africbdcTransfers).set(data).where((africbdcTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAfricbdcTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(africbdcTransfers).where((africbdcTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── papssTransfers ──
export async function getPapssTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(papssTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createPapssTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(papssTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updatePapssTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(papssTransfers).set(data).where((papssTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deletePapssTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(papssTransfers).where((papssTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── railHealthStatus ──
export async function getRailHealthStatus(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(railHealthStatus).limit(100);
    return rows;
  } catch { return []; }
}

export async function createRailHealthStatus(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(railHealthStatus).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateRailHealthStatus(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(railHealthStatus).set(data).where((railHealthStatus as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteRailHealthStatus(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(railHealthStatus).where((railHealthStatus as any).id === id);
    return true;
  } catch { return false; }
}

// ── settlementAccounts ──
export async function getSettlementAccounts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(settlementAccounts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSettlementAccounts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(settlementAccounts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSettlementAccounts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(settlementAccounts).set(data).where((settlementAccounts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSettlementAccounts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(settlementAccounts).where((settlementAccounts as any).id === id);
    return true;
  } catch { return false; }
}

// ── bmatchRateSnapshots ──
export async function getBmatchRateSnapshots(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(bmatchRateSnapshots).limit(100);
    return rows;
  } catch { return []; }
}

export async function createBmatchRateSnapshots(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(bmatchRateSnapshots).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateBmatchRateSnapshots(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(bmatchRateSnapshots).set(data).where((bmatchRateSnapshots as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteBmatchRateSnapshots(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(bmatchRateSnapshots).where((bmatchRateSnapshots as any).id === id);
    return true;
  } catch { return false; }
}

// ── walletFundingEvents ──
export async function getWalletFundingEvents(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(walletFundingEvents).limit(100);
    return rows;
  } catch { return []; }
}

export async function createWalletFundingEvents(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(walletFundingEvents).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateWalletFundingEvents(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(walletFundingEvents).set(data).where((walletFundingEvents as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteWalletFundingEvents(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(walletFundingEvents).where((walletFundingEvents as any).id === id);
    return true;
  } catch { return false; }
}

// ── bdcPartners ──
export async function getBdcPartners(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(bdcPartners).limit(100);
    return rows;
  } catch { return []; }
}

export async function createBdcPartners(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(bdcPartners).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateBdcPartners(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(bdcPartners).set(data).where((bdcPartners as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteBdcPartners(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(bdcPartners).where((bdcPartners as any).id === id);
    return true;
  } catch { return false; }
}

// ── bdcLiquidityRequests ──
export async function getBdcLiquidityRequests(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(bdcLiquidityRequests).limit(100);
    return rows;
  } catch { return []; }
}

export async function createBdcLiquidityRequests(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(bdcLiquidityRequests).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateBdcLiquidityRequests(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(bdcLiquidityRequests).set(data).where((bdcLiquidityRequests as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteBdcLiquidityRequests(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(bdcLiquidityRequests).where((bdcLiquidityRequests as any).id === id);
    return true;
  } catch { return false; }
}

// ── cbnComplianceExports ──
export async function getCbnComplianceExports(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(cbnComplianceExports).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCbnComplianceExports(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(cbnComplianceExports).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCbnComplianceExports(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(cbnComplianceExports).set(data).where((cbnComplianceExports as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCbnComplianceExports(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(cbnComplianceExports).where((cbnComplianceExports as any).id === id);
    return true;
  } catch { return false; }
}

// ── cbnCorridors ──
export async function getCbnCorridors(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(cbnCorridors).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCbnCorridors(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(cbnCorridors).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCbnCorridors(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(cbnCorridors).set(data).where((cbnCorridors as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCbnCorridors(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(cbnCorridors).where((cbnCorridors as any).id === id);
    return true;
  } catch { return false; }
}

// ── westAfricanCorridors ──
export async function getWestAfricanCorridors(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(westAfricanCorridors).limit(100);
    return rows;
  } catch { return []; }
}

export async function createWestAfricanCorridors(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(westAfricanCorridors).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateWestAfricanCorridors(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(westAfricanCorridors).set(data).where((westAfricanCorridors as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteWestAfricanCorridors(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(westAfricanCorridors).where((westAfricanCorridors as any).id === id);
    return true;
  } catch { return false; }
}

// ── xofPayoutAccounts ──
export async function getXofPayoutAccounts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(xofPayoutAccounts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createXofPayoutAccounts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(xofPayoutAccounts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateXofPayoutAccounts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(xofPayoutAccounts).set(data).where((xofPayoutAccounts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteXofPayoutAccounts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(xofPayoutAccounts).where((xofPayoutAccounts as any).id === id);
    return true;
  } catch { return false; }
}

// ── ecowasComplianceChecks ──
export async function getEcowasComplianceChecks(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(ecowasComplianceChecks).limit(100);
    return rows;
  } catch { return []; }
}

export async function createEcowasComplianceChecks(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(ecowasComplianceChecks).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateEcowasComplianceChecks(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(ecowasComplianceChecks).set(data).where((ecowasComplianceChecks as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteEcowasComplianceChecks(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(ecowasComplianceChecks).where((ecowasComplianceChecks as any).id === id);
    return true;
  } catch { return false; }
}

// ── immigrantWorkerProfiles ──
export async function getImmigrantWorkerProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(immigrantWorkerProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createImmigrantWorkerProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(immigrantWorkerProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateImmigrantWorkerProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(immigrantWorkerProfiles).set(data).where((immigrantWorkerProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteImmigrantWorkerProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(immigrantWorkerProfiles).where((immigrantWorkerProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── tieredKycSessions ──
export async function getTieredKycSessions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(tieredKycSessions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTieredKycSessions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(tieredKycSessions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTieredKycSessions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(tieredKycSessions).set(data).where((tieredKycSessions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTieredKycSessions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(tieredKycSessions).where((tieredKycSessions as any).id === id);
    return true;
  } catch { return false; }
}

// ── agentCashinTransactions ──
export async function getAgentCashinTransactions(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(agentCashinTransactions).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAgentCashinTransactions(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(agentCashinTransactions).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAgentCashinTransactions(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(agentCashinTransactions).set(data).where((agentCashinTransactions as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAgentCashinTransactions(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(agentCashinTransactions).where((agentCashinTransactions as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwProfiles ──
export async function getHnwProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwProfiles).set(data).where((hnwProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwProfiles).where((hnwProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwFxRates ──
export async function getHnwFxRates(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwFxRates).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwFxRates(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwFxRates).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwFxRates(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwFxRates).set(data).where((hnwFxRates as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwFxRates(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwFxRates).where((hnwFxRates as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwRelationshipManagers ──
export async function getHnwRelationshipManagers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwRelationshipManagers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwRelationshipManagers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwRelationshipManagers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwRelationshipManagers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwRelationshipManagers).set(data).where((hnwRelationshipManagers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwRelationshipManagers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwRelationshipManagers).where((hnwRelationshipManagers as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwPortfolios ──
export async function getHnwPortfolios(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwPortfolios).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwPortfolios(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwPortfolios).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwPortfolios(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwPortfolios).set(data).where((hnwPortfolios as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwPortfolios(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwPortfolios).where((hnwPortfolios as any).id === id);
    return true;
  } catch { return false; }
}

// ── correspondentBanks ──
export async function getCorrespondentBanks(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(correspondentBanks).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCorrespondentBanks(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(correspondentBanks).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCorrespondentBanks(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(correspondentBanks).set(data).where((correspondentBanks as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCorrespondentBanks(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(correspondentBanks).where((correspondentBanks as any).id === id);
    return true;
  } catch { return false; }
}

// ── clearingLines ──
export async function getClearingLines(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(clearingLines).limit(100);
    return rows;
  } catch { return []; }
}

export async function createClearingLines(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(clearingLines).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateClearingLines(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(clearingLines).set(data).where((clearingLines as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteClearingLines(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(clearingLines).where((clearingLines as any).id === id);
    return true;
  } catch { return false; }
}

// ── correspondentRiskScores ──
export async function getCorrespondentRiskScores(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(correspondentRiskScores).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCorrespondentRiskScores(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(correspondentRiskScores).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCorrespondentRiskScores(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(correspondentRiskScores).set(data).where((correspondentRiskScores as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCorrespondentRiskScores(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(correspondentRiskScores).where((correspondentRiskScores as any).id === id);
    return true;
  } catch { return false; }
}

// ── derisikingAlerts ──
export async function getDerisikingAlerts(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(derisikingAlerts).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDerisikingAlerts(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(derisikingAlerts).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDerisikingAlerts(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(derisikingAlerts).set(data).where((derisikingAlerts as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDerisikingAlerts(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(derisikingAlerts).where((derisikingAlerts as any).id === id);
    return true;
  } catch { return false; }
}

// ── smeTradeBulkBatches ──
export async function getSmeTradeBulkBatches(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(smeTradeBulkBatches).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSmeTradeBulkBatches(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(smeTradeBulkBatches).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSmeTradeBulkBatches(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(smeTradeBulkBatches).set(data).where((smeTradeBulkBatches as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSmeTradeBulkBatches(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(smeTradeBulkBatches).where((smeTradeBulkBatches as any).id === id);
    return true;
  } catch { return false; }
}

// ── smeTradePayments ──
export async function getSmeTradePayments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(smeTradePayments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSmeTradePayments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(smeTradePayments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSmeTradePayments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(smeTradePayments).set(data).where((smeTradePayments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSmeTradePayments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(smeTradePayments).where((smeTradePayments as any).id === id);
    return true;
  } catch { return false; }
}

// ── formMDocuments ──
export async function getFormMDocuments(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(formMDocuments).limit(100);
    return rows;
  } catch { return []; }
}

export async function createFormMDocuments(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(formMDocuments).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateFormMDocuments(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(formMDocuments).set(data).where((formMDocuments as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteFormMDocuments(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(formMDocuments).where((formMDocuments as any).id === id);
    return true;
  } catch { return false; }
}

// ── diasporaUsaProfiles ──
export async function getDiasporaUsaProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(diasporaUsaProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDiasporaUsaProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(diasporaUsaProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDiasporaUsaProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(diasporaUsaProfiles).set(data).where((diasporaUsaProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDiasporaUsaProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(diasporaUsaProfiles).where((diasporaUsaProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── achPaymentMethods ──
export async function getAchPaymentMethods(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(achPaymentMethods).limit(100);
    return rows;
  } catch { return []; }
}

export async function createAchPaymentMethods(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(achPaymentMethods).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateAchPaymentMethods(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(achPaymentMethods).set(data).where((achPaymentMethods as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteAchPaymentMethods(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(achPaymentMethods).where((achPaymentMethods as any).id === id);
    return true;
  } catch { return false; }
}

// ── usComplianceDisclosures ──
export async function getUsComplianceDisclosures(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(usComplianceDisclosures).limit(100);
    return rows;
  } catch { return []; }
}

export async function createUsComplianceDisclosures(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(usComplianceDisclosures).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateUsComplianceDisclosures(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(usComplianceDisclosures).set(data).where((usComplianceDisclosures as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteUsComplianceDisclosures(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(usComplianceDisclosures).where((usComplianceDisclosures as any).id === id);
    return true;
  } catch { return false; }
}

// ── diasporaEuProfiles ──
export async function getDiasporaEuProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(diasporaEuProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDiasporaEuProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(diasporaEuProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDiasporaEuProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(diasporaEuProfiles).set(data).where((diasporaEuProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDiasporaEuProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(diasporaEuProfiles).where((diasporaEuProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── sepaPaymentMethods ──
export async function getSepaPaymentMethods(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(sepaPaymentMethods).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSepaPaymentMethods(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(sepaPaymentMethods).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSepaPaymentMethods(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(sepaPaymentMethods).set(data).where((sepaPaymentMethods as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSepaPaymentMethods(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(sepaPaymentMethods).where((sepaPaymentMethods as any).id === id);
    return true;
  } catch { return false; }
}

// ── diasporaCanadaProfiles ──
export async function getDiasporaCanadaProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(diasporaCanadaProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDiasporaCanadaProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(diasporaCanadaProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDiasporaCanadaProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(diasporaCanadaProfiles).set(data).where((diasporaCanadaProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDiasporaCanadaProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(diasporaCanadaProfiles).where((diasporaCanadaProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── interacPaymentMethods ──
export async function getInteracPaymentMethods(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(interacPaymentMethods).limit(100);
    return rows;
  } catch { return []; }
}

export async function createInteracPaymentMethods(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(interacPaymentMethods).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateInteracPaymentMethods(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(interacPaymentMethods).set(data).where((interacPaymentMethods as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteInteracPaymentMethods(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(interacPaymentMethods).where((interacPaymentMethods as any).id === id);
    return true;
  } catch { return false; }
}

// ── westAfricaTransfers ──
export async function getWestAfricaTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(westAfricaTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createWestAfricaTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(westAfricaTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateWestAfricaTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(westAfricaTransfers).set(data).where((westAfricaTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteWestAfricaTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(westAfricaTransfers).where((westAfricaTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── immigrantWorkerKyc ──
export async function getImmigrantWorkerKyc(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(immigrantWorkerKyc).limit(100);
    return rows;
  } catch { return []; }
}

export async function createImmigrantWorkerKyc(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(immigrantWorkerKyc).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateImmigrantWorkerKyc(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(immigrantWorkerKyc).set(data).where((immigrantWorkerKyc as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteImmigrantWorkerKyc(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(immigrantWorkerKyc).where((immigrantWorkerKyc as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwClientProfiles ──
export async function getHnwClientProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwClientProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwClientProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwClientProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwClientProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwClientProfiles).set(data).where((hnwClientProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwClientProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwClientProfiles).where((hnwClientProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwRateLocks ──
export async function getHnwRateLocks(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwRateLocks).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwRateLocks(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwRateLocks).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwRateLocks(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwRateLocks).set(data).where((hnwRateLocks as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwRateLocks(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwRateLocks).where((hnwRateLocks as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwTransfers ──
export async function getHnwTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwTransfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwTransfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwTransfers).set(data).where((hnwTransfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwTransfers).where((hnwTransfers as any).id === id);
    return true;
  } catch { return false; }
}

// ── hnwRmRequests ──
export async function getHnwRmRequests(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(hnwRmRequests).limit(100);
    return rows;
  } catch { return []; }
}

export async function createHnwRmRequests(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(hnwRmRequests).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateHnwRmRequests(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(hnwRmRequests).set(data).where((hnwRmRequests as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteHnwRmRequests(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(hnwRmRequests).where((hnwRmRequests as any).id === id);
    return true;
  } catch { return false; }
}

// ── correspondentBanksV200 ──
export async function getCorrespondentBanksV200(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(correspondentBanksV200).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCorrespondentBanksV200(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(correspondentBanksV200).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCorrespondentBanksV200(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(correspondentBanksV200).set(data).where((correspondentBanksV200 as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCorrespondentBanksV200(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(correspondentBanksV200).where((correspondentBanksV200 as any).id === id);
    return true;
  } catch { return false; }
}

// ── correspondentSettlements ──
export async function getCorrespondentSettlements(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(correspondentSettlements).limit(100);
    return rows;
  } catch { return []; }
}

export async function createCorrespondentSettlements(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(correspondentSettlements).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateCorrespondentSettlements(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(correspondentSettlements).set(data).where((correspondentSettlements as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteCorrespondentSettlements(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(correspondentSettlements).where((correspondentSettlements as any).id === id);
    return true;
  } catch { return false; }
}

// ── smeTradeBatches ──
export async function getSmeTradeBatches(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(smeTradeBatches).limit(100);
    return rows;
  } catch { return []; }
}

export async function createSmeTradeBatches(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(smeTradeBatches).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateSmeTradeBatches(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(smeTradeBatches).set(data).where((smeTradeBatches as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteSmeTradeBatches(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(smeTradeBatches).where((smeTradeBatches as any).id === id);
    return true;
  } catch { return false; }
}

// ── diasporaProfiles ──
export async function getDiasporaProfiles(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(diasporaProfiles).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDiasporaProfiles(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(diasporaProfiles).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDiasporaProfiles(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(diasporaProfiles).set(data).where((diasporaProfiles as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDiasporaProfiles(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(diasporaProfiles).where((diasporaProfiles as any).id === id);
    return true;
  } catch { return false; }
}

// ── diasporaOfferClaims ──
export async function getDiasporaOfferClaims(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(diasporaOfferClaims).limit(100);
    return rows;
  } catch { return []; }
}

export async function createDiasporaOfferClaims(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(diasporaOfferClaims).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateDiasporaOfferClaims(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(diasporaOfferClaims).set(data).where((diasporaOfferClaims as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteDiasporaOfferClaims(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(diasporaOfferClaims).where((diasporaOfferClaims as any).id === id);
    return true;
  } catch { return false; }
}

// ── transfers ──
export async function getTransfers(db: any, filters?: Record<string, any>) {
  if (!db) return [];
  try {
    const rows = await db.select().from(transfers).limit(100);
    return rows;
  } catch { return []; }
}

export async function createTransfers(db: any, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.insert(transfers).values(data).returning();
    return row;
  } catch { return null; }
}

export async function updateTransfers(db: any, id: number, data: Record<string, any>) {
  if (!db) return null;
  try {
    const [row] = await db.update(transfers).set(data).where((transfers as any).id === id).returning();
    return row;
  } catch { return null; }
}

export async function deleteTransfers(db: any, id: number) {
  if (!db) return false;
  try {
    await db.delete(transfers).where((transfers as any).id === id);
    return true;
  } catch { return false; }
}