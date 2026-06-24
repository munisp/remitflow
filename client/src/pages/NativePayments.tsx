/**
 * NativePayments.tsx — Apple Pay / Google Pay integration
 *
 * Implements:
 * - Payment Request API for browsers that support it
 * - Apple Pay JS for Safari/iOS
 * - Google Pay API for Chrome/Android
 * - Stripe integration for processing
 * - One-tap checkout for stablecoin top-ups
 */

import React, { useState, useCallback, useEffect } from "react";

interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  method: "apple_pay" | "google_pay" | "payment_request";
  amount: number;
  currency: string;
}

interface PaymentConfig {
  merchantId: string;
  merchantName: string;
  countryCode: string;
  currencyCode: string;
  supportedNetworks: string[];
  merchantCapabilities: string[];
}

const DEFAULT_CONFIG: PaymentConfig = {
  merchantId: "merchant.com.remitflow",
  merchantName: "RemitFlow",
  countryCode: "US",
  currencyCode: "USD",
  supportedNetworks: ["visa", "mastercard", "amex", "discover"],
  merchantCapabilities: ["supports3DS", "supportsCredit", "supportsDebit"],
};

// Check platform capabilities
function getPaymentCapabilities(): { applePay: boolean; googlePay: boolean; paymentRequest: boolean } {
  const applePay = typeof window !== "undefined" && !!(window as any).ApplePaySession?.canMakePayments?.();
  const googlePay = typeof window !== "undefined" && !!(window as any).google?.payments?.api;
  const paymentRequest = typeof window !== "undefined" && !!window.PaymentRequest;
  return { applePay, googlePay, paymentRequest };
}

// Payment Request API (W3C standard)
async function initiatePaymentRequest(amount: number, currency: string, label: string): Promise<PaymentResult> {
  if (!window.PaymentRequest) {
    return { success: false, error: "Payment Request API not supported", method: "payment_request", amount, currency };
  }

  const methodData: PaymentMethodData[] = [
    {
      supportedMethods: "https://apple.com/apple-pay",
      data: {
        version: 3,
        merchantIdentifier: DEFAULT_CONFIG.merchantId,
        merchantCapabilities: DEFAULT_CONFIG.merchantCapabilities,
        supportedNetworks: DEFAULT_CONFIG.supportedNetworks,
        countryCode: DEFAULT_CONFIG.countryCode,
      },
    },
    {
      supportedMethods: "https://google.com/pay",
      data: {
        environment: "PRODUCTION",
        apiVersion: 2,
        apiVersionMinor: 0,
        merchantInfo: { merchantId: DEFAULT_CONFIG.merchantId, merchantName: DEFAULT_CONFIG.merchantName },
        allowedPaymentMethods: [{
          type: "CARD",
          parameters: { allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"], allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX"] },
          tokenizationSpecification: { type: "PAYMENT_GATEWAY", parameters: { gateway: "stripe", "stripe:version": "2022-11-15" } },
        }],
      },
    },
    { supportedMethods: "basic-card", data: { supportedNetworks: DEFAULT_CONFIG.supportedNetworks } },
  ];

  const details: PaymentDetailsInit = {
    total: { label, amount: { currency, value: amount.toFixed(2) } },
    displayItems: [
      { label: "Wallet Top-Up", amount: { currency, value: amount.toFixed(2) } },
    ],
  };

  try {
    const request = new PaymentRequest(methodData, details);
    const canMake = await request.canMakePayment();
    if (!canMake) {
      return { success: false, error: "No payment method available", method: "payment_request", amount, currency };
    }

    const response = await request.show();
    // Process with Stripe
    const processResult = await processPaymentToken(response.details, amount, currency);
    await response.complete(processResult.success ? "success" : "fail");

    return {
      success: processResult.success,
      transactionId: processResult.transactionId,
      error: processResult.error,
      method: "payment_request",
      amount,
      currency,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Payment cancelled",
      method: "payment_request",
      amount,
      currency,
    };
  }
}

// Process payment token via backend
async function processPaymentToken(
  token: any,
  amount: number,
  currency: string
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  try {
    const res = await fetch("/api/trpc/payments.processNativePayment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, amount, currency }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, transactionId: data.result?.transactionId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Processing failed" };
  }
}

export default function NativePayments() {
  const [capabilities, setCapabilities] = useState({ applePay: false, googlePay: false, paymentRequest: false });
  const [amount, setAmount] = useState(50);
  const [currency, setCurrency] = useState("USD");
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<PaymentResult | null>(null);

  useEffect(() => {
    setCapabilities(getPaymentCapabilities());
  }, []);

  const handlePayment = useCallback(async () => {
    setProcessing(true);
    setLastResult(null);
    try {
      const result = await initiatePaymentRequest(amount, currency, "RemitFlow Wallet Top-Up");
      setLastResult(result);
    } catch (err) {
      setLastResult({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
        method: "payment_request",
        amount,
        currency,
      });
    } finally {
      setProcessing(false);
    }
  }, [amount, currency]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Quick Top-Up
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Instantly fund your wallet with Apple Pay, Google Pay, or card
        </p>

        {/* Capabilities */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Available Methods</h3>
          <div className="flex space-x-3">
            <CapabilityBadge name="Apple Pay" available={capabilities.applePay} />
            <CapabilityBadge name="Google Pay" available={capabilities.googlePay} />
            <CapabilityBadge name="Card" available={capabilities.paymentRequest} />
          </div>
        </div>

        {/* Amount Selection */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Top-Up Amount
          </label>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[25, 50, 100, 250].map((preset) => (
              <button
                key={preset}
                onClick={() => setAmount(preset)}
                className={`py-2 rounded-lg text-sm font-medium transition ${
                  amount === preset
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
                }`}
              >
                ${preset}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-gray-500 dark:text-gray-400">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              min={1}
              max={10000}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
              <option value="CAD">CAD</option>
            </select>
          </div>
        </div>

        {/* Pay Button */}
        <button
          onClick={handlePayment}
          disabled={processing || amount <= 0}
          className="w-full py-4 bg-black dark:bg-white text-white dark:text-black rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
        >
          {processing ? (
            <span className="animate-pulse">Processing...</span>
          ) : (
            <>
              <span>Pay ${amount.toFixed(2)} {currency}</span>
            </>
          )}
        </button>

        {/* Result */}
        {lastResult && (
          <div className={`mt-4 p-4 rounded-lg ${lastResult.success ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"}`}>
            <p className={`font-medium ${lastResult.success ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"}`}>
              {lastResult.success ? "Payment Successful" : "Payment Failed"}
            </p>
            {lastResult.transactionId && (
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                Transaction: {lastResult.transactionId}
              </p>
            )}
            {lastResult.error && (
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                {lastResult.error}
              </p>
            )}
          </div>
        )}

        {/* Security Note */}
        <p className="text-xs text-gray-500 dark:text-gray-500 text-center mt-6">
          Payments processed securely via Stripe. Your card details are never stored on our servers.
        </p>
      </div>
    </div>
  );
}

function CapabilityBadge({ name, available }: { name: string; available: boolean }) {
  return (
    <div className={`px-3 py-1 rounded-full text-xs font-medium ${
      available
        ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500"
    }`}>
      {available ? "\u2713" : "\u2717"} {name}
    </div>
  );
}
