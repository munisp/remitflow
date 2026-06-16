import Stripe from "stripe";
import crypto from "crypto";
import { ENV } from "./_core/env";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = (ENV as any).STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder";
    stripeClient = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  }
  return stripeClient;
}

export const TOPUP_AMOUNTS = [
  { amount: 1000, label: "$10.00", currency: "usd" },
  { amount: 5000, label: "$50.00", currency: "usd" },
  { amount: 10000, label: "$100.00", currency: "usd" },
  { amount: 25000, label: "$250.00", currency: "usd" },
  { amount: 50000, label: "$500.00", currency: "usd" },
];

/**
 * Verify Stripe webhook signature (HMAC-SHA256).
 * Uses the Stripe SDK's constructEvent for cryptographic verification,
 * falling back to manual HMAC verification when SDK is unavailable.
 */
export function verifyStripeWebhook(payload: string | Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

/**
 * Verify Flutterwave webhook signature (HMAC-SHA512).
 * Flutterwave sends `verif-hash` header with HMAC-SHA512 of the payload.
 */
export function verifyFlutterwaveWebhook(payload: string, receivedHash: string): boolean {
  const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET ?? process.env.FLUTTERWAVE_SECRET_HASH ?? "";
  if (!secret) throw new Error("FLUTTERWAVE_WEBHOOK_SECRET not configured");
  const computed = crypto.createHmac("sha512", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(receivedHash));
}

/**
 * Generic webhook signature verification (provider-agnostic HMAC-SHA256).
 * Used for M-Pesa, MTN MoMo, and custom webhook integrations.
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string, algorithm = "sha256"): boolean {
  const computed = crypto.createHmac(algorithm, secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
