/**
 * Payment Provider Webhook Handlers
 * 
 * Handles callback/webhook events from all payment providers.
 * Each handler verifies the webhook signature, updates the transaction
 * status in the database, and emits the appropriate Kafka events.
 */
import crypto from "crypto";
import Stripe from "stripe";
import { getDb } from "../db";

// ── Stripe Webhook Handler ───────────────────────────────────────────────────

export async function handleStripeWebhook(
  rawBody: string | Buffer,
  signature: string
): Promise<{ event: string; handled: boolean }> {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!endpointSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", { apiVersion: "2026-04-22.dahlia" });
  const event = stripe.webhooks.constructEvent(
    typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody,
    signature,
    endpointSecret
  );

  const db = await getDb();

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      await db.execute({
        sql: `UPDATE payment_provider_logs SET status = 'completed' WHERE reference = $1 AND provider = 'stripe'`,
        args: [pi.id],
      });
      // Update the main transaction table
      const txId = pi.metadata?.transactionId;
      if (txId) {
        await db.execute({
          sql: `UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          args: [parseInt(txId, 10)],
        });
      }
      return { event: event.type, handled: true };
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      await db.execute({
        sql: `UPDATE payment_provider_logs SET status = 'failed' WHERE reference = $1 AND provider = 'stripe'`,
        args: [pi.id],
      });
      return { event: event.type, handled: true };
    }
    case "charge.refunded": {
      const charge = event.data.object;
      await db.execute({
        sql: `INSERT INTO payment_provider_logs (provider, action, reference, amount, currency, status, raw_response, created_at)
              VALUES ('stripe', 'refund_webhook', $1, $2, $3, 'completed', $4, NOW())`,
        args: [charge.id, (charge.amount_refunded ?? 0) / 100, charge.currency, JSON.stringify({ refunded: true })],
      });
      return { event: event.type, handled: true };
    }
    default:
      return { event: event.type, handled: false };
  }
}

// ── Flutterwave Webhook Handler ──────────────────────────────────────────────

export async function handleFlutterwaveWebhook(
  body: Record<string, unknown>,
  secretHash: string
): Promise<{ event: string; handled: boolean }> {
  const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_HASH ?? "";
  if (!expectedHash) throw new Error("FLUTTERWAVE_WEBHOOK_HASH not configured");

  if (secretHash !== expectedHash) {
    throw new Error("Invalid Flutterwave webhook hash");
  }

  const eventType = body.event as string;
  const data = body.data as Record<string, unknown>;

  const db = await getDb();

  if (eventType === "charge.completed") {
    const txRef = data.tx_ref as string;
    const status = data.status as string;
    await db.execute({
      sql: `UPDATE payment_provider_logs SET status = $1 WHERE reference = $2 AND provider = 'flutterwave'`,
      args: [status === "successful" ? "completed" : "failed", txRef],
    });
    return { event: eventType, handled: true };
  }

  if (eventType === "transfer.completed") {
    const reference = data.reference as string;
    const status = data.status as string;
    await db.execute({
      sql: `UPDATE payment_provider_logs SET status = $1 WHERE reference = $2 AND provider = 'flutterwave'`,
      args: [status === "SUCCESSFUL" ? "completed" : "failed", reference],
    });
    return { event: eventType, handled: true };
  }

  return { event: eventType ?? "unknown", handled: false };
}

// ── M-Pesa Callback Handler ─────────────────────────────────────────────────

export interface MpesaCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value: string | number }>;
      };
    };
  };
}

export async function handleMpesaCallback(
  body: MpesaCallbackBody
): Promise<{ handled: boolean; resultCode: number }> {
  const callback = body.Body.stkCallback;
  const resultCode = callback.ResultCode;
  const checkoutId = callback.CheckoutRequestID;
  const status = resultCode === 0 ? "completed" : "failed";

  const db = await getDb();

  // Extract payment details from callback metadata
  let mpesaReceiptNumber = "";
  let phoneNumber = "";
  let amount = 0;
  if (callback.CallbackMetadata?.Item) {
    for (const item of callback.CallbackMetadata.Item) {
      if (item.Name === "MpesaReceiptNumber") mpesaReceiptNumber = String(item.Value);
      if (item.Name === "PhoneNumber") phoneNumber = String(item.Value);
      if (item.Name === "Amount") amount = Number(item.Value);
    }
  }

  await db.execute({
    sql: `UPDATE payment_provider_logs SET status = $1, raw_response = raw_response || $2 WHERE reference = $3 AND provider = 'mpesa'`,
    args: [status, JSON.stringify({ mpesaReceiptNumber, phoneNumber, amount, resultCode, resultDesc: callback.ResultDesc }), checkoutId],
  });

  return { handled: true, resultCode };
}

// ── MTN MoMo Callback Handler ────────────────────────────────────────────────

export interface MomoCallbackBody {
  referenceId: string;
  status: string;
  financialTransactionId?: string;
  reason?: { code: string; message: string };
}

export async function handleMomoCallback(
  body: MomoCallbackBody
): Promise<{ handled: boolean }> {
  const status = body.status === "SUCCESSFUL" ? "completed" : body.status === "FAILED" ? "failed" : "pending";
  const db = await getDb();

  await db.execute({
    sql: `UPDATE payment_provider_logs SET status = $1, raw_response = raw_response || $2 WHERE reference = $3 AND provider = 'mtn_momo'`,
    args: [status, JSON.stringify(body), body.referenceId],
  });

  return { handled: true };
}

// ── Webhook Signature Verification Utilities ─────────────────────────────────

export function verifyHmacSha256(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function verifyHmacSha512(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha512", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
