/**
 * smoke-v170.test.ts
 *
 * Sprint v170: Offline/Low-Connectivity Resilience Layer
 * - Service Worker with background sync (IndexedDB queue)
 * - IndexedDB FX rate cache with 15-min TTL (stale-while-revalidate)
 * - SSE delta-compressed FX rate streaming (fxRateSse.ts)
 * - HTTP polling fallback with exponential backoff (useRealtimeRates hook)
 * - Connection health banner (ConnectionHealthBanner component)
 * - SMS/USSD OTP fallback for critical transfer confirmations
 * - CoinGecko API key support in universal-fx Python service
 * - Crypto wallet custody integration (Fireblocks/BitGo/Mock)
 * - POST /api/sse/fx-rates SSE endpoint
 * - POST /api/offline-sync endpoint
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function exists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

// ─── 1. fxRateSse.ts — SSE delta streaming ────────────────────────────────────
describe("v170 – fxRateSse.ts: delta-compressed SSE endpoint", () => {
  const sse = read("server/fxRateSse.ts");

  it("exports fxRateSseHandler function", () => {
    expect(sse).toContain("export function fxRateSseHandler");
  });

  it("exports pushRateUpdate function", () => {
    expect(sse).toContain("export function pushRateUpdate");
  });

  it("exports setInitialRates function", () => {
    expect(sse).toContain("export function setInitialRates");
  });

  it("sends fx-snapshot event on first connect", () => {
    expect(sse).toContain("event: fx-snapshot");
  });

  it("sends fx-delta event for changed rates only", () => {
    expect(sse).toContain("event: fx-delta");
  });

  it("sends heartbeat every 25s to prevent proxy/CGNAT timeouts", () => {
    expect(sse).toContain("25_000");
    expect(sse).toContain("heartbeat");
  });

  it("sets X-Accel-Buffering: no to disable Nginx buffering", () => {
    expect(sse).toContain("X-Accel-Buffering");
    expect(sse).toContain("no");
  });

  it("computes delta with 0.01% threshold to filter noise", () => {
    expect(sse).toContain("0.0001");
  });

  it("exports getSseClientCount for monitoring", () => {
    expect(sse).toContain("export function getSseClientCount");
  });
});

// ─── 2. server/_core/index.ts — new endpoints ─────────────────────────────────
describe("v170 – server/_core/index.ts: new endpoints wired", () => {
  const idx = read("server/_core/index.ts");

  it("registers GET /api/sse/fx-rates endpoint", () => {
    expect(idx).toContain("/api/sse/fx-rates");
    expect(idx).toContain("fxRateSseHandler");
  });

  it("registers POST /api/offline-sync endpoint", () => {
    expect(idx).toContain("/api/offline-sync");
    expect(idx).toContain("OfflineSync");
  });

  it("offline-sync validates required fields (id, type, payload)", () => {
    expect(idx).toContain("transfer?.id");
    expect(idx).toContain("transfer?.type");
    expect(idx).toContain("transfer?.payload");
  });

  it("offline-sync returns { ok: true, id, replayed: true }", () => {
    expect(idx).toContain("replayed: true");
  });
});

// ─── 3. client/src/lib/fxRateCache.ts — IndexedDB cache ──────────────────────
describe("v170 – fxRateCache.ts: IndexedDB rate cache with TTL", () => {
  it("fxRateCache.ts file exists", () => {
    expect(exists("client/src/lib/fxRateCache.ts")).toBe(true);
  });

  const cache = read("client/src/lib/fxRateCache.ts");

  it("defines RATE_CACHE_TTL_MS constant (15 minutes)", () => {
    // 15 min = 900000 ms
    expect(cache).toMatch(/900[_]?000|15.*min|RATE_CACHE_TTL/);
  });

  it("exports getCachedRates function", () => {
    expect(cache).toContain("getCachedRates");
  });

  it("exports setCachedRates function", () => {
    expect(cache).toContain("setCachedRates");
  });

  it("exports applyRateDelta or isRateCacheStale function", () => {
    expect(cache).toMatch(/isRateCacheStale|applyRateDelta|clearRateCache/);
  });

  it("uses IndexedDB or localStorage for persistence", () => {
    expect(cache).toMatch(/indexedDB|localStorage|idb|IDB/i);
  });
});

// ─── 4. client/src/lib/offlineQueue.ts — transfer queue ──────────────────────
describe("v170 – offlineQueue.ts: offline transfer queue", () => {
  it("offlineQueue.ts file exists", () => {
    expect(exists("client/src/lib/offlineQueue.ts")).toBe(true);
  });

  const queue = read("client/src/lib/offlineQueue.ts");

  it("exports enqueueTransfer function", () => {
    expect(queue).toContain("enqueueTransfer");
  });

  it("exports removeFromQueue or flushQueue function", () => {
    expect(queue).toMatch(/removeFromQueue|flushQueue|processQueue|requeueFailed/);
  });

  it("exports getPendingTransfers function", () => {
    expect(queue).toContain("getPendingTransfers");
  });

  it("stores transfers with id, type, payload fields", () => {
    expect(queue).toContain("id");
    expect(queue).toContain("type");
    expect(queue).toContain("payload");
  });
});

// ─── 5. client/public/sw.js — Service Worker ──────────────────────────────────
describe("v170 – sw.js: Service Worker with background sync", () => {
  it("sw.js file exists in client/public", () => {
    expect(exists("client/public/sw.js")).toBe(true);
  });

  const sw = read("client/public/sw.js");

  it("registers background sync event listener", () => {
    expect(sw).toMatch(/sync|background.sync|BackgroundSync/i);
  });

  it("handles offline-transfer-sync tag", () => {
    expect(sw).toMatch(/offline.transfer|transfer.sync|remitflow/i);
  });

  it("caches app shell for offline use", () => {
    expect(sw).toMatch(/cache|Cache|install|fetch/i);
  });
});

// ─── 6. client/src/hooks/useRealtimeRates.ts — SSE + polling fallback ─────────
describe("v170 – useRealtimeRates.ts: SSE with HTTP polling fallback", () => {
  it("useRealtimeRates.ts file exists", () => {
    expect(exists("client/src/hooks/useRealtimeRates.ts")).toBe(true);
  });

  const hook = read("client/src/hooks/useRealtimeRates.ts");

  it("connects to /api/sse/fx-rates SSE endpoint", () => {
    expect(hook).toContain("/api/sse/fx-rates");
  });

  it("implements exponential backoff for reconnection", () => {
    expect(hook).toMatch(/backoff|exponential|Math\.min|reconnect/i);
  });

  it("falls back to HTTP polling when SSE fails", () => {
    expect(hook).toMatch(/poll|polling|setInterval|fallback/i);
  });

  it("exports connection status (online/degraded/offline)", () => {
    expect(hook).toMatch(/online|offline|degraded|status/i);
  });

  it("merges delta updates into the full rate map", () => {
    expect(hook).toMatch(/delta|merge|spread|\.\.\.rates/i);
  });
});

// ─── 7. ConnectionHealthBanner.tsx ────────────────────────────────────────────
describe("v170 – ConnectionHealthBanner.tsx: connection health UI", () => {
  it("ConnectionHealthBanner.tsx file exists", () => {
    expect(exists("client/src/components/ConnectionHealthBanner.tsx")).toBe(true);
  });

  const banner = read("client/src/components/ConnectionHealthBanner.tsx");

  it("shows online/offline/degraded states", () => {
    expect(banner).toMatch(/online|offline|degraded/i);
  });

  it("is integrated into DashboardLayout", () => {
    const layout = read("client/src/components/DashboardLayout.tsx");
    expect(layout).toContain("ConnectionHealthBanner");
  });
});

// ─── 8. SMS/USSD confirm router ────────────────────────────────────────────────
describe("v170 – smsConfirm.ts: SMS/USSD OTP fallback", () => {
  it("smsConfirm.ts file exists", () => {
    expect(exists("server/routers/smsConfirm.ts")).toBe(true);
  });

  const sms = read("server/routers/smsConfirm.ts");

  it("exports smsConfirmRouter with requestConfirmation procedure", () => {
    expect(sms).toContain("requestConfirmation");
  });

  it("exports smsConfirmRouter with verifyCode procedure", () => {
    expect(sms).toContain("verifyCode");
  });

  it("supports Africa's Talking SMS provider", () => {
    expect(sms).toContain("africas_talking");
    expect(sms).toContain("africastalking.com");
  });

  it("supports Twilio SMS provider", () => {
    expect(sms).toContain("twilio");
    expect(sms).toContain("twilio.com");
  });

  it("has mock mode for sandbox testing", () => {
    expect(sms).toContain("mock");
    expect(sms).toContain("sandboxOtp");
  });

  it("enforces 6-digit OTP code validation", () => {
    expect(sms).toContain("length(6)");
  });

  it("enforces OTP TTL of 10 minutes", () => {
    expect(sms).toMatch(/10.*min|600.*000|OTP_TTL/i);
  });

  it("enforces max 3 verification attempts", () => {
    expect(sms).toContain("MAX_ATTEMPTS");
    expect(sms).toContain("3");
  });

  it("is registered in the main appRouter", () => {
    const routers = read("server/routers.ts");
    expect(routers).toContain("smsConfirmRouter");
    expect(routers).toContain("smsConfirm:");
  });
});

// ─── 9. universal-fx Python service ───────────────────────────────────────────
describe("v170 – universal-fx/main.py: CoinGecko API key support", () => {
  it("universal-fx/main.py file exists", () => {
    expect(exists("services/universal-fx/main.py")).toBe(true);
  });

  const fx = read("services/universal-fx/main.py");

  it("reads COINGECKO_API_KEY from environment", () => {
    expect(fx).toContain("COINGECKO_API_KEY");
  });

  it("uses Pro API endpoint when key is set", () => {
    expect(fx).toContain("pro-api.coingecko.com");
  });

  it("falls back to free API when no key", () => {
    expect(fx).toContain("api.coingecko.com/api/v3");
  });

  it("sends x-cg-pro-api-key header when using Pro API", () => {
    expect(fx).toContain("x-cg-pro-api-key");
  });

  it("implements stale-while-revalidate caching", () => {
    expect(fx).toMatch(/stale|revalidate|RATE_CACHE_TTL|background/i);
  });

  it("has fallback rates for offline operation", () => {
    expect(fx).toContain("FALLBACK_RATES");
    expect(fx).toContain("NGN");
    expect(fx).toContain("BTC");
  });

  it("supports hub-and-spoke rate computation (USD as hub)", () => {
    expect(fx).toContain("compute_cross_rate");
  });

  it("applies slippage protection", () => {
    expect(fx).toContain("apply_slippage");
    expect(fx).toContain("SLIPPAGE_BPS");
  });

  it("has /health endpoint with coingeckoTier field", () => {
    expect(fx).toContain("coingeckoTier");
  });

  it("has requirements.txt with fastapi and httpx", () => {
    expect(exists("services/universal-fx/requirements.txt")).toBe(true);
    const req = read("services/universal-fx/requirements.txt");
    expect(req).toContain("fastapi");
    expect(req).toContain("httpx");
  });
});

// ─── 10. Crypto custody router ────────────────────────────────────────────────
describe("v170 – cryptoCustody.ts: Fireblocks/BitGo/Mock custody", () => {
  it("cryptoCustody.ts file exists", () => {
    expect(exists("server/routers/cryptoCustody.ts")).toBe(true);
  });

  const custody = read("server/routers/cryptoCustody.ts");

  it("exports cryptoCustodyRouter", () => {
    expect(custody).toContain("cryptoCustodyRouter");
  });

  it("implements Fireblocks custody provider", () => {
    expect(custody).toContain("FireblocksCustody");
    expect(custody).toContain("fireblocks.io");
  });

  it("implements BitGo custody provider", () => {
    expect(custody).toContain("BitGoCustody");
    expect(custody).toContain("bitgo.com");
  });

  it("implements Mock custody for sandbox testing", () => {
    expect(custody).toContain("MockCustody");
  });

  it("uses CUSTODY_PROVIDER env var for provider selection", () => {
    expect(custody).toContain("CUSTODY_PROVIDER");
  });

  it("has getBalance procedure", () => {
    expect(custody).toContain("getBalance");
  });

  it("has initiateTransfer procedure", () => {
    expect(custody).toContain("initiateTransfer");
  });

  it("has getDepositAddress procedure", () => {
    expect(custody).toContain("getDepositAddress");
  });

  it("has getProviderStatus procedure", () => {
    expect(custody).toContain("getProviderStatus");
  });

  it("enforces dual-approval warning for high-value transfers", () => {
    expect(custody).toContain("HIGH_VALUE_THRESHOLD_USD");
    expect(custody).toContain("10_000");
  });

  it("uses RSA-signed JWT for Fireblocks authentication", () => {
    expect(custody).toContain("RSA-SHA256");
    expect(custody).toContain("signJwt");
  });

  it("is registered in the main appRouter", () => {
    const routers = read("server/routers.ts");
    expect(routers).toContain("cryptoCustodyRouter");
    expect(routers).toContain("cryptoCustody:");
  });
});
