/**
 * paymentProviders.ts — Payment provider abstraction layer.
 * Provides a middleware-ready interface for multiple payment rails.
 */

export interface PaymentProvider {
  name: string;
  supportedCurrencies: string[];
  supportedRails: string[];
  priority: number;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  fromCurrency: string;
  toCurrency: string;
  recipientAccountNumber?: string;
  recipientPhone?: string;
  description?: string;
  userId: string;
  transactionId: string;
  callbackUrl?: string;
}

export interface PaymentResult {
  success: boolean;
  providerRef?: string;
  providerName: string;
  status: "completed" | "pending" | "failed";
  errorMessage?: string;
}

// Provider adapters are intentionally registered only by concrete production
// integrations. This module must never simulate a financial result.
const PROVIDERS: PaymentProvider[] = [];

/**
 * Select the best payment provider for a given currency and rail.
 * Returns null if no provider supports the combination.
 */
export function selectProvider(currency: string, rail: string): PaymentProvider | null {
  const isDev = process.env.NODE_ENV !== "production";

  const matching = PROVIDERS.filter(
    (p) =>
      p.supportedCurrencies.includes(currency) &&
      p.supportedRails.includes(rail) &&
      (isDev || p.name !== "dev_sandbox")
  ).sort((a, b) => b.priority - a.priority);

  return matching[0] ?? null;
}

/**
 * Initiate a payment through the best available provider.
 */
export async function initiatePayment(
  request: PaymentRequest,
  rail: string
): Promise<PaymentResult> {
  const provider = selectProvider(request.currency, rail);

  if (!provider) {
    throw new Error(`No verified payment provider is configured for ${request.currency} via ${rail}`);
  }

  // A provider record without its concrete adapter is a deployment error, not a
  // condition in which a payment may be claimed as completed.
  throw new Error(`Payment provider adapter is unavailable for ${provider.name}`);
}

/**
 * Get all available providers for a currency/rail combination.
 */
export function getAvailableProviders(currency: string, rail: string): PaymentProvider[] {
  return PROVIDERS.filter(
    (p) => p.supportedCurrencies.includes(currency) && p.supportedRails.includes(rail)
  ).sort((a, b) => b.priority - a.priority);
}
