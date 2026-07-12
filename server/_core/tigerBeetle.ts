/**
 * RemitFlow — TigerBeetle Core Client (Production)
 * ─────────────────────────────────────────────────
 * Provides a type-safe, fail-closed interface to the TigerBeetle double-entry
 * ledger via the Rust bridge service (rust-tigerbeetle-bridge).
 *
 * Architecture:
 *   TypeScript API Layer → HTTP → Rust Bridge → TigerBeetle gRPC
 *
 * All financial operations MUST go through this module.
 * Fail-closed: if the bridge is unreachable, operations throw — never silently skip.
 *
 * Environment variables:
 *   TIGERBEETLE_BRIDGE_URL   e.g. http://rust-tigerbeetle-bridge:8080
 *   TIGERBEETLE_CLUSTER_ID   e.g. 0
 *   TIGERBEETLE_TIMEOUT_MS   e.g. 5000
 */
import axios, { AxiosInstance } from "axios";
import { logger } from "./logger";
import { getDb } from "../db";
import { eq, sql } from "drizzle-orm";

// ─── Configuration ────────────────────────────────────────────────────────────
const BRIDGE_URL = process.env.TIGERBEETLE_BRIDGE_URL || "http://localhost:8080";
const CLUSTER_ID = BigInt(process.env.TIGERBEETLE_CLUSTER_ID || "0");
const TIMEOUT_MS = parseInt(process.env.TIGERBEETLE_TIMEOUT_MS || "5000", 10);
const MAX_RETRIES = 3;

// ─── TigerBeetle Account Flags ────────────────────────────────────────────────
export const TB_FLAGS = {
  LINKED: 1,
  DEBITS_MUST_NOT_EXCEED_CREDITS: 2,
  CREDITS_MUST_NOT_EXCEED_DEBITS: 4,
  HISTORY: 8,
  IMPORTED: 16,
  CLOSED: 32,
} as const;

// ─── TigerBeetle Transfer Flags ───────────────────────────────────────────────
export const TB_TRANSFER_FLAGS = {
  LINKED: 1,
  PENDING: 2,
  POST_PENDING_TRANSFER: 4,
  VOID_PENDING_TRANSFER: 8,
  BALANCING_DEBIT: 16,
  BALANCING_CREDIT: 32,
  CLOSING_DEBIT: 64,
  CLOSING_CREDIT: 128,
  IMPORTED: 256,
} as const;

// ─── Ledger IDs (per currency) ────────────────────────────────────────────────
export const TB_LEDGERS: Record<string, number> = {
  USD: 840, NGN: 566, GBP: 826, EUR: 978, KES: 404, GHS: 936,
  ZAR: 710, TZS: 834, UGX: 800, RWF: 646, XOF: 952, XAF: 950,
  EGP: 818, MAD: 504, ETB: 230, SAR: 682, AED: 784, CNY: 156,
  INR: 356, JPY: 392, CAD: 124, AUD: 36, CHF: 756, BRL: 986,
  MXN: 484, SGD: 702, HKD: 344, USDC: 9001, USDT: 9002, CNGN: 9003,
};

// ─── Account Codes ────────────────────────────────────────────────────────────
export const TB_ACCOUNT_CODES = {
  USER_WALLET: 1000,
  FLOAT_POOL: 2000,
  FEE_COLLECTION: 3000,
  ESCROW: 4000,
  SETTLEMENT: 5000,
  SUSPENSE: 6000,
  NOSTRO: 7000,
  VOSTRO: 7001,
  STABLECOIN_RESERVE: 8000,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TBAccount {
  id: bigint;
  debitsPending: bigint;
  debitsPosted: bigint;
  creditsPending: bigint;
  creditsPosted: bigint;
  userData128: bigint;
  userData64: bigint;
  userData32: number;
  reserved: number;
  ledger: number;
  code: number;
  flags: number;
  timestamp: bigint;
}

export interface TBTransfer {
  id: bigint;
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  pendingId: bigint;
  userData128: bigint;
  userData64: bigint;
  userData32: number;
  timeout: number;
  ledger: number;
  code: number;
  flags: number;
  timestamp: bigint;
}

export interface CreateAccountRequest {
  id: bigint;
  ledger: number;
  code: number;
  flags?: number;
  userData128?: bigint;
  userData64?: bigint;
  userData32?: number;
}

export interface CreateTransferRequest {
  id: bigint;
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  flags?: number;
  pendingId?: bigint;
  userData128?: bigint;
  userData64?: bigint;
  userData32?: number;
  timeout?: number;
}

export interface TransferResult {
  success: boolean;
  transferId: bigint;
  error?: string;
  errorCode?: number;
}

export interface AccountBalance {
  accountId: bigint;
  debitsPending: bigint;
  debitsPosted: bigint;
  creditsPending: bigint;
  creditsPosted: bigint;
  balance: bigint; // creditsPosted - debitsPosted
}

// ─── HTTP Client ──────────────────────────────────────────────────────────────
let _client: AxiosInstance | null = null;
let _healthy = true;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

function getClient(): AxiosInstance {
  if (!_client) {
    _client = axios.create({
      baseURL: BRIDGE_URL,
      timeout: TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "X-Cluster-ID": CLUSTER_ID.toString(),
      },
    });
    _client.interceptors.response.use(
      (res) => res,
      (err) => {
        logger.error({ err: err.message, url: err.config?.url }, "[TigerBeetle] Bridge request failed");
        _healthy = false;
        return Promise.reject(err);
      }
    );
  }
  return _client;
}

// ─── Health Check ─────────────────────────────────────────────────────────────
export async function checkTigerBeetleHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) return _healthy;
  try {
    const res = await getClient().get("/health", { timeout: 2000 });
    _healthy = res.data?.status === "healthy";
    _lastHealthCheck = now;
    return _healthy;
  } catch {
    _healthy = false;
    _lastHealthCheck = now;
    return false;
  }
}

// ─── Account Operations ───────────────────────────────────────────────────────
export async function createAccounts(accounts: CreateAccountRequest[]): Promise<void> {
  const healthy = await checkTigerBeetleHealth();
  if (!healthy) throw new Error("[TigerBeetle] Bridge unhealthy — refusing to create accounts (fail-closed)");
  const payload = accounts.map(a => ({
    id: a.id.toString(),
    ledger: a.ledger,
    code: a.code,
    flags: a.flags ?? 0,
    user_data_128: (a.userData128 ?? 0n).toString(),
    user_data_64: (a.userData64 ?? 0n).toString(),
    user_data_32: a.userData32 ?? 0,
  }));
  const res = await getClient().post("/accounts/create", { accounts: payload });
  const errors = res.data?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`[TigerBeetle] Account creation errors: ${JSON.stringify(errors)}`);
  }
  logger.info({ count: accounts.length }, "[TigerBeetle] Accounts created");
}

export async function lookupAccounts(ids: bigint[]): Promise<TBAccount[]> {
  const healthy = await checkTigerBeetleHealth();
  if (!healthy) throw new Error("[TigerBeetle] Bridge unhealthy — refusing lookup (fail-closed)");
  const res = await getClient().post("/accounts/lookup", {
    ids: ids.map(id => id.toString()),
  });
  return (res.data?.accounts ?? []).map((a: Record<string, string | number>) => ({
    id: BigInt(a.id as string),
    debitsPending: BigInt(a.debits_pending as string),
    debitsPosted: BigInt(a.debits_posted as string),
    creditsPending: BigInt(a.credits_pending as string),
    creditsPosted: BigInt(a.credits_posted as string),
    userData128: BigInt(a.user_data_128 as string),
    userData64: BigInt(a.user_data_64 as string),
    userData32: a.user_data_32 as number,
    reserved: a.reserved as number,
    ledger: a.ledger as number,
    code: a.code as number,
    flags: a.flags as number,
    timestamp: BigInt(a.timestamp as string),
  }));
}

export async function getAccountBalance(accountId: bigint): Promise<AccountBalance> {
  const accounts = await lookupAccounts([accountId]);
  if (accounts.length === 0) throw new Error(`[TigerBeetle] Account ${accountId} not found`);
  const a = accounts[0];
  return {
    accountId: a.id,
    debitsPending: a.debitsPending,
    debitsPosted: a.debitsPosted,
    creditsPending: a.creditsPending,
    creditsPosted: a.creditsPosted,
    balance: a.creditsPosted - a.debitsPosted,
  };
}

// ─── Transfer Operations ──────────────────────────────────────────────────────
export async function createTransfers(transfers: CreateTransferRequest[]): Promise<TransferResult[]> {
  const healthy = await checkTigerBeetleHealth();
  if (!healthy) throw new Error("[TigerBeetle] Bridge unhealthy — refusing transfers (fail-closed)");
  const payload = transfers.map(t => ({
    id: t.id.toString(),
    debit_account_id: t.debitAccountId.toString(),
    credit_account_id: t.creditAccountId.toString(),
    amount: t.amount.toString(),
    ledger: t.ledger,
    code: t.code,
    flags: t.flags ?? 0,
    pending_id: (t.pendingId ?? 0n).toString(),
    user_data_128: (t.userData128 ?? 0n).toString(),
    user_data_64: (t.userData64 ?? 0n).toString(),
    user_data_32: t.userData32 ?? 0,
    timeout: t.timeout ?? 0,
  }));
  const res = await getClient().post("/transfers/create", { transfers: payload });
  const errors: Record<string, unknown>[] = res.data?.errors ?? [];
  return transfers.map((t, i) => {
    const err = errors.find((e: Record<string, unknown>) => e.index === i);
    return {
      success: !err,
      transferId: t.id,
      error: err ? String(err.reason) : undefined,
      errorCode: err ? Number(err.code) : undefined,
    };
  });
}

/**
 * Atomic double-entry transfer: debit one account, credit another.
 * Throws on failure — never silently drops financial operations.
 */
export async function atomicTransfer(params: {
  id: bigint;
  fromAccountId: bigint;
  toAccountId: bigint;
  amount: bigint;
  currency: string;
  code: number;
  metadata?: bigint;
}): Promise<void> {
  const ledger = TB_LEDGERS[params.currency];
  if (!ledger) throw new Error(`[TigerBeetle] Unknown currency: ${params.currency}`);
  const results = await createTransfers([{
    id: params.id,
    debitAccountId: params.fromAccountId,
    creditAccountId: params.toAccountId,
    amount: params.amount,
    ledger,
    code: params.code,
    userData128: params.metadata,
  }]);
  if (!results[0].success) {
    throw new Error(`[TigerBeetle] Transfer failed: ${results[0].error} (code: ${results[0].errorCode})`);
  }
  logger.info({
    transferId: params.id.toString(),
    from: params.fromAccountId.toString(),
    to: params.toAccountId.toString(),
    amount: params.amount.toString(),
    currency: params.currency,
  }, "[TigerBeetle] Atomic transfer completed");
}

/**
 * Two-phase transfer: create pending, then post or void.
 */
export async function createPendingTransfer(params: {
  id: bigint;
  fromAccountId: bigint;
  toAccountId: bigint;
  amount: bigint;
  currency: string;
  code: number;
  timeoutSeconds?: number;
}): Promise<void> {
  const ledger = TB_LEDGERS[params.currency];
  if (!ledger) throw new Error(`[TigerBeetle] Unknown currency: ${params.currency}`);
  const results = await createTransfers([{
    id: params.id,
    debitAccountId: params.fromAccountId,
    creditAccountId: params.toAccountId,
    amount: params.amount,
    ledger,
    code: params.code,
    flags: TB_TRANSFER_FLAGS.PENDING,
    timeout: params.timeoutSeconds ?? 300,
  }]);
  if (!results[0].success) {
    throw new Error(`[TigerBeetle] Pending transfer failed: ${results[0].error}`);
  }
}

export async function postPendingTransfer(postId: bigint, pendingId: bigint, amount: bigint, currency: string): Promise<void> {
  const ledger = TB_LEDGERS[currency];
  if (!ledger) throw new Error(`[TigerBeetle] Unknown currency: ${currency}`);
  const results = await createTransfers([{
    id: postId,
    debitAccountId: 0n,
    creditAccountId: 0n,
    amount,
    ledger,
    code: 0,
    flags: TB_TRANSFER_FLAGS.POST_PENDING_TRANSFER,
    pendingId,
  }]);
  if (!results[0].success) {
    throw new Error(`[TigerBeetle] Post pending failed: ${results[0].error}`);
  }
}

export async function voidPendingTransfer(voidId: bigint, pendingId: bigint, currency: string): Promise<void> {
  const ledger = TB_LEDGERS[currency];
  if (!ledger) throw new Error(`[TigerBeetle] Unknown currency: ${currency}`);
  const results = await createTransfers([{
    id: voidId,
    debitAccountId: 0n,
    creditAccountId: 0n,
    amount: 0n,
    ledger,
    code: 0,
    flags: TB_TRANSFER_FLAGS.VOID_PENDING_TRANSFER,
    pendingId,
  }]);
  if (!results[0].success) {
    throw new Error(`[TigerBeetle] Void pending failed: ${results[0].error}`);
  }
}

// ─── Account Provisioning ─────────────────────────────────────────────────────
/**
 * Provision TigerBeetle accounts for a new user across all supported currencies.
 * Called during user onboarding.
 */
export async function provisionUserAccounts(userId: number, currencies: string[] = ["USD", "NGN", "GBP", "EUR"]): Promise<void> {
  const accounts: CreateAccountRequest[] = currencies.map(currency => {
    const ledger = TB_LEDGERS[currency];
    if (!ledger) throw new Error(`[TigerBeetle] Unknown currency: ${currency}`);
    // Account ID: userId (32-bit) | currency ISO code (32-bit) | timestamp (64-bit)
    const accountId = (BigInt(userId) << 96n) | (BigInt(ledger) << 64n) | BigInt(Date.now());
    return {
      id: accountId,
      ledger,
      code: TB_ACCOUNT_CODES.USER_WALLET,
      flags: TB_FLAGS.DEBITS_MUST_NOT_EXCEED_CREDITS | TB_FLAGS.HISTORY,
      userData128: BigInt(userId),
    };
  });
  await createAccounts(accounts);
  // Persist mapping to PostgreSQL
  const db = await getDb();
  if (db) {
    for (let i = 0; i < currencies.length; i++) {
      await (db as any).execute(sql`
        INSERT INTO tigerbeetle_accounts (user_id, currency, account_id, account_code, ledger_id, status, created_at)
        VALUES (${userId}, ${currencies[i]}, ${accounts[i].id.toString()}, ${TB_ACCOUNT_CODES.USER_WALLET}, ${TB_LEDGERS[currencies[i]]}, 'active', NOW())
        ON CONFLICT (user_id, currency) DO UPDATE SET account_id = EXCLUDED.account_id, updated_at = NOW()
      `);
    }
  }
  logger.info({ userId, currencies }, "[TigerBeetle] User accounts provisioned");
}

// ─── Reconciliation ───────────────────────────────────────────────────────────
export async function reconcileWithPostgres(userId: number, currency: string): Promise<{
  tbBalance: bigint;
  pgBalance: bigint;
  discrepancy: bigint;
  inSync: boolean;
}> {
  const db = await getDb();
  if (!db) throw new Error("[TigerBeetle] DB unavailable for reconciliation");
  // Get TigerBeetle account ID from mapping table
  const mapping = await (db as any).execute(sql`
    SELECT account_id FROM tigerbeetle_accounts WHERE user_id = ${userId} AND currency = ${currency}
  `);
  if (!mapping.rows?.[0]) throw new Error(`[TigerBeetle] No account mapping for user ${userId} ${currency}`);
  const accountId = BigInt(mapping.rows[0].account_id);
  const tbBalance = await getAccountBalance(accountId);
  // Get PostgreSQL wallet balance
  const pgResult = await (db as any).execute(sql`
    SELECT balance FROM wallets WHERE user_id = ${userId} AND currency = ${currency}
  `);
  const pgBalance = pgResult.rows?.[0]?.balance
    ? BigInt(Math.round(parseFloat(pgResult.rows[0].balance) * 100))
    : 0n;
  const discrepancy = tbBalance.balance - pgBalance;
  const inSync = discrepancy === 0n;
  if (!inSync) {
    logger.warn({
      userId, currency,
      tbBalance: tbBalance.balance.toString(),
      pgBalance: pgBalance.toString(),
      discrepancy: discrepancy.toString(),
    }, "[TigerBeetle] Balance discrepancy detected");
  }
  return { tbBalance: tbBalance.balance, pgBalance, discrepancy, inSync };
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
export const tigerBeetle = {
  createAccounts,
  lookupAccounts,
  getAccountBalance,
  createTransfers,
  atomicTransfer,
  createPendingTransfer,
  postPendingTransfer,
  voidPendingTransfer,
  provisionUserAccounts,
  reconcileWithPostgres,
  checkHealth: checkTigerBeetleHealth,
  LEDGERS: TB_LEDGERS,
  ACCOUNT_CODES: TB_ACCOUNT_CODES,
  FLAGS: TB_FLAGS,
  TRANSFER_FLAGS: TB_TRANSFER_FLAGS,
};

export default tigerBeetle;
