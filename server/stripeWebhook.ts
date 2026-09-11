import { Express, Request, Response } from "express";
import express from "express";
import { getStripe } from "./stripe";
import { getDb } from "./db";
import {
  wallets,
  transactions,
  investmentAssets,
  investmentOrders,
  userInvestments,
  users,
  tenants,
  idempotencyKeys,
} from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { resolveTenantContext } from "./tenantMiddleware";
import { broadcastUserEvent } from "./sse.service";
import { notifyOwner } from "./_core/notification";
import { sendPushToUser } from "./pushNotifications";
import { ENV } from "./_core/env";
import { logger } from './_core/logger';
import { safeParseAmount } from "./lib/safeDecimal";
import { auditCoreOperation } from "./middleware/coreAtomicity";
import { KAFKA_TOPICS } from "./middleware/kafka";
import { processFundingWebhook } from "./routers/cardFunding";

// ─── Transactional email helper (Resend) ──────────────────────────────────────
async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = ENV.resendApiKey;
  if (!apiKey) {
    logger.info("[Email] Resend API key not configured — skipping email");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: ENV.resendFromEmail,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.warn(`[Email] Resend error ${res.status}: ${detail}`);
      return false;
    }
    logger.info(`[Email] Sent "${opts.subject}" to ${opts.to}`);
    return true;
  } catch (err: any) {
    logger.warn("[Email] Failed to send:", err?.message);
    return false;
  }
}

// ─── Email templates ──────────────────────────────────────────────────────────
function walletTopupEmailHtml(opts: {
  userName: string;
  amount: number;
  currency: string;
  method: string;
  sessionId: string;
  appUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Wallet Top-up Confirmed</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #059669, #0d9488); padding: 32px 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 22px;">✅ Top-up Successful</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Your RemitFlow wallet has been credited</p>
    </div>
    <div style="padding: 24px;">
      <p style="color: #374151; font-size: 15px;">Hi ${opts.userName},</p>
      <p style="color: #374151; font-size: 15px;">Your wallet top-up was successful!</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
        <div style="font-size: 32px; font-weight: 700; color: #059669;">${opts.currency} ${opts.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
        <div style="color: #6b7280; font-size: 13px; margin-top: 4px;">Added via ${opts.method}</div>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #374151;">
        <tr><td style="padding: 6px 0; color: #6b7280;">Transaction ID</td><td style="padding: 6px 0; text-align: right; font-family: monospace;">${opts.sessionId.slice(0, 20)}…</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Date</td><td style="padding: 6px 0; text-align: right;">${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}</td></tr>
      </table>
      <a href="${opts.appUrl}/wallet" style="display: block; background: #059669; color: white; text-decoration: none; text-align: center; padding: 12px; border-radius: 8px; font-weight: 600; margin-top: 20px;">View My Wallet →</a>
    </div>
    <div style="padding: 16px 24px; background: #f9fafb; text-align: center; font-size: 12px; color: #9ca3af;">
      RemitFlow — Cross-Border Remittance Platform<br>
      <a href="${opts.appUrl}" style="color: #059669; text-decoration: none;">${opts.appUrl}</a>
    </div>
  </div>
</body>
</html>`;
}

function transferEmailHtml(opts: {
  userName: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  recipientName: string;
  reference: string;
  appUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Transfer Sent</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 32px 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 22px;">💸 Transfer Sent</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Your transfer is on its way</p>
    </div>
    <div style="padding: 24px;">
      <p style="color: #374151; font-size: 15px;">Hi ${opts.userName},</p>
      <p style="color: #374151; font-size: 15px;">Your transfer to <strong>${opts.recipientName}</strong> has been sent successfully.</p>
      <div style="background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
        <div style="font-size: 28px; font-weight: 700; color: #4f46e5;">${opts.fromCurrency} ${opts.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
        <div style="color: #6b7280; font-size: 13px; margin-top: 4px;">→ ${opts.toCurrency} • To: ${opts.recipientName}</div>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #374151;">
        <tr><td style="padding: 6px 0; color: #6b7280;">Reference</td><td style="padding: 6px 0; text-align: right; font-family: monospace;">${opts.reference}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Date</td><td style="padding: 6px 0; text-align: right;">${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}</td></tr>
      </table>
      <a href="${opts.appUrl}/transactions" style="display: block; background: #4f46e5; color: white; text-decoration: none; text-align: center; padding: 12px; border-radius: 8px; font-weight: 600; margin-top: 20px;">View Transaction →</a>
    </div>
    <div style="padding: 16px 24px; background: #f9fafb; text-align: center; font-size: 12px; color: #9ca3af;">
      RemitFlow — Cross-Border Remittance Platform<br>
      <a href="${opts.appUrl}" style="color: #4f46e5; text-decoration: none;">${opts.appUrl}</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── Stripe IP Allowlist (published at https://stripe.com/docs/ips) ─────────────
// These are Stripe's webhook source IPs as of 2025. Update periodically.
const STRIPE_WEBHOOK_IPS = [
  "3.18.12.63", "3.130.192.231", "13.235.14.237", "13.235.122.149",
  "18.211.135.69", "35.154.171.200", "52.15.183.38", "54.88.130.119",
  "54.88.130.237", "54.187.174.169", "54.187.205.235", "54.187.216.72",
  // Allow in development / behind proxies
  "127.0.0.1", "::1", "::ffff:127.0.0.1",
];

function isStripeIP(req: Request): boolean {
  // In production behind a load balancer, use x-forwarded-for
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ?? req.socket.remoteAddress ?? "";
  // Skip IP check in development (NODE_ENV !== production) or if STRIPE_SKIP_IP_CHECK is set
  if (process.env.NODE_ENV !== "production" || process.env.STRIPE_SKIP_IP_CHECK === "1") return true;
  return STRIPE_WEBHOOK_IPS.includes(ip);
}

// ─── Stripe Webhook Handler ───────────────────────────────────────────────────
export function registerStripeWebhook(app: Express) {
  // Raw body parser MUST be before json() for Stripe signature verification
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      // Security: Stripe IP allowlist check (production only)
      if (!isStripeIP(req)) {
        logger.warn(`[Stripe Webhook] Rejected request from non-Stripe IP: ${req.socket.remoteAddress}`);
        return res.status(403).json({ error: "Forbidden: IP not in Stripe allowlist" });
      }
      const stripe = getStripe();
      const sig = req.headers["stripe-signature"] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        logger.error({ err: err.message }, '[Stripe Webhook] Signature verification failed:');
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
      }

      // Handle test events
      if (event.id.startsWith("evt_test_")) {
        logger.info("[Stripe Webhook] Test event detected, returning verification response");
        return res.json({ verified: true });
      }

      logger.info(`[Stripe Webhook] Event: ${event.type} | ID: ${event.id} | ${new Date().toISOString()}`);

      // ── Idempotency: skip already-processed events ──────────────────────
      // W9/F14-1 ordering fix: the event is only MARKED processed AFTER the
      // business writes below succeed. The old order (mark first) meant a
      // mid-handler failure left money collected with no audit trail AND the
      // event recorded as processed, so Stripe never retried — fail closed
      // instead: business inserts throw → event stays unprocessed → Stripe
      // retries delivery.
      //
      // H1 fix: this SELECT is now only a FAST PATH. The correctness boundary
      // for money-moving events (checkout.session.completed → top-up credit /
      // investment fulfillment) is the atomic INSERT-guard INSIDE the credit
      // db.transaction below (idempotencyGuardedTx): the guard row carries
      // NON-NULL tenant_id + user_id, so the unique index
      // idempotencyKeys_tenant_user_operation_key_uidx actually conflicts on
      // replay (the old markEventProcessed inserted NULL tenant/user — NULLs
      // never conflict, so the "unique backstop" was void).
      const db0 = await getDb();
      if (db0) {
        const existing = await db0
          .select({ id: idempotencyKeys.id })
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.key, event.id))
          .limit(1);
        if (existing.length > 0) {
          logger.info(`[Stripe Webhook] Duplicate event skipped: ${event.id}`);
          return res.json({ received: true, duplicate: true });
        }
      }
      // Tracks whether the atomic in-tx guard row was inserted for this event
      // (checkout.session.completed with a resolvable user). When it was, the
      // guard row IS the processed marker and markEventProcessed must not run.
      let guardInserted = false;
      // Best-effort processed marker for NON-money events and terminal
      // non-retryable conditions (e.g. checkout session without a userId).
      // ON CONFLICT DO NOTHING makes it no-op-safe on replay; when a non-null
      // tenant/user is supplied the unique index gives a real backstop.
      const markEventProcessed = async (opts: { userId?: number; tenantId?: number } = {}): Promise<void> => {
        if (!db0) return;
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
        try {
          await db0.execute(sql`
            INSERT INTO idempotency_keys (key, tenant_id, user_id, operation, response_status, expires_at)
            VALUES (${event.id}, ${opts.tenantId ?? null}, ${opts.userId ?? null}, ${`stripe_webhook:${event.type}`}, 200, ${expiresAt})
            -- The unique index is PARTIAL (0078_durable_tenant_idempotency.sql:
            -- WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL); Postgres
            -- arbiter inference throws 42P10 without the matching predicate
            -- (precedent: middleware/durableIdempotency.ts:94).
            ON CONFLICT (tenant_id, user_id, operation, key) WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL DO NOTHING
          `);
        } catch {
          // A concurrent delivery already recorded the event — just log it.
          logger.info(`[Stripe Webhook] Race condition on idempotency insert: ${event.id}`);
        }
      };

      try {
        // ── checkout.session.completed ──────────────────────────────────────
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as any;
          const orderType = session.metadata?.order_type ?? "topup";
          const userId = parseInt(session.client_reference_id ?? session.metadata?.user_id ?? "0");

          if (!userId) {
            logger.warn("[Stripe Webhook] checkout.session.completed: no userId in metadata");
            // Terminal, non-retryable condition (no user to credit) — mark
            // processed so Stripe does not retry this event forever.
            await markEventProcessed();
            return res.json({ received: true });
          }

          const db = await getDb();
          if (!db) {
            logger.error("[Stripe Webhook] DB unavailable");
            return res.status(500).json({ error: "DB unavailable" });
          }

          // Fetch user info for notifications
          const [userRow] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
          const userName = userRow?.name ?? "User";
          const userEmail = userRow?.email;

          // H1: resolve a NON-NULL tenant BEFORE the tx (existing tenant
          // pattern: users-row tenantId via resolveTenantContext, falling back
          // to the 'remitflow-default' tenant slug). The unique backstop index
          // idempotencyKeys_tenant_user_operation_key_uidx is on
          // (tenant_id, user_id, operation, key) — NULL tenant_id never
          // conflicts, so crediting without a resolved tenant would have NO
          // replay protection. Fail closed instead.
          const tenantCtx = await resolveTenantContext(userId);
          let tenantId: number | null = tenantCtx.tenantId;
          if (tenantId == null) {
            const [defTenant] = await db
              .select({ id: tenants.id })
              .from(tenants)
              .where(eq(tenants.slug, "remitflow-default"))
              .limit(1);
            tenantId = defTenant?.id ?? null;
          }
          if (tenantId == null) {
            logger.error("[Stripe Webhook] No tenant resolvable — refusing to credit without an idempotency backstop");
            return res.status(500).json({ error: "Tenant context unavailable" });
          }

          // H1: atomic idempotency guard + business writes in ONE db.transaction.
          // The INSERT-guard runs FIRST inside the tx; on replay (or a
          // concurrent duplicate delivery) ON CONFLICT DO NOTHING returns 0
          // rows → we skip every business write and report the duplicate. If
          // any business write throws, the whole tx (guard row included) rolls
          // back → the event stays unprocessed → Stripe retries → fail closed.
          let guardDuplicate = false;
          const idempotencyGuardedTx = async (fn: (tx: any) => Promise<void>): Promise<void> => {
            await db.transaction(async (tx: any) => {
              const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
              const guardRes = (await tx.execute(sql`
                INSERT INTO idempotency_keys (key, tenant_id, user_id, operation, response_status, expires_at)
                VALUES (${event.id}, ${tenantId}, ${userId}, ${`stripe_webhook:${event.type}`}, 200, ${expiresAt})
                -- PARTIAL unique index (0078: WHERE tenant_id IS NOT NULL AND
                -- user_id IS NOT NULL) — arbiter inference needs the matching
                -- predicate or Postgres throws 42P10 (durableIdempotency.ts:94
                -- precedent). tenantId/userId are guaranteed non-null above.
                ON CONFLICT (tenant_id, user_id, operation, key) WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL DO NOTHING
                RETURNING id
              `)) as any;
              const guardRows = guardRes?.rows ?? guardRes ?? [];
              if (!Array.isArray(guardRows) || guardRows.length === 0) {
                guardDuplicate = true;
                return;
              }
              guardInserted = true;
              await fn(tx);
            });
          };

          // ── Investment purchase fulfillment ──────────────────────────────
          if (orderType === "investment_buy") {
            const assetId = parseInt(session.metadata?.asset_id ?? "0");
            const quantity = safeParseAmount(session.metadata?.quantity ?? "0");
            const priceAtOrder = safeParseAmount(session.metadata?.price_at_order ?? "0");
            const currency = session.metadata?.currency ?? "USD";
            const amountPaid = (session.amount_total ?? 0) / 100;

            if (assetId && quantity > 0) {
              const [asset] = await db
                .select()
                .from(investmentAssets)
                .where(eq(investmentAssets.id, assetId))
                .limit(1);

              if (asset) {
                const fee = Math.max(0, amountPaid - priceAtOrder * quantity);

                // H1: same atomic-guard treatment as the top-up branch — the
                // guard row + ALL fulfillment inserts commit or roll back
                // together. One guard row per event id covers both branches
                // (a session is exactly one order_type).
                await idempotencyGuardedTx(async (tx) => {
                  await tx.insert(investmentOrders).values({
                    userId,
                    assetId,
                    orderType: "buy",
                    quantity: quantity.toString(),
                    priceAtOrder: priceAtOrder.toString(),
                    totalAmount: (priceAtOrder * quantity).toString(),
                    currency,
                    status: "completed",
                    fee: fee.toFixed(6),
                    stripeSessionId: session.id,
                  } as any);

                  await tx.insert(userInvestments).values({
                    userId,
                    assetId,
                    quantity: quantity.toString(),
                    purchasePrice: priceAtOrder.toString(),
                    currency,
                    status: "active",
                    purchasedAt: new Date(),
                  } as any);

                  await tx.insert(transactions).values({
                    userId,
                    // W9/F14-1: "investment_buy" is NOT a member of the tx_type
                    // pg enum (drizzle/schema.ts txTypeEnum — verified; there is
                    // no shared/txnEnums.ts in this tree). Postgres rejected this
                    // insert AFTER the event was marked processed — money
                    // collected, audit trail absent, retry skipped. "withdrawal"
                    // is the enum-valid honest money-out direction; the rail and
                    // original semantic are preserved in description + metadata.
                    type: "withdrawal",
                    status: "completed",
                    fromCurrency: currency,
                    fromAmount: amountPaid.toString(),
                    toCurrency: currency,
                    toAmount: amountPaid.toString(),
                    fee: fee.toFixed(6),
                    description: `Investment buy: ${quantity} ${asset.symbol} @ $${priceAtOrder} | Stripe: ${session.id}`,
                    reference: `INV_${asset.symbol}_${session.id}`,
                    metadata: { rail: "stripe", semanticType: "investment_buy", assetId, symbol: asset.symbol, quantity, stripeSessionId: session.id },
                  } as any);
                });

                if (guardDuplicate) {
                  logger.info(`[Stripe Webhook] Duplicate investment event skipped: ${event.id}`);
                  return res.json({ received: true, duplicate: true });
                }

                // SSE real-time notification — warn-soft: a post-commit throw
                // must never become a 500 → Stripe retry → reprocessing path.
                try {
                  broadcastUserEvent(userId, {
                    type: "transfer_received",
                    payload: {
                      title: "Investment Purchase Confirmed",
                      message: `Successfully bought ${quantity} ${asset.symbol} for ${currency} ${amountPaid.toFixed(2)} via Stripe`,
                      amount: amountPaid,
                      currency,
                    },
                  });
                } catch (sseErr: any) {
                  logger.warn("[Stripe Webhook] Investment SSE broadcast failed (non-critical):", sseErr?.message);
                }

                logger.info(`[Stripe Webhook] Investment fulfilled: user=${userId} asset=${asset.symbol} qty=${quantity} price=${priceAtOrder}`);
              }
            }
          } else {
             // ── Wallet top-up fulfillment ──────────────────────────────────
            const walletCurrency = session.metadata?.wallet_currency ?? "USD";
            const amountPaid = (session.amount_total ?? 0) / 100;
            if (amountPaid > 0) {
              // H1: the idempotency INSERT-guard runs FIRST inside the SAME
              // db.transaction as the credit — the guard is atomic with the
              // money movement (the old SELECT pre-check + post-hoc NULL-keyed
              // markEventProcessed had no atomicity and no unique backstop).
              await idempotencyGuardedTx(async (tx: any) => {
                // M1-residual: wallets has NO unique constraint on
                // (userId, currency) and schema changes to existing tables are
                // forbidden — concurrent first-time credits would both see 0
                // UPDATE rows and both INSERT (duplicate wallets, split funds).
                // Serialize per-wallet-identity creators with a
                // transaction-scoped advisory lock BEFORE update/insert.
                // hashtextextended(text, bigint) is a built-in PG10+ function.
                await tx.execute(sql`
                  SELECT pg_advisory_xact_lock(hashtextextended(${'wallet:' + String(userId) + ':' + walletCurrency}, 42))
                `);
                // H1-residual: RELATIVE guarded credit (balance = balance + x)
                // — the old absolute read-modify-write (read balance in app,
                // SET balance = computed) lost concurrent top-ups' value.
                const creditRows = (await tx.execute(sql`
                  UPDATE wallets
                  SET balance = balance + ${amountPaid},
                      "updatedAt" = NOW(),
                      version = version + 1
                  WHERE "userId" = ${userId}
                    AND currency = ${walletCurrency}
                  RETURNING id
                `)) as unknown as Array<{ id: number }>;
                if (creditRows.length === 0) {
                  // No wallet row yet — the advisory lock above guarantees we
                  // are the ONLY first-time creator for this user+currency.
                  await tx.insert(wallets).values({
                    userId,
                    currency: walletCurrency,
                    balance: amountPaid.toFixed(2),
                    isDefault: false,
                  } as any);
                }
                await tx.insert(transactions).values({
                  userId,
                  type: "topup",
                  status: "completed",
                  fromCurrency: walletCurrency,
                  fromAmount: amountPaid.toString(),
                  toCurrency: walletCurrency,
                  toAmount: amountPaid.toString(),
                  fee: "0",
                  description: `Stripe card top-up | Session: ${session.id}`,
                  reference: `STRIPE_${session.id}`,
                } as any);
              });

              if (guardDuplicate) {
                logger.info(`[Stripe Webhook] Duplicate top-up event skipped: ${event.id}`);
                return res.json({ received: true, duplicate: true });
              }

              // Ledger + event backing for the top-up: record the funds entering
              // the platform in TigerBeetle (double-entry) and publish to Kafka so
              // the wallet credit is reconcilable, not just a bare balance mutation.
              await auditCoreOperation({
                userId,
                action: "wallet.topup",
                description: `Stripe card top-up: ${amountPaid} ${walletCurrency}`,
                amount: amountPaid,
                currency: walletCurrency,
                featureLabel: "stripe_wallet_topup",
                operationRef: `STRIPE_${session.id}`,
                kafkaTopic: KAFKA_TOPICS.TRANSACTIONS,
                metadata: { source: "stripe", sessionId: session.id, type: "topup" },
              }).catch((err) =>
                logger.warn({ err: err?.message, sessionId: session.id }, "[Stripe Webhook] Top-up ledger/event recording failed")
              );

              // SSE real-time notification — warn-soft: a post-commit throw
              // here must NEVER surface as a 500 → Stripe retry → the credit
              // path runs again (it is guarded, but the retry noise/alerts are
              // avoidable; correctness never depends on SSE).
              try {
                broadcastUserEvent(userId, {
                  type: "transfer_received",
                  payload: {
                    title: "Wallet Top-up Successful",
                    message: `Your ${walletCurrency} wallet has been credited with ${walletCurrency} ${amountPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })} via Stripe`,
                    amount: amountPaid,
                    currency: walletCurrency,
                  },
                });
              } catch (sseErr: any) {
                logger.warn("[Stripe Webhook] Top-up SSE broadcast failed (non-critical):", sseErr?.message);
              }

              // Email notification (non-blocking)
              if (userEmail) {
                sendTransactionalEmail({
                  to: userEmail,
                  subject: `✅ RemitFlow: ${walletCurrency} ${amountPaid.toFixed(2)} added to your wallet`,
                  html: walletTopupEmailHtml({
                    userName,
                    amount: amountPaid,
                    currency: walletCurrency,
                    method: "Stripe Card",
                    sessionId: session.id,
                    appUrl: ENV.appUrl,
                  }),
                }).catch(err => logger.warn("[Email] Top-up email failed:", err?.message));
              }

              // Owner notification for large top-ups (>$1000)
              if (amountPaid >= 1000) {
                notifyOwner({
                  title: `Large Stripe Top-up: ${walletCurrency} ${amountPaid.toFixed(2)}`,
                  content: `User ${userId} (${userEmail ?? "unknown"}) topped up ${walletCurrency} ${amountPaid.toFixed(2)} via Stripe. Session: ${session.id}`,
                }).catch(() => {});
              }

              // Push notification (non-blocking)
              sendPushToUser(userId, {
                title: "\uD83D\uDCB0 Wallet Credited",
                body: `${walletCurrency} ${amountPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })} has been added to your RemitFlow wallet.`,
                url: "/wallet",
              }).catch((err: any) => logger.warn("[Push] Wallet credit push failed:", err?.message));
              logger.info(`[Stripe Webhook] Wallet credited: user=${userId} amount=${amountPaid} ${walletCurrency}`);
            }
          }
        }

        // ── W10 card funding: payment_intent.* lifecycle ──────────────────
        // Drives cardFundingIntents (capture → chargeback hold; failure →
        // honest failed, no silent refund). Idempotent + guarded; returns
        // {handled:false} for intents it does not own. Throws only when the
        // DB is unavailable → outer catch → 500 → Stripe retries (fail closed).
        if (event.type.startsWith("payment_intent.")) {
          await processFundingWebhook(event);
        }

        // ── payment_intent.payment_failed ──────────────────────────────────
        if (event.type === "payment_intent.payment_failed") {
          const pi = event.data.object as any;
          const failureMsg = pi.last_payment_error?.message ?? "Unknown error";
          const userId = parseInt(pi.metadata?.user_id ?? "0");
          logger.warn(`[Stripe Webhook] Payment failed PI=${pi.id}: ${failureMsg}`);
          if (userId) {
            try {
              broadcastUserEvent(userId, {
                type: "notification",
                payload: {
                  title: "Payment Failed",
                  message: `Your Stripe payment could not be processed: ${failureMsg}`,
                },
              });
            } catch (sseErr: any) {
              logger.warn("[Stripe Webhook] Payment-failed SSE broadcast failed (non-critical):", sseErr?.message);
            }
          }
        }

        // ── charge.refunded ────────────────────────────────────────────────
        if (event.type === "charge.refunded") {
          const charge = event.data.object as any;
          const refundAmount = (charge.amount_refunded ?? 0) / 100;
          logger.info(`[Stripe Webhook] Refund processed: charge=${charge.id} amount=${refundAmount}`);
        }

        // ── Subscription lifecycle ─────────────────────────────────────────
        if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
          const sub = event.data.object as any;
          logger.info(`[Stripe Webhook] Subscription ${event.type}: sub=${sub.id} status=${sub.status}`);
        }

        if (event.type === "customer.subscription.deleted") {
          const sub = event.data.object as any;
          logger.info(`[Stripe Webhook] Subscription cancelled: sub=${sub.id}`);
        }

        // ── invoice.payment_succeeded ──────────────────────────────────────
        if (event.type === "invoice.payment_succeeded") {
          const invoice = event.data.object as any;
          logger.info(`[Stripe Webhook] Invoice paid: invoice=${invoice.id} amount=${(invoice.amount_paid ?? 0) / 100}`);
        }

      } catch (err) {
        // Fail closed: the event is deliberately NOT marked processed, so
        // Stripe retries the delivery and the business writes can complete.
        logger.error({ err: err }, '[Stripe Webhook] Processing error:');
        return res.status(500).json({ error: "Webhook processing failed" });
      }

      // All business writes succeeded — only NOW record the event as processed.
      // H1: when the atomic in-tx guard row was inserted (checkout.session.completed
      // with a resolvable user), that guard row IS the processed marker — do not
      // insert a second, NULL-keyed row (NULLs never conflict → void backstop).
      if (!guardInserted) {
        await markEventProcessed();
      }
      res.json({ received: true });
    }
  );
}

// Export email helpers for use in other modules
export { sendTransactionalEmail, walletTopupEmailHtml, transferEmailHtml };
