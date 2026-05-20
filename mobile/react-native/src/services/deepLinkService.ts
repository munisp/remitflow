/**
 * deepLinkService.ts
 * Handles Universal Links (iOS) and App Links (Android) for RemitFlow.
 *
 * Supported deep link patterns:
 *   remitflow://send?to=<beneficiaryId>&amount=<amount>&currency=<currency>
 *   remitflow://pay?ref=<paymentRef>
 *   remitflow://kyc
 *   remitflow://wallet
 *   remitflow://transaction/<id>
 *   https://app.remitflow.com/send?...  (Universal Link)
 *
 * Install: pnpm add @react-navigation/native (already included)
 */

import { Linking } from "react-native";
import { NavigationContainerRef } from "@react-navigation/native";

export type DeepLinkRoute =
  | { screen: "SendMoney"; params: { beneficiaryId?: string; amount?: string; currency?: string } }
  | { screen: "PaymentConfirm"; params: { ref: string } }
  | { screen: "KYC"; params: {} }
  | { screen: "Wallet"; params: {} }
  | { screen: "TransactionDetail"; params: { id: string } }
  | { screen: "Dashboard"; params: {} };

/**
 * Parse a deep link URL into a navigation route.
 */
export function parseDeepLink(url: string): DeepLinkRoute | null {
  try {
    // Normalize universal links to custom scheme
    const normalized = url
      .replace("https://app.remitflow.com", "remitflow://")
      .replace("https://remitflow.app", "remitflow://");

    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/^\//, "");
    const params = Object.fromEntries(parsed.searchParams.entries());

    if (path === "send" || parsed.host === "send") {
      return {
        screen: "SendMoney",
        params: {
          beneficiaryId: params.to,
          amount: params.amount,
          currency: params.currency ?? "NGN",
        },
      };
    }

    if (path === "pay" || parsed.host === "pay") {
      if (!params.ref) return null;
      return { screen: "PaymentConfirm", params: { ref: params.ref } };
    }

    if (path === "kyc" || parsed.host === "kyc") {
      return { screen: "KYC", params: {} };
    }

    if (path === "wallet" || parsed.host === "wallet") {
      return { screen: "Wallet", params: {} };
    }

    const txMatch = path.match(/^transaction\/(.+)$/);
    if (txMatch) {
      return { screen: "TransactionDetail", params: { id: txMatch[1] } };
    }

    return { screen: "Dashboard", params: {} };
  } catch {
    return null;
  }
}

/**
 * Navigate to the parsed deep link route.
 */
export function navigateToDeepLink(
  navigationRef: NavigationContainerRef<any>,
  route: DeepLinkRoute
): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate(route.screen as never, route.params as never);
}

/**
 * Set up deep link listeners for foreground (app open) and cold start.
 * Call this in your root App component.
 */
export function setupDeepLinks(
  navigationRef: NavigationContainerRef<any>
): () => void {
  // Handle deep links when app is already open
  const subscription = Linking.addEventListener("url", ({ url }) => {
    const route = parseDeepLink(url);
    if (route) navigateToDeepLink(navigationRef, route);
  });

  // Handle cold start deep link
  Linking.getInitialURL().then((url) => {
    if (url) {
      const route = parseDeepLink(url);
      if (route) {
        // Delay navigation until navigator is ready
        const interval = setInterval(() => {
          if (navigationRef.isReady()) {
            navigateToDeepLink(navigationRef, route);
            clearInterval(interval);
          }
        }, 100);
        setTimeout(() => clearInterval(interval), 5000);
      }
    }
  });

  return () => subscription.remove();
}

/**
 * Generate a shareable deep link for sending money to a beneficiary.
 */
export function generateSendMoneyLink(
  beneficiaryId: string,
  amount?: number,
  currency = "NGN"
): string {
  const params = new URLSearchParams({ to: beneficiaryId });
  if (amount) params.set("amount", amount.toString());
  params.set("currency", currency);
  return `https://app.remitflow.com/send?${params.toString()}`;
}

/**
 * Generate a shareable payment request link.
 */
export function generatePaymentRequestLink(ref: string): string {
  return `https://app.remitflow.com/pay?ref=${encodeURIComponent(ref)}`;
}
