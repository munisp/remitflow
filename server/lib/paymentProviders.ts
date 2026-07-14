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

// All supported African and global corridors
const AFRICAN_CURRENCIES = ["NGN", "KES", "GHS", "TZS", "UGX", "ZAR", "XOF", "XAF", "EGP", "MAD", "ETB", "TND"];
const GLOBAL_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR", "BRL", "MXN", "PHP", "SGD"];

const DEV_SANDBOX_PROVIDER: PaymentProvider = {
  name: "dev_sandbox",
  supportedCurrencies: [...AFRICAN_CURRENCIES, ...GLOBAL_CURRENCIES],
  supportedRails: ["bank_transfer", "mobile_money", "card", "crypto", "wallet", "cash_pickup"],
  priority: 100,
};

const PROVIDERS: PaymentProvider[] = [
  DEV_SANDBOX_PROVIDER,
  // Production providers would be added here conditionally
];

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
    return {
      success: false,
      providerName: "none",
      status: "failed",
      errorMessage: `No provider available for ${request.currency} via ${rail}`,
    };
  }

  // Dev sandbox simulation
  if (provider.name === "dev_sandbox") {
    // Simulate failure for very large amounts (test scenario)
    if (request.amount >= 999999) {
      return {
        success: false,
        providerName: "dev_sandbox",
        status: "failed",
        errorMessage: "Amount exceeds sandbox limit",
      };
    }

    // Simulate async processing delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    return {
      success: true,
      providerRef: `DEV-${request.transactionId}-${Date.now()}`,
      providerName: "dev_sandbox",
      status: "completed",
    };
  }

  // Production provider logic would go here
  return {
    success: false,
    providerName: provider.name,
    status: "failed",
    errorMessage: "Production provider not configured",
  };
}

/**
 * Get all available providers for a currency/rail combination.
 */
export function getAvailableProviders(currency: string, rail: string): PaymentProvider[] {
  return PROVIDERS.filter(
    (p) => p.supportedCurrencies.includes(currency) && p.supportedRails.includes(rail)
  ).sort((a, b) => b.priority - a.priority);
}
