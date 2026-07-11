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
  idempotencyKeys,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { broadcastUserEvent } from "./sse.service";
import { notifyOwner } from "./_core/notification";
import { sendPushToUser } from "./pushNotifications";
import { ENV } from "./_core/env";
import { logger } from './_core/logger';
import { safeParseAmount } from "./lib/safeDecimal";
import { auditCoreOperation } from "./middleware/coreAtomicity";
import { KAFKA_TOPICS } from "./middleware/kafka";

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
        // Record this event as processed (expires in 72h)
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
        try {
          await db0.insert(idempotencyKeys).values({
            key: event.id,
            operation: `stripe_webhook:${event.type}`,
            responseStatus: 200,
            expiresAt,
          });
        } catch {
          // Unique constraint violation means concurrent request already inserted — skip
          logger.info(`[Stripe Webhook] Race condition on idempotency insert, skipping: ${event.id}`);
          return res.json({ received: true, duplicate: true });
        }
      }

      try {
        // ── checkout.session.completed ──────────────────────────────────────
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as any;
          const orderType = session.metadata?.order_type ?? "topup";
          const userId = parseInt(session.client_reference_id ?? session.metadata?.user_id ?? "0");

          if (!userId) {
            logger.warn("[Stripe Webhook] checkout.session.completed: no userId in metadata");
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

                await db.insert(investmentOrders).values({
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

                await db.insert(userInvestments).values({
                  userId,
                  assetId,
                  quantity: quantity.toString(),
                  purchasePrice: priceAtOrder.toString(),
                  currency,
                  status: "active",
                  purchasedAt: new Date(),
                } as any);

                await db.insert(transactions).values({
                  userId,
                  type: "investment_buy",
                  status: "completed",
                  fromCurrency: currency,
                  fromAmount: amountPaid.toString(),
                  toCurrency: currency,
                  toAmount: amountPaid.toString(),
                  fee: fee.toFixed(6),
                  description: `Investment: Buy ${quantity} ${asset.symbol} @ $${priceAtOrder} | Stripe: ${session.id}`,
                  reference: `INV_${asset.symbol}_${session.id}`,
                } as any);

                // SSE real-time notification
                broadcastUserEvent(userId, {
                  type: "transfer_received",
                  payload: {
                    title: "Investment Purchase Confirmed",
                    message: `Successfully bought ${quantity} ${asset.symbol} for ${currency} ${amountPaid.toFixed(2)} via Stripe`,
                    amount: amountPaid,
                    currency,
                  },
                });

                logger.info(`[Stripe Webhook] Investment fulfilled: user=${userId} asset=${asset.symbol} qty=${quantity} price=${priceAtOrder}`);
              }
            }
          } else {
             // ── Wallet top-up fulfillment ──────────────────────────────────
            const walletCurrency = session.metadata?.wallet_currency ?? "USD";
            const amountPaid = (session.amount_total ?? 0) / 100;
            if (amountPaid > 0) {
              // Atomic: balance update + transaction record in one DB transaction
              await db.transaction(async (tx: any) => {
                const walletRows = await tx
                  .select()
                  .from(wallets)
                  .where(and(eq(wallets.userId, userId), eq(wallets.currency, walletCurrency)))
                  .limit(1);
                if (walletRows.length > 0) {
                  const wallet = walletRows[0];
                  const newBalance = (Number(wallet.balance) + amountPaid).toFixed(2);
                  await tx.update(wallets).set({ balance: newBalance }).where(eq(wallets.id, wallet.id));
                } else {
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

              // SSE real-time notification
              broadcastUserEvent(userId, {
                type: "transfer_received",
                payload: {
                  title: "Wallet Top-up Successful",
                  message: `Your ${walletCurrency} wallet has been credited with ${walletCurrency} ${amountPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })} via Stripe`,
                  amount: amountPaid,
                  currency: walletCurrency,
                },
              });

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

        // ── payment_intent.payment_failed ──────────────────────────────────
        if (event.type === "payment_intent.payment_failed") {
          const pi = event.data.object as any;
          const failureMsg = pi.last_payment_error?.message ?? "Unknown error";
          const userId = parseInt(pi.metadata?.user_id ?? "0");
          logger.warn(`[Stripe Webhook] Payment failed PI=${pi.id}: ${failureMsg}`);
          if (userId) {
            broadcastUserEvent(userId, {
              type: "notification",
              payload: {
                title: "Payment Failed",
                message: `Your Stripe payment could not be processed: ${failureMsg}`,
              },
            });
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
        logger.error({ err: err }, '[Stripe Webhook] Processing error:');
        return res.status(500).json({ error: "Webhook processing failed" });
      }

      res.json({ received: true });
    }
  );
}

// Export email helpers for use in other modules
export { sendTransactionalEmail, walletTopupEmailHtml, transferEmailHtml };
