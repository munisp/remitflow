/**
 * Deep linking utilities for RemitFlow.
 * Handles universal links / app links for send, track, invite flows.
 *
 * Supported formats:
 * - remitflow.com/send?to=NGN&amount=200 → opens send flow pre-filled
 * - remitflow.com/track/REF-123 → opens transfer tracking
 * - remitflow.com/invite/CODE → opens with referral applied
 */

export interface DeepLinkParams {
  action: "send" | "track" | "invite" | "wallet" | "kyc" | "unknown";
  params: Record<string, string>;
}

export function parseDeepLink(url: string): DeepLinkParams {
  try {
    const u = new URL(url, window.location.origin);
    const path = u.pathname;
    const searchParams = Object.fromEntries(u.searchParams.entries());

    if (path.startsWith("/send")) {
      return { action: "send", params: searchParams };
    }
    if (path.startsWith("/track/")) {
      const ref = path.split("/track/")[1] ?? "";
      return { action: "track", params: { reference: ref, ...searchParams } };
    }
    if (path.startsWith("/invite/")) {
      const code = path.split("/invite/")[1] ?? "";
      return { action: "invite", params: { code, ...searchParams } };
    }
    if (path.startsWith("/wallet")) {
      return { action: "wallet", params: searchParams };
    }
    if (path.startsWith("/kyc")) {
      return { action: "kyc", params: searchParams };
    }

    return { action: "unknown", params: searchParams };
  } catch {
    return { action: "unknown", params: {} };
  }
}

/** Generate a shareable deep link for a transfer */
export function createSendLink(params: {
  toCurrency?: string;
  amount?: number;
  recipientName?: string;
}): string {
  const url = new URL("/send", window.location.origin);
  if (params.toCurrency) url.searchParams.set("to", params.toCurrency);
  if (params.amount) url.searchParams.set("amount", params.amount.toString());
  if (params.recipientName) url.searchParams.set("recipient", params.recipientName);
  return url.toString();
}

/** Generate a tracking link */
export function createTrackingLink(reference: string): string {
  return `${window.location.origin}/track/${encodeURIComponent(reference)}`;
}

/** Generate a referral invite link */
export function createInviteLink(code: string): string {
  return `${window.location.origin}/invite/${encodeURIComponent(code)}`;
}

/** Handle deep link on app launch (for PWA) */
export function handleDeepLinkOnLaunch(navigate: (path: string) => void) {
  const deepLink = parseDeepLink(window.location.href);
  switch (deepLink.action) {
    case "send": {
      const query = new URLSearchParams(deepLink.params).toString();
      navigate(`/send${query ? "?" + query : ""}`);
      break;
    }
    case "track":
      navigate(`/transfer-tracking?ref=${encodeURIComponent(deepLink.params.reference ?? "")}`);
      break;
    case "invite":
      sessionStorage.setItem("remitflow_referral_code", deepLink.params.code ?? "");
      navigate("/dashboard");
      break;
    default:
      break;
  }
}
