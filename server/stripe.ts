import Stripe from "stripe";
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
