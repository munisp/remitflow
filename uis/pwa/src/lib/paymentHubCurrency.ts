/**
 * Payment Hub Currency Normalization
 *
 * Mojaloop / payment-hub transfers carry exactly one transfer currency — the
 * ISO 4217 code the quote was agreed in. Corridor forms collect a source and
 * a destination currency; this helper resolves which of them denominates the
 * transfer and normalizes it for the switch.
 *
 * Rules:
 *   - The destination (payee receive) currency wins when present and
 *     supported, since the hub settles what the payee is quoted.
 *   - Otherwise the source currency is used.
 *   - Codes are uppercased and validated against the switch-supported set
 *     (mirrors server/mojaloop.service.ts CURRENCY_DECIMALS); anything else
 *     throws — an unsupported or missing currency must fail loudly before a
 *     transfer is submitted, never silently default.
 */

import { CURRENCIES_LEDGER_MAP } from "../services/tenant/getTenantHeaders";

/** Currencies supported by the payment hub switch (server-side source of
 * truth: CURRENCY_DECIMALS in server/mojaloop.service.ts). Union with the
 * tenant ledger map so a configured corridor currency is never rejected. */
const SWITCH_SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set([
  "NGN", "KES", "GHS", "TZS", "UGX", "ZAR", "XOF", "MWK", "ZMW",
  "USD", "EUR", "GBP", "INR", "BRL",
  ...Object.keys(CURRENCIES_LEDGER_MAP),
]);

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

function normalize(code: string | undefined): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  if (!ISO_4217_PATTERN.test(upper)) return null;
  return SWITCH_SUPPORTED_CURRENCIES.has(upper) ? upper : null;
}

/**
 * Resolve the transfer currency for a payment-hub payload.
 * Throws when neither candidate is a supported ISO 4217 code.
 */
export function normalizePaymentHubCurrency(
  sourceCurrency?: string,
  destinationCurrency?: string,
): string {
  const resolved = normalize(destinationCurrency) ?? normalize(sourceCurrency);
  if (!resolved) {
    throw new Error(
      `[PaymentHub] Unsupported or missing transfer currency ` +
        `(source="${sourceCurrency ?? ""}", destination="${destinationCurrency ?? ""}"). ` +
        `Supported: ${[...SWITCH_SUPPORTED_CURRENCIES].sort().join(", ")}`,
    );
  }
  return resolved;
}
