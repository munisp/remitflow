/**
 * Deep Linking Configuration — Universal Links (iOS) + App Links (Android).
 */

export const DEEP_LINK_PREFIX = "remitflow://";
export const UNIVERSAL_LINK_PREFIX = "https://app.remitflow.com";

export interface DeepLinkRoute {
  path: string;
  screen: string;
  params?: string[];
}

export const DEEP_LINK_ROUTES: DeepLinkRoute[] = [
  // Core flows
  { path: "/transfer/:id", screen: "TransferDetails", params: ["id"] },
  { path: "/send", screen: "SendMoney" },
  { path: "/send/:beneficiaryId", screen: "SendMoney", params: ["beneficiaryId"] },
  { path: "/wallet", screen: "Wallet" },
  { path: "/wallet/topup", screen: "WalletTopUp" },

  // KYC
  { path: "/kyc", screen: "KYCVerification" },
  { path: "/kyc/upgrade", screen: "KYCUpgrade" },

  // Notifications
  { path: "/notifications", screen: "NotificationCenter" },
  { path: "/notifications/:id", screen: "NotificationDetail", params: ["id"] },

  // QR payments
  { path: "/qr-pay", screen: "QRPay" },
  { path: "/qr-pay/:code", screen: "QRPay", params: ["code"] },

  // Transactions
  { path: "/transactions", screen: "TransactionHistory" },
  { path: "/transaction/:id", screen: "TransactionDetail", params: ["id"] },

  // Social
  { path: "/invite/:code", screen: "ReferralLanding", params: ["code"] },
  { path: "/circle/:id", screen: "CircleDetails", params: ["id"] },
  { path: "/gift/:id", screen: "GiftTransfer", params: ["id"] },

  // Insurance
  { path: "/insurance", screen: "InsuranceProducts" },
  { path: "/insurance/claim/:id", screen: "InsuranceClaim", params: ["id"] },

  // Support
  { path: "/support", screen: "SupportTickets" },
  { path: "/support/ticket/:id", screen: "TicketDetails", params: ["id"] },

  // Dashboard
  { path: "/dashboard", screen: "Dashboard" },
  { path: "/settings", screen: "Settings" },
];

export const linking = {
  prefixes: [DEEP_LINK_PREFIX, UNIVERSAL_LINK_PREFIX],
  config: {
    screens: Object.fromEntries(
      DEEP_LINK_ROUTES.map((r) => [r.screen, r.path])
    ),
  },
};

/**
 * Apple app-site-association file content (serve from /.well-known/apple-app-site-association)
 */
export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "TEAM_ID.com.remitflow.app",
        paths: DEEP_LINK_ROUTES.map((r) => r.path.replace(/:(\w+)/g, "*")),
      },
    ],
  },
};

/**
 * Android assetlinks.json content (serve from /.well-known/assetlinks.json)
 */
export const ANDROID_ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.remitflow.app",
      sha256_cert_fingerprints: ["CERT_FINGERPRINT_HERE"],
    },
  },
];

export function parseDeepLink(url: string): { screen: string; params: Record<string, string> } | null {
  const cleanUrl = url.replace(DEEP_LINK_PREFIX, "/").replace(UNIVERSAL_LINK_PREFIX, "");
  for (const route of DEEP_LINK_ROUTES) {
    const pattern = route.path.replace(/:(\w+)/g, "([^/]+)");
    const match = cleanUrl.match(new RegExp(`^${pattern}$`));
    if (match) {
      const params: Record<string, string> = {};
      route.params?.forEach((p, i) => { params[p] = match[i + 1]; });
      return { screen: route.screen, params };
    }
  }
  return null;
}
