/**
 * BDC _ledger.ts (B2) — TigerBeetle account chart + double-entry postings for
 * the BDC bounded context (SPEC-bdc §3.6).
 *
 * Account chart (per tenant): TB u16 `code` = class offset (tenant
 * disambiguation via the composite u128 account id — see bdcAccountCode)
 *   1 NGN_CASH          (NGN ledger) — physical naira drawers/vaults
 *   2 BANK_NGN          (NGN ledger) — naira at bank (NIP in/out)
 *   3 FX_INVENTORY      per currency: offset 300 + ccyIndex (ccy ledger)
 *   4 CUSTOMER_PAYABLE  per-ledger clearing account for customer obligations
 *   5 IMTO_SETTLEMENT   (NGN ledger) — IMTO payout settlement suspense
 *   6 COMMISSION_INCOME (NGN ledger) — IMTO commission revenue
 *   7 EQUITY            (NGN ledger) — operator capital
 *
 * TigerBeetle transfers are single-ledger, so cross-currency postings
 * (e.g. NFEM purchase: USD in, NGN out) are booked as one transfer per
 * ledger with CUSTOMER_PAYABLE as the per-ledger clearing counter-leg.
 *
 * Idempotency: every transfer id is a deterministic 128-bit hash of
 * (`BDC:${idempotencyKey}:${leg}`), so replays hit TB `exists` and are
 * treated as idempotent no-ops. Two-phase: legs awaiting an external
 * confirmation (NIP naira leg, Mojaloop payout) are created PENDING and
 * posted by confirmLeg / voided by reversePost.
 *
 * Fail-closed (SPEC §0.3): any TigerBeetle bridge failure throws TRPCError
 * UNAVAILABLE — the surrounding db.transaction rolls back.
 *
 * PG mirror: ledger_entries (migration 0063) fits WITHOUT modification —
 * generic (debitAccountId, creditAccountId, amount, currency, reference,
 * code, type, tigerbeetleTransferId, metadata) — so mirror rows are written
 * inside the same db.transaction via mirrorLegsToPg(). TigerBeetle remains
 * the monetary system of record (per the ledger_entries header comment).
 */
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import {
  createAccounts,
  createTransfers,
  postPendingTransfer,
  voidPendingTransfer,
  lookupAccounts,
  compositeAccountId,
  TB_LEDGERS,
  TB_FLAGS,
  TB_TRANSFER_FLAGS,
  type CreateTransferRequest,
  type CreateAccountRequest,
} from "../../_core/tigerBeetle";
import { ledgerEntries } from "../../../drizzle/schema";
import { logger } from "../../_core/logger";

// ─── Account chart ────────────────────────────────────────────────────────────

export const BDC_ACCOUNT_OFFSETS = {
  NGN_CASH: 1,
  BANK_NGN: 2,
  FX_INVENTORY_BASE: 300, // + ccyIndex (stable alphabetic index of ISO code)
  CUSTOMER_PAYABLE: 4,
  IMTO_SETTLEMENT: 5,
  COMMISSION_INCOME: 6,
  EQUITY: 7,
} as const;

/** Stable alphabetic index over the 3-letter ISO codes in TB_LEDGERS. */
const ISO_CURRENCIES = Object.keys(TB_LEDGERS)
  .filter((c) => c.length === 3)
  .sort();

export function ccyIndex(currency: string): number {
  const idx = ISO_CURRENCIES.indexOf(currency.toUpperCase());
  if (idx === -1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported FX currency for BDC ledger: ${currency}` });
  }
  return idx;
}

/**
 * TB u16 code for the account class. TB `code` is u16 (max 65535), so the
 * original tenantId*1000+offset scheme overflows for tenantId ≥ 66. Tenant
 * disambiguation is already carried by the deterministic composite u128
 * account id (bdcAccountId), so `code` is the class offset only — queries
 * filter by code+ledger and are per-tenant via the account ids.
 */
export function bdcAccountCode(_tenantId: number, offset: number): number {
  return offset;
}

function ledgerOf(currency: string): number {
  const ledger = TB_LEDGERS[currency.toUpperCase()];
  if (!ledger) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `No TigerBeetle ledger for currency: ${currency}` });
  }
  return ledger;
}

/** Deterministic 128-bit account id: tenantId | offset | ledger | seq(0). */
export function bdcAccountId(tenantId: number, offset: number, currency: string): bigint {
  return BigInt(compositeAccountId(tenantId, offset, ledgerOf(currency), 0n));
}

export const BDC_ACCOUNTS = {
  ngnCash: (tenantId: number) => bdcAccountId(tenantId, BDC_ACCOUNT_OFFSETS.NGN_CASH, "NGN"),
  bankNgn: (tenantId: number) => bdcAccountId(tenantId, BDC_ACCOUNT_OFFSETS.BANK_NGN, "NGN"),
  fxInventory: (tenantId: number, currency: string) =>
    bdcAccountId(tenantId, BDC_ACCOUNT_OFFSETS.FX_INVENTORY_BASE + ccyIndex(currency), currency),
  customerPayable: (tenantId: number, currency: string) =>
    bdcAccountId(tenantId, BDC_ACCOUNT_OFFSETS.CUSTOMER_PAYABLE, currency),
  imtoSettlement: (tenantId: number) => bdcAccountId(tenantId, BDC_ACCOUNT_OFFSETS.IMTO_SETTLEMENT, "NGN"),
  commissionIncome: (tenantId: number) => bdcAccountId(tenantId, BDC_ACCOUNT_OFFSETS.COMMISSION_INCOME, "NGN"),
  equity: (tenantId: number) => bdcAccountId(tenantId, BDC_ACCOUNT_OFFSETS.EQUITY, "NGN"),
};

// ─── Deterministic transfer ids ───────────────────────────────────────────────

/** sha256(`BDC:${idempotencyKey}:${leg}`) truncated to 128 bits — replay-safe. */
export function bdcTransferId(idempotencyKey: string, leg: string): bigint {
  const hex = createHash("sha256").update(`BDC:${idempotencyKey}:${leg}`).digest("hex").slice(0, 32);
  return BigInt(`0x${hex}`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TbLegRecord {
  leg: string; // 'fx' | 'ngn' | 'payout' | 'commission' | reversal suffixes
  transferId: string; // decimal u128
  debitAccountId: string;
  creditAccountId: string;
  amountMinor: string; // minor units (cents/kobo) as decimal string
  currency: string; // ledger currency of the transfer
  ledger: number;
  code: number; // TB transfer code (BDC account code of the primary account)
  phase: "pending" | "posted" | "voided" | "reversed" | "reversal";
  /** Set by confirmLeg: the POST_PENDING transfer id that settled this leg. */
  postTransferId?: string;
}

// ─── TB error mapping ─────────────────────────────────────────────────────────

function tbUnavailable(op: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ op, err: msg }, "[BDC ledger] TigerBeetle unavailable/failed — failing closed");
  throw new TRPCError({
    code: "UNAVAILABLE",
    message: `TigerBeetle ledger unavailable during ${op} — operation denied (fail-closed)`,
    cause: err,
  });
}

/**
 * createTransfers wrapper: TB `exists` on a deterministic id is an idempotent
 * replay (success); any other per-transfer error or bridge failure throws.
 */
async function createTransfersIdempotent(op: string, reqs: CreateTransferRequest[]): Promise<void> {
  let results;
  try {
    results = await createTransfers(reqs);
  } catch (err) {
    tbUnavailable(op, err);
  }
  const failures = results!.filter((r) => !r.success && !/exists/i.test(r.error ?? ""));
  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.transferId}: ${f.error} (code ${f.errorCode})`).join("; ");
    logger.error({ op, detail }, "[BDC ledger] TigerBeetle transfer rejected");
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: `TigerBeetle rejected ${op} transfer(s): ${detail}`,
    });
  }
}

function legRecord(
  leg: string,
  req: CreateTransferRequest,
  currency: string,
  phase: TbLegRecord["phase"],
): TbLegRecord {
  return {
    leg,
    transferId: req.id.toString(),
    debitAccountId: req.debitAccountId.toString(),
    creditAccountId: req.creditAccountId.toString(),
    amountMinor: req.amount.toString(),
    currency,
    ledger: req.ledger,
    code: req.code,
    phase,
  };
}

// ─── Account provisioning ─────────────────────────────────────────────────────

/**
 * Idempotently provision the BDC account chart for a tenant. NGN-ledger
 * accounts (cash, bank, payable, settlement, commission, equity) plus
 * FX_INVENTORY + CUSTOMER_PAYABLE per requested currency.
 *
 * Flags: FX_INVENTORY is debit-normal (CREDITS_MUST_NOT_EXCEED_DEBITS — you
 * cannot disburse FX the operator does not hold); COMMISSION_INCOME/EQUITY
 * are credit-normal. Clearing accounts (CUSTOMER_PAYABLE, IMTO_SETTLEMENT)
 * and naira cash/bank carry HISTORY only: the funding/capitalization flow
 * (DR cash/bank, CR equity) is outside this wave, so hard balance
 * constraints on those accounts would make every posting fail before any
 * capitalization exists. App-layer guarded updates enforce stock limits.
 */
export async function ensureBdcAccounts(tenantId: number, currencies: string[] = ["USD"]): Promise<void> {
  const accounts: CreateAccountRequest[] = [];
  const push = (id: bigint, currency: string, offset: number, flags: number) =>
    accounts.push({
      id,
      ledger: ledgerOf(currency),
      code: bdcAccountCode(tenantId, offset),
      flags,
      userData128: BigInt(tenantId),
    });

  push(BDC_ACCOUNTS.ngnCash(tenantId), "NGN", BDC_ACCOUNT_OFFSETS.NGN_CASH, TB_FLAGS.HISTORY);
  push(BDC_ACCOUNTS.bankNgn(tenantId), "NGN", BDC_ACCOUNT_OFFSETS.BANK_NGN, TB_FLAGS.HISTORY);
  push(BDC_ACCOUNTS.customerPayable(tenantId, "NGN"), "NGN", BDC_ACCOUNT_OFFSETS.CUSTOMER_PAYABLE, TB_FLAGS.HISTORY);
  push(BDC_ACCOUNTS.imtoSettlement(tenantId), "NGN", BDC_ACCOUNT_OFFSETS.IMTO_SETTLEMENT, TB_FLAGS.HISTORY);
  push(
    BDC_ACCOUNTS.commissionIncome(tenantId),
    "NGN",
    BDC_ACCOUNT_OFFSETS.COMMISSION_INCOME,
    TB_FLAGS.HISTORY | TB_FLAGS.DEBITS_MUST_NOT_EXCEED_CREDITS,
  );
  push(
    BDC_ACCOUNTS.equity(tenantId),
    "NGN",
    BDC_ACCOUNT_OFFSETS.EQUITY,
    TB_FLAGS.HISTORY | TB_FLAGS.DEBITS_MUST_NOT_EXCEED_CREDITS,
  );

  for (const currency of currencies) {
    const ccy = currency.toUpperCase();
    if (ccy === "NGN") continue;
    const offset = BDC_ACCOUNT_OFFSETS.FX_INVENTORY_BASE + ccyIndex(ccy);
    push(
      BDC_ACCOUNTS.fxInventory(tenantId, ccy),
      ccy,
      offset,
      TB_FLAGS.HISTORY | TB_FLAGS.CREDITS_MUST_NOT_EXCEED_DEBITS,
    );
    push(BDC_ACCOUNTS.customerPayable(tenantId, ccy), ccy, BDC_ACCOUNT_OFFSETS.CUSTOMER_PAYABLE, TB_FLAGS.HISTORY);
  }

  try {
    await createAccounts(accounts);
  } catch (err) {
    tbUnavailable("ensureBdcAccounts", err);
  }
  logger.info({ tenantId, currencies, count: accounts.length }, "[BDC ledger] Accounts ensured");
}

// ─── Postings ─────────────────────────────────────────────────────────────────

/**
 * buyFx (BDC buys FX from a walk-in customer):
 *   fx leg  (ccy ledger, PENDING): DR FX_INVENTORY_{ccy}   CR CUSTOMER_PAYABLE_{ccy}
 *   ngn leg (NGN ledger, PENDING): DR CUSTOMER_PAYABLE_ngn CR NGN_CASH|BANK_NGN
 * Both legs pend until confirmNairaLeg posts them (naira leg confirmed via
 * NIP / cash count). nairaChannel: 'cash' → NGN_CASH, else BANK_NGN.
 */
export async function postBuyFx(params: {
  tenantId: number;
  idempotencyKey: string;
  currency: string;
  fxMinor: bigint;
  nairaMinor: bigint;
  nairaChannel: "cash" | "bank";
}): Promise<TbLegRecord[]> {
  const { tenantId, idempotencyKey, nairaChannel } = params;
  const ccy = params.currency.toUpperCase();
  await ensureBdcAccounts(tenantId, [ccy]);

  const fxReq: CreateTransferRequest = {
    id: bdcTransferId(idempotencyKey, "fx"),
    debitAccountId: BDC_ACCOUNTS.fxInventory(tenantId, ccy),
    creditAccountId: BDC_ACCOUNTS.customerPayable(tenantId, ccy),
    amount: params.fxMinor,
    ledger: ledgerOf(ccy),
    code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.FX_INVENTORY_BASE + ccyIndex(ccy)),
    flags: TB_TRANSFER_FLAGS.PENDING,
    timeout: 0,
  };
  const ngnCredit = nairaChannel === "cash" ? BDC_ACCOUNTS.ngnCash(tenantId) : BDC_ACCOUNTS.bankNgn(tenantId);
  const ngnReq: CreateTransferRequest = {
    id: bdcTransferId(idempotencyKey, "ngn"),
    debitAccountId: BDC_ACCOUNTS.customerPayable(tenantId, "NGN"),
    creditAccountId: ngnCredit,
    amount: params.nairaMinor,
    ledger: ledgerOf("NGN"),
    code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.CUSTOMER_PAYABLE),
    flags: TB_TRANSFER_FLAGS.PENDING,
    timeout: 0,
  };
  await createTransfersIdempotent("postBuyFx", [fxReq, ngnReq]);
  return [legRecord("fx", fxReq, ccy, "pending"), legRecord("ngn", ngnReq, "NGN", "pending")];
}

/**
 * sellFx (BDC sells FX to a customer):
 *   ngn leg (NGN ledger, PENDING): DR NGN_CASH|BANK_NGN   CR CUSTOMER_PAYABLE_ngn  (naira received)
 *   fx leg  (ccy ledger, PENDING): DR CUSTOMER_PAYABLE_{ccy} CR FX_INVENTORY_{ccy} (FX disbursed)
 */
export async function postSellFx(params: {
  tenantId: number;
  idempotencyKey: string;
  currency: string;
  fxMinor: bigint;
  nairaMinor: bigint;
  nairaChannel: "cash" | "bank";
}): Promise<TbLegRecord[]> {
  const { tenantId, idempotencyKey, nairaChannel } = params;
  const ccy = params.currency.toUpperCase();
  await ensureBdcAccounts(tenantId, [ccy]);

  const ngnDebit = nairaChannel === "cash" ? BDC_ACCOUNTS.ngnCash(tenantId) : BDC_ACCOUNTS.bankNgn(tenantId);
  const ngnReq: CreateTransferRequest = {
    id: bdcTransferId(idempotencyKey, "ngn"),
    debitAccountId: ngnDebit,
    creditAccountId: BDC_ACCOUNTS.customerPayable(tenantId, "NGN"),
    amount: params.nairaMinor,
    ledger: ledgerOf("NGN"),
    code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.CUSTOMER_PAYABLE),
    flags: TB_TRANSFER_FLAGS.PENDING,
    timeout: 0,
  };
  const fxReq: CreateTransferRequest = {
    id: bdcTransferId(idempotencyKey, "fx"),
    debitAccountId: BDC_ACCOUNTS.customerPayable(tenantId, ccy),
    creditAccountId: BDC_ACCOUNTS.fxInventory(tenantId, ccy),
    amount: params.fxMinor,
    ledger: ledgerOf(ccy),
    code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.FX_INVENTORY_BASE + ccyIndex(ccy)),
    flags: TB_TRANSFER_FLAGS.PENDING,
    timeout: 0,
  };
  await createTransfersIdempotent("postSellFx", [ngnReq, fxReq]);
  return [legRecord("ngn", ngnReq, "NGN", "pending"), legRecord("fx", fxReq, ccy, "pending")];
}

/**
 * NFEM purchase funding (conceptually DR FX_INVENTORY_USD / CR BANK_NGN; TB
 * transfers are single-ledger so each side is booked with the
 * CUSTOMER_PAYABLE per-ledger clearing leg):
 *   usd leg (USD ledger, POSTED): DR FX_INVENTORY_USD CR CUSTOMER_PAYABLE_usd
 *   ngn leg (NGN ledger, POSTED): DR CUSTOMER_PAYABLE_ngn CR BANK_NGN
 * Funding is admin-confirmed (money already moved at the bank) → immediate POST.
 */
export async function postNfemPurchase(params: {
  tenantId: number;
  idempotencyKey: string;
  amountUsdMinor: bigint;
  nairaPaidMinor: bigint;
}): Promise<TbLegRecord[]> {
  const { tenantId, idempotencyKey } = params;
  await ensureBdcAccounts(tenantId, ["USD"]);

  const usdReq: CreateTransferRequest = {
    id: bdcTransferId(idempotencyKey, "usd"),
    debitAccountId: BDC_ACCOUNTS.fxInventory(tenantId, "USD"),
    creditAccountId: BDC_ACCOUNTS.customerPayable(tenantId, "USD"),
    amount: params.amountUsdMinor,
    ledger: ledgerOf("USD"),
    code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.FX_INVENTORY_BASE + ccyIndex("USD")),
    flags: 0,
  };
  const ngnReq: CreateTransferRequest = {
    id: bdcTransferId(idempotencyKey, "ngn"),
    debitAccountId: BDC_ACCOUNTS.customerPayable(tenantId, "NGN"),
    creditAccountId: BDC_ACCOUNTS.bankNgn(tenantId),
    amount: params.nairaPaidMinor,
    ledger: ledgerOf("NGN"),
    code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.BANK_NGN),
    flags: 0,
  };
  await createTransfersIdempotent("postNfemPurchase", [usdReq, ngnReq]);
  return [legRecord("usd", usdReq, "USD", "posted"), legRecord("ngn", ngnReq, "NGN", "posted")];
}

/**
 * IMTO payout (SPEC §3.10):
 *   payout leg    (NGN ledger, PENDING): DR IMTO_SETTLEMENT CR NGN_CASH
 *   commission leg(NGN ledger, POSTED):  DR IMTO_SETTLEMENT CR COMMISSION_INCOME
 * The payout leg posts on the Mojaloop transfer callback (B4 wires it).
 */
export async function postImtoPayout(params: {
  tenantId: number;
  idempotencyKey: string;
  nairaMinor: bigint;
  commissionMinor: bigint;
}): Promise<TbLegRecord[]> {
  const { tenantId, idempotencyKey } = params;
  await ensureBdcAccounts(tenantId, []);

  const payoutReq: CreateTransferRequest = {
    id: bdcTransferId(idempotencyKey, "payout"),
    debitAccountId: BDC_ACCOUNTS.imtoSettlement(tenantId),
    creditAccountId: BDC_ACCOUNTS.ngnCash(tenantId),
    amount: params.nairaMinor,
    ledger: ledgerOf("NGN"),
    code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.IMTO_SETTLEMENT),
    flags: TB_TRANSFER_FLAGS.PENDING,
    timeout: 0,
  };
  const reqs = [payoutReq];
  const legs: TbLegRecord[] = [];
  if (params.commissionMinor > 0n) {
    reqs.push({
      id: bdcTransferId(idempotencyKey, "commission"),
      debitAccountId: BDC_ACCOUNTS.imtoSettlement(tenantId),
      creditAccountId: BDC_ACCOUNTS.commissionIncome(tenantId),
      amount: params.commissionMinor,
      ledger: ledgerOf("NGN"),
      code: bdcAccountCode(tenantId, BDC_ACCOUNT_OFFSETS.COMMISSION_INCOME),
      flags: 0,
    });
  }
  await createTransfersIdempotent("postImtoPayout", reqs);
  legs.push(legRecord("payout", reqs[0], "NGN", "pending"));
  if (reqs[1]) legs.push(legRecord("commission", reqs[1], "NGN", "posted"));
  return legs;
}

/**
 * Post a PENDING leg whose external confirmation arrived (two-phase commit).
 * Returns the leg record updated to phase 'posted' with the post transfer id.
 */
export async function confirmLeg(idempotencyKey: string, leg: TbLegRecord): Promise<TbLegRecord> {
  if (leg.phase !== "pending") return leg; // already settled — idempotent no-op
  const postId = bdcTransferId(idempotencyKey, `${leg.leg}:post`);
  try {
    await postPendingTransfer(postId, BigInt(leg.transferId), BigInt(leg.amountMinor), leg.currency);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Replaying a post of an already-posted pending transfer is an idempotent
    // no-op; anything else fails closed.
    if (/exists|pending_transfer_has_already_been_posted/i.test(msg)) {
      return { ...leg, phase: "posted", postTransferId: postId.toString() };
    }
    tbUnavailable(`confirmLeg(${leg.leg})`, err);
  }
  return { ...leg, phase: "posted", postTransferId: postId.toString() };
}

/**
 * Reverse previously recorded legs:
 *   phase 'pending' → VOID the pending transfer (two-phase abort)
 *   phase 'posted'  → book an opposite-direction reversal transfer
 * Reversal ids are deterministic (`${leg}:void` / `${leg}:rev`) so replays
 * are idempotent. Returns the full updated leg list (originals re-phased +
 * appended reversal entries) for persisting into tbTransferIds.
 */
export async function reversePost(
  idempotencyKey: string,
  originalTbIds: TbLegRecord[],
): Promise<TbLegRecord[]> {
  const out: TbLegRecord[] = [];
  for (const leg of originalTbIds) {
    if (leg.phase === "pending") {
      const voidId = bdcTransferId(idempotencyKey, `${leg.leg}:void`);
      try {
        await voidPendingTransfer(voidId, BigInt(leg.transferId), leg.currency);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/exists|pending_transfer_has_already_been_voided/i.test(msg)) {
          tbUnavailable(`reversePost(void ${leg.leg})`, err);
        }
      }
      out.push({ ...leg, phase: "voided" });
      // Mirrorable record of the VOID transfer itself.
      out.push({
        leg: `${leg.leg}:void`,
        transferId: voidId.toString(),
        debitAccountId: leg.debitAccountId,
        creditAccountId: leg.creditAccountId,
        amountMinor: "0",
        currency: leg.currency,
        ledger: leg.ledger,
        code: leg.code,
        phase: "reversal",
      });
    } else if (leg.phase === "posted") {
      const revReq: CreateTransferRequest = {
        id: bdcTransferId(idempotencyKey, `${leg.leg}:rev`),
        debitAccountId: BigInt(leg.creditAccountId),
        creditAccountId: BigInt(leg.debitAccountId),
        amount: BigInt(leg.amountMinor),
        ledger: leg.ledger,
        code: leg.code,
        flags: 0,
      };
      await createTransfersIdempotent(`reversePost(rev ${leg.leg})`, [revReq]);
      out.push({ ...leg, phase: "reversed" });
      out.push(legRecord(`${leg.leg}:reversal`, revReq, leg.currency, "reversal"));
    } else {
      out.push(leg); // already voided/reversed — idempotent replay
    }
  }
  return out;
}

// ─── PG mirror (ledger_entries, migration 0063 — fits WITHOUT modification) ───

function minorToMajorString(minor: string): string {
  const v = BigInt(minor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Write PG mirror rows for TB legs into ledger_entries INSIDE the caller's
 * db.transaction. Mirror id is deterministic (`BDC-${reference}-${leg}`) and
 * conflicts are ignored, so replays never duplicate. TB stays authoritative.
 */
export async function mirrorLegsToPg(
  tx: { insert: (t: typeof ledgerEntries) => any },
  legs: TbLegRecord[],
  meta: { reference: string; type: string; tenantId: number; bdcTransactionId?: number | null },
): Promise<void> {
  for (const leg of legs) {
    await tx
      .insert(ledgerEntries)
      .values({
        id: `BDC-${meta.reference}-${leg.leg}`,
        debitAccountId: leg.debitAccountId,
        creditAccountId: leg.creditAccountId,
        amount: minorToMajorString(leg.amountMinor),
        currency: leg.currency,
        reference: meta.reference,
        code: leg.code,
        type: meta.type,
        transferId: null,
        tigerbeetleTransferId: leg.transferId,
        metadata: {
          tenantId: meta.tenantId,
          bdcTransactionId: meta.bdcTransactionId ?? null,
          leg: leg.leg,
          phase: leg.phase,
        },
      })
      .onConflictDoNothing();
  }
}

// ─── Position reads (positionNow / eodClose) ──────────────────────────────────

export interface BdcPositionBalances {
  /** Net FX inventory per currency in minor units (posted + pending). */
  fxInventoryMinor: Record<string, bigint>;
  /** Net liability on BANK_NGN (borrowing/overdraft), minor units; 0 if none. */
  borrowingNgnMinor: bigint;
  /** Raw per-account balances for transparency. */
  accounts: Array<{ accountId: string; currency: string; netMinor: string }>;
}

/**
 * Read position balances straight from TigerBeetle (lookup is ≤1s stale by
 * construction — the bridge queries TB synchronously; callers label the
 * result stalenessLabel:'≤1s'). Missing accounts read as zero.
 */
export async function getBdcPositionBalances(
  tenantId: number,
  currencies: string[],
): Promise<BdcPositionBalances> {
  const wanted: Array<{ id: bigint; currency: string; kind: "fx" | "bank" }> = [];
  for (const currency of currencies) {
    const ccy = currency.toUpperCase();
    if (ccy === "NGN") continue;
    wanted.push({ id: BDC_ACCOUNTS.fxInventory(tenantId, ccy), currency: ccy, kind: "fx" });
  }
  wanted.push({ id: BDC_ACCOUNTS.bankNgn(tenantId), currency: "NGN", kind: "bank" });

  let accounts;
  try {
    accounts = await lookupAccounts(wanted.map((w) => w.id));
  } catch (err) {
    tbUnavailable("getBdcPositionBalances", err);
  }
  const byId = new Map(accounts!.map((a) => [a.id.toString(), a]));

  const fxInventoryMinor: Record<string, bigint> = {};
  let borrowingNgnMinor = 0n;
  const raw: BdcPositionBalances["accounts"] = [];
  for (const w of wanted) {
    const a = byId.get(w.id.toString());
    // Asset-normal nets: debits - credits (posted + pending).
    const net = a
      ? a.debitsPosted + a.debitsPending - a.creditsPosted - a.creditsPending
      : 0n;
    if (w.kind === "fx") {
      fxInventoryMinor[w.currency] = net;
    } else {
      // BANK_NGN: a net CREDIT balance (credits > debits) is an overdraft —
      // i.e. operator borrowing from the bank.
      borrowingNgnMinor = -net > 0n ? -net : 0n;
    }
    raw.push({ accountId: w.id.toString(), currency: w.currency, netMinor: net.toString() });
  }
  return { fxInventoryMinor, borrowingNgnMinor, accounts: raw };
}
