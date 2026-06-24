/**
 * RemitFlow — Universal Deep Link Handler (iOS + Android)
 *
 * Handles all deep link routes for:
 * - iOS Universal Links (AASA file)
 * - Android App Links (assetlinks.json)
 * - Custom scheme (remitflow://)
 *
 * Gaps closed:
 * 1. No deep links (0 refs) → Full deep link routing for all screens
 * 2. No app links → apple-app-site-association + assetlinks.json
 * 3. Can't open in-app from email/SMS → Complete route mapping
 */

import React, { useEffect, useCallback } from "react";
import { Linking, Platform } from "react-native";

// ─── Route Configuration ──────────────────────────────────────────────────────

export interface DeepLinkRoute {
  pattern: string;
  screen: string;
  params?: string[];
  authRequired: boolean;
}

export const DEEP_LINK_ROUTES: DeepLinkRoute[] = [
  // Transfer flows
  { pattern: "/transfer/:id", screen: "TransferDetail", params: ["id"], authRequired: true },
  { pattern: "/transfer/:id/status", screen: "TransferStatus", params: ["id"], authRequired: true },
  { pattern: "/send/:corridor", screen: "SendMoney", params: ["corridor"], authRequired: true },
  { pattern: "/send", screen: "SendMoney", authRequired: true },
  { pattern: "/receive", screen: "ReceiveMoney", authRequired: true },

  // KYC flows
  { pattern: "/kyc/resume", screen: "KYCResume", authRequired: true },
  { pattern: "/kyc/verify", screen: "KYCVerify", authRequired: true },
  { pattern: "/kyc/document/:type", screen: "KYCDocument", params: ["type"], authRequired: true },
  { pattern: "/kyc/liveness", screen: "LivenessCheck", authRequired: true },

  // Wallet
  { pattern: "/wallet", screen: "Wallet", authRequired: true },
  { pattern: "/wallet/topup", screen: "WalletTopup", authRequired: true },
  { pattern: "/wallet/history", screen: "TransactionHistory", authRequired: true },

  // Stablecoin
  { pattern: "/stablecoin/swap", screen: "StablecoinSwap", authRequired: true },
  { pattern: "/stablecoin/bridge", screen: "StablecoinBridge", authRequired: true },
  { pattern: "/stablecoin/dca", screen: "DCASetup", authRequired: true },
  { pattern: "/stablecoin/yield", screen: "YieldDashboard", authRequired: true },

  // Payments
  { pattern: "/pay/:merchantId", screen: "MerchantPayment", params: ["merchantId"], authRequired: true },
  { pattern: "/pay/link/:linkId", screen: "PaymentLink", params: ["linkId"], authRequired: false },
  { pattern: "/request/:requestId", screen: "PaymentRequest", params: ["requestId"], authRequired: true },

  // P2P
  { pattern: "/p2p/:userId", screen: "P2PSend", params: ["userId"], authRequired: true },
  { pattern: "/p2p/scan", screen: "QRScanner", authRequired: true },

  // Settings
  { pattern: "/settings", screen: "Settings", authRequired: true },
  { pattern: "/settings/security", screen: "SecuritySettings", authRequired: true },
  { pattern: "/settings/notifications", screen: "NotificationSettings", authRequired: true },

  // Agent
  { pattern: "/agent/:agentId", screen: "AgentDetail", params: ["agentId"], authRequired: true },
  { pattern: "/agent/pickup/:code", screen: "AgentPickup", params: ["code"], authRequired: true },

  // Referral
  { pattern: "/invite/:code", screen: "Referral", params: ["code"], authRequired: false },

  // Property (investment)
  { pattern: "/property/:propertyId", screen: "PropertyDetail", params: ["propertyId"], authRequired: true },
];

// ─── URL Parsing ──────────────────────────────────────────────────────────────

interface ParsedDeepLink {
  route: DeepLinkRoute;
  params: Record<string, string>;
  queryParams: Record<string, string>;
}

function parseDeepLink(url: string): ParsedDeepLink | null {
  try {
    // Strip scheme
    let path = url;
    if (url.startsWith("remitflow://")) {
      path = url.replace("remitflow://", "/");
    } else if (url.includes("remitflow.app")) {
      const parsed = new URL(url);
      path = parsed.pathname;
    }

    // Extract query params
    const queryStart = path.indexOf("?");
    const queryParams: Record<string, string> = {};
    if (queryStart > -1) {
      const query = path.slice(queryStart + 1);
      path = path.slice(0, queryStart);
      for (const pair of query.split("&")) {
        const [key, value] = pair.split("=");
        if (key) queryParams[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
      }
    }

    // Match route pattern
    for (const route of DEEP_LINK_ROUTES) {
      const match = matchPattern(route.pattern, path);
      if (match) {
        return { route, params: match, queryParams };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ─── Deep Link Handler Component ──────────────────────────────────────────────

interface DeepLinkHandlerProps {
  onNavigate: (screen: string, params: Record<string, string>) => void;
  onAuthRequired: (targetScreen: string, params: Record<string, string>) => void;
  isAuthenticated: boolean;
}

export function DeepLinkHandler({
  onNavigate,
  onAuthRequired,
  isAuthenticated,
}: DeepLinkHandlerProps): React.ReactElement | null {
  const handleDeepLink = useCallback(
    (url: string) => {
      const parsed = parseDeepLink(url);
      if (!parsed) {
        console.warn("[DeepLink] No route match for:", url);
        return;
      }

      const allParams = { ...parsed.params, ...parsed.queryParams };

      if (parsed.route.authRequired && !isAuthenticated) {
        onAuthRequired(parsed.route.screen, allParams);
        return;
      }

      onNavigate(parsed.route.screen, allParams);
    },
    [isAuthenticated, onNavigate, onAuthRequired],
  );

  useEffect(() => {
    // Handle app opened via deep link
    Linking.getInitialURL().then(url => {
      if (url) handleDeepLink(url);
    });

    // Handle deep link when app is already open
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleDeepLink(url);
    });

    return () => subscription.remove();
  }, [handleDeepLink]);

  return null;
}

// ─── Apple App Site Association (iOS Universal Links) ──────────────────────────

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "TEAM_ID.com.remitflow.app",
        paths: [
          "/transfer/*",
          "/send/*",
          "/receive",
          "/kyc/*",
          "/wallet/*",
          "/stablecoin/*",
          "/pay/*",
          "/p2p/*",
          "/settings/*",
          "/agent/*",
          "/invite/*",
          "/property/*",
          "/request/*",
        ],
      },
    ],
  },
  webcredentials: {
    apps: ["TEAM_ID.com.remitflow.app"],
  },
};

// ─── Android Asset Links ──────────────────────────────────────────────────────

export const ANDROID_ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.remitflow.app",
      sha256_cert_fingerprints: [
        // Production SHA-256 fingerprint
        "SHA256_CERT_FINGERPRINT_HERE",
      ],
    },
  },
];

// ─── Link Generation ──────────────────────────────────────────────────────────

const BASE_URL = "https://app.remitflow.com";

export function generateDeepLink(screen: string, params?: Record<string, string>): string {
  const route = DEEP_LINK_ROUTES.find(r => r.screen === screen);
  if (!route) return `${BASE_URL}/`;

  let path = route.pattern;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, encodeURIComponent(value));
    }
  }
  return `${BASE_URL}${path}`;
}

export function generateUniversalLink(screen: string, params?: Record<string, string>): string {
  return generateDeepLink(screen, params);
}

export function generateCustomSchemeLink(screen: string, params?: Record<string, string>): string {
  const route = DEEP_LINK_ROUTES.find(r => r.screen === screen);
  if (!route) return "remitflow://home";

  let path = route.pattern;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, encodeURIComponent(value));
    }
  }
  return `remitflow://${path.slice(1)}`;
}

export default DeepLinkHandler;
