// ============================================================================
// RemitFlow — NIP & Mobile-Money Rail RETURN Webhooks (wave12 G8, B4)
// Receives rail-initiated return/recall notifications and compensates the
// affected transfer honestly:
//
//   POST /api/webhooks/nip/return          — NIP (NIBSS) return callback
//   POST /api/webhooks/mobilemoney/return  — Mobile-money rail return callback
//
// Resolution order (SPEC-wave12 §4.1):
//   1. BDC transaction (payment_leg rail reference or idempotency key) in a
//      settled/posted state → bdc_reversals row (reversal_type='rail_return',
//      status='approved', system actor) + executeApprovedReversal (the same
//      shared execution path as bdc.reversals.approveReversal).
//   2. Platform transfer (transactions.metadata->>'partnerReference' or
//      ->>'tx_ref') → NO invented refund flow: annotate metadata.railReturn
//      and flip status to 'failed' ONLY via a guarded flip from a
//      non-terminal state; terminal rows keep their honest status and an ops
//      alert is emitted either way.
//
// Fail-closed: HMAC verification via verifyWebhookSignature (no secret →
// reject; the only exception is the explicit dev-only ALLOW_INSECURE_WEBHOOKS
// opt-in inside webhookHmac.ts). Idempotent: isWebhookDuplicate + guarded
// flips + executeApprovedReversal's already-posted replay.
// ============================================================================
import type { Express, Request, Response, NextFunction } from "express";
import { getDb, createAuditLog } from "./db.js";
import { transactions } from "../drizzle/schema.js";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./_core/logger";
import { verifyWebhookSignature, isWebhookDuplicate } from "./lib/webhookHmac.js";
import { PLATFORM_SYSTEM_USER_ID } from "./_core/tigerBeetle";
import { bdcReversals, bdcTransactions } from "../drizzle/schema";
import { executeApprovedReversal } from "./routers/bdc/reversals";
import { publishEvent } from "./middleware/kafka";

// ORCH adds constant: KAFKA_TOPICS.BDC_REVERSALS = "remitflow.bdc.reversals" (SPEC-wave12 §7).
const BDC_REVERSALS_TOPIC = "remitflow.bdc.reversals";

// ─── Webhook Rate Limiter (same pattern as payment-rail-webhooks.ts) ─────────
const railReturnRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WEBHOOK_RATE_LIMIT = 100;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

function webhookRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const entry = railReturnRateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    railReturnRateLimitMap.set(ip, { count: 1, resetAt: now + WEBHOOK_RATE_WINDOW_MS });
    next();
    return;
  }

  entry.count++;
  if (entry.count > WEBHOOK_RATE_LIMIT) {
    logger.warn({ ip, count: entry.count }, "[RailReturn Webhook] Rate limit exceeded");
    res.status(429).json({ error: "Too many webhook requests" });
    return;
  }

  next();
}

setInterval(() => {
  const now = Date.now();
  railReturnRateLimitMap.forEach((entry, ip) => {
    if (now > entry.resetAt) railReturnRateLimitMap.delete(ip);
  });
}, 300_000);

// ─── Payload + helpers ───────────────────────────────────────────────────────

interface RailReturnPayload {
  reference: string; // rail-side reference of the original payout
  amount?: number | string;
  currency?: string;
  reason?: string;
  railTxnId?: string; // rail's own transaction id for the return leg
}

/** Fail-soft ops alert — telemetry never blocks the webhook ack (SPEC §0.5). */
async function publishRailReturnAlert(key: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await publishEvent(BDC_REVERSALS_TOPIC, key, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), key },
      "[RailReturn Webhook] Kafka alert publish failed (non-blocking)",
    );
  }
}

/**
 * Handle one verified, deduplicated rail return. Returns a summary the
 * handler reports back to the rail (the HTTP ack is always 200 once the
 * signature is valid — retries must not be encouraged by 5xx on our side).
 */
async function processRailReturn(
  provider: "nip" | "mobilemoney",
  payload: RailReturnPayload,
): Promise<{ matched: boolean; target?: "bdc" | "platform"; outcome?: string }> {
  const db = await getDb();
  if (!db) {
    // Fail closed: without the DB we cannot record anything honestly.
    throw new Error("[RailReturn Webhook] Database unavailable — failing closed");
  }

  const reference = payload.reference;
  const railReference = payload.railTxnId ?? reference;
  const returnDetail = {
    provider,
    reference,
    railTxnId: payload.railTxnId ?? null,
    amount: payload.amount ?? null,
    currency: payload.currency ?? null,
    reason: payload.reason ?? null,
    receivedAt: new Date().toISOString(),
  };
  const reasonText = `Rail return (${provider}): ${payload.reason ?? "no reason given"}`.slice(0, 1000);

  // ── 1. BDC transaction? (rail reference on the payment leg / idem key) ──
  const bdcRows = (await db.execute(sql`
    SELECT id, tenant_id AS "tenantId", status
    FROM bdc_transactions
    WHERE payment_leg->>'mojaloopTransferId' = ${reference}
       OR payment_leg->>'partnerReference' = ${reference}
       OR idempotency_key = ${reference}
    LIMIT 1
  `)) as unknown as Array<{ id: number; tenantId: number; status: string }>;
  const bdcTxn = bdcRows[0];

  if (bdcTxn) {
    if (bdcTxn.status === "posted") {
      // 'posted' (not yet settled) cannot be auto-executed — the reversal
      // execution flip requires 'settled' (reversals.ts). Park it as a
      // MANUAL-review row ('requested') + ops alert instead of a stuck
      // 'approved' row (adversarial-verify LOW-3).
      const [existingReq] = await db
        .select({ id: bdcReversals.id })
        .from(bdcReversals)
        .where(
          and(
            eq(bdcReversals.tenantId, bdcTxn.tenantId),
            eq(bdcReversals.txnId, bdcTxn.id),
            eq(bdcReversals.reversalType, "rail_return"),
          ),
        )
        .limit(1);
      if (!existingReq) {
        await db.insert(bdcReversals).values({
          tenantId: bdcTxn.tenantId,
          txnId: bdcTxn.id,
          reversalType: "rail_return",
          status: "requested",
          reason: `Rail return received while txn 'posted' (not settled) — manual review required. Rail ref ${reference}; reason: ${reason ?? "unspecified"}`.slice(0, 900),
          railReference: reference,
          requestedBy: PLATFORM_SYSTEM_USER_ID,
        });
      }
      logger.warn(
        { txnId: bdcTxn.id, tenantId: bdcTxn.tenantId, reference },
        "[RailReturn] BDC txn 'posted' — reversal parked for manual review (not auto-executed)",
      );
      res.status(200).json({ received: true, disposition: "manual_review" });
      return;
    }
    if (bdcTxn.status === "settled") {
      // Idempotency: an open or posted rail_return reversal for this txn wins.
      const [existing] = await db
        .select({ id: bdcReversals.id, status: bdcReversals.status })
        .from(bdcReversals)
        .where(
          and(
            eq(bdcReversals.tenantId, bdcTxn.tenantId),
            eq(bdcReversals.txnId, bdcTxn.id),
            eq(bdcReversals.reversalType, "rail_return"),
            sql`${bdcReversals.status} IN ('requested', 'approved', 'posted')`,
          ),
        )
        .limit(1);

      let reversalId: number;
      if (existing) {
        reversalId = existing.id;
        if (existing.status === "posted") {
          return { matched: true, target: "bdc", outcome: "already_posted" };
        }
      } else {
        const [row] = await db
          .insert(bdcReversals)
          .values({
            tenantId: bdcTxn.tenantId,
            txnId: bdcTxn.id,
            reversalType: "rail_return",
            status: "approved", // rail-initiated: no human checker — system actor
            reason: reasonText,
            railReference,
            requestedBy: PLATFORM_SYSTEM_USER_ID,
            approvedBy: PLATFORM_SYSTEM_USER_ID,
          })
          .returning({ id: bdcReversals.id });
        reversalId = row.id;
      }

      try {
        const execution = await executeApprovedReversal(reversalId, PLATFORM_SYSTEM_USER_ID);
        await publishRailReturnAlert(`bdc-reversal:${bdcTxn.tenantId}:${reversalId}:rail_return:${execution.status}`, {
          eventType: execution.status === "failed" ? "bdc.reversal.failed" : "bdc.reversal.posted",
          reversalId,
          tenantId: bdcTxn.tenantId,
          transactionId: bdcTxn.id,
          reversalType: "rail_return",
          railReference,
          provider,
          failureReason: execution.failureReason ?? null,
        });
        return { matched: true, target: "bdc", outcome: execution.status };
      } catch (err) {
        // Honest: the reversal row stays 'approved' — the Temporal watchdog
        // alerts on approved-stuck > 24h. Log loudly; still ack the webhook.
        logger.error(
          { err: err instanceof Error ? err.message : String(err), reversalId, bdcTxnId: bdcTxn.id, provider, reference },
          "[RailReturn Webhook] BDC rail-return execution failed — reversal stays 'approved' for watchdog/ops",
        );
        return { matched: true, target: "bdc", outcome: "execution_failed" };
      }
    }

    // Terminal or otherwise non-reversible BDC txn — annotate nothing, alert
    // ops (money came back for a txn we consider closed; recon must handle).
    await publishRailReturnAlert(`rail-return:${provider}:${railReference}:bdc_terminal`, {
      eventType: "bdc.rail_return.unmatched_state",
      tenantId: bdcTxn.tenantId,
      transactionId: bdcTxn.id,
      txnStatus: bdcTxn.status,
      provider,
      railReference,
      detail: returnDetail,
      note: "Rail return received for a non-settled/non-posted BDC transaction — no auto action, ops reconcile",
    });
    return { matched: true, target: "bdc", outcome: `txn_${bdcTxn.status}_alerted` };
  }

  // ── 2. Platform transfer? (partnerReference / tx_ref in metadata) ────────
  const platformRows = (await db.execute(sql`
    SELECT id, reference, status, metadata
    FROM transactions
    WHERE metadata->>'partnerReference' = ${reference}
       OR metadata->>'tx_ref' = ${reference}
    LIMIT 1
  `)) as unknown as Array<{ id: number; reference: string; status: string; metadata: Record<string, unknown> | null }>;
  const platformTxn = platformRows[0];

  if (!platformTxn) {
    logger.warn({ provider, reference, railReference }, "[RailReturn Webhook] No matching BDC txn or platform transfer");
    return { matched: false };
  }

  // Guarded flip to 'failed' ONLY from a non-terminal state. We do NOT invent
  // a refund flow — the railReturn annotation + ops alert is the honest record.
  const flipped = (await db.execute(sql`
    UPDATE transactions
    SET status = 'failed', "updatedAt" = NOW()
    WHERE id = ${platformTxn.id}
      AND status NOT IN ('completed', 'failed', 'cancelled', 'reversed')
    RETURNING id
  `)) as unknown as Array<{ id: number }>;

  await db
    .update(transactions)
    .set({
      metadata: { ...(platformTxn.metadata ?? {}), railReturn: returnDetail },
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, platformTxn.id));

  const flippedToFailed = flipped.length === 1;
  await publishRailReturnAlert(`rail-return:${provider}:${railReference}:platform`, {
    eventType: "platform.rail_return.received",
    provider,
    railReference,
    transferId: platformTxn.id,
    transferReference: platformTxn.reference,
    previousStatus: platformTxn.status,
    flippedToFailed,
    detail: returnDetail,
    note: flippedToFailed
      ? "Non-terminal transfer marked 'failed' on rail return — ops to reconcile funds"
      : `Transfer already terminal ('${platformTxn.status}') — metadata.railReturn recorded, ops to reconcile funds`,
  });

  await createAuditLog({
    userId: PLATFORM_SYSTEM_USER_ID,
    action: "RAIL_RETURN_RECEIVED",
    description: `Rail return (${provider}) for transfer ${platformTxn.reference} (ref: ${reference}) — ${flippedToFailed ? "marked failed" : `already terminal '${platformTxn.status}'`}`,
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[RailReturn Webhook] audit log failed (non-blocking)"),
  );

  logger.warn(
    { provider, reference, transferId: platformTxn.id, flippedToFailed, previousStatus: platformTxn.status },
    "[RailReturn Webhook] Platform transfer rail return recorded",
  );
  return { matched: true, target: "platform", outcome: flippedToFailed ? "failed" : "terminal_alerted" };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function handleRailReturn(provider: "nip" | "mobilemoney") {
  return async (req: Request, res: Response): Promise<void> => {
    // HMAC signature verification (fail-closed when the secret is unset).
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature(provider, rawBody, req.headers as Record<string, string>)) {
      logger.warn({ ip: req.ip, provider }, "[RailReturn Webhook] Invalid HMAC signature");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const payload = req.body as RailReturnPayload;
    if (!payload?.reference || typeof payload.reference !== "string") {
      res.status(400).json({ error: "Missing reference" });
      return;
    }

    // Deduplication (24h window) — rail retries are acked without reprocessing.
    const dedupeId = payload.railTxnId ?? payload.reference;
    if (isWebhookDuplicate(provider, dedupeId)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    logger.info(
      { provider, reference: payload.reference, railTxnId: payload.railTxnId, reason: payload.reason },
      "[RailReturn Webhook] Received rail return",
    );

    try {
      const result = await processRailReturn(provider, payload);
      res.status(200).json({ received: true, ...result });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), provider, reference: payload.reference },
        "[RailReturn Webhook] Error processing rail return",
      );
      // 503 so the rail retries later — nothing was recorded, fail closed.
      res.status(503).json({ error: "Rail return processing unavailable — retry later" });
    }
  };
}

// ─── Registration (ORCH calls after express.json(), beside
//    registerPaymentRailWebhooks) ─────────────────────────────────────────────

export function registerRailReturnWebhooks(app: Express): void {
  app.use("/api/webhooks/nip", webhookRateLimiter);
  app.use("/api/webhooks/mobilemoney", webhookRateLimiter);

  app.post("/api/webhooks/nip/return", handleRailReturn("nip"));
  app.post("/api/webhooks/mobilemoney/return", handleRailReturn("mobilemoney"));

  logger.info(
    "[RailReturn] Webhook handlers registered (rate-limited: %d/min) at /api/webhooks/{nip,mobilemoney}/return",
    WEBHOOK_RATE_LIMIT,
  );
}
