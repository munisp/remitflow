/**
 * ConnectionHealthBanner.tsx — v170
 *
 * Displays a non-intrusive banner at the top of the app when the user is:
 * - Offline (no network)
 * - On a degraded connection (SSE failed, polling fallback active)
 * - Using stale cached FX rates (>15 min old)
 *
 * Designed for African low-connectivity environments where network
 * interruptions are common (2G EDGE, cell tower handoffs, CGNAT drops).
 */

import { useEffect, useState, useCallback } from "react";
import { getPendingCount } from "@/lib/offlineQueue";
import { getCachedRates } from "@/lib/fxRateCache";

type BannerState = "online" | "degraded" | "stale_rates" | "offline" | "syncing";

interface BannerInfo {
  state: BannerState;
  message: string;
  subtext?: string;
  color: string;
  icon: string;
}

const BANNER_CONFIG: Record<BannerState, BannerInfo> = {
  online: {
    state: "online",
    message: "Connected",
    color: "bg-emerald-600",
    icon: "●",
  },
  degraded: {
    state: "degraded",
    message: "Slow connection detected — using cached rates",
    subtext: "Transfers will be queued and sent when connectivity improves",
    color: "bg-amber-600",
    icon: "◐",
  },
  stale_rates: {
    state: "stale_rates",
    message: "Exchange rates may be outdated",
    subtext: "Rates will refresh when connection improves. Rate-lock is disabled.",
    color: "bg-amber-500",
    icon: "⚠",
  },
  offline: {
    state: "offline",
    message: "You are offline",
    subtext: "Transfers are queued and will be sent automatically when you reconnect",
    color: "bg-red-600",
    icon: "✕",
  },
  syncing: {
    state: "syncing",
    message: "Syncing queued transfers…",
    color: "bg-blue-600",
    icon: "↻",
  },
};

export function ConnectionHealthBanner() {
  const [bannerState, setBannerState] = useState<BannerState | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const checkStatus = useCallback(async () => {
    const isOnline = navigator.onLine;
    const pending = await getPendingCount();
    setPendingCount(pending);

    if (!isOnline) {
      setBannerState("offline");
      setDismissed(false);
      return;
    }

    if (pending > 0) {
      setBannerState("syncing");
      return;
    }

    // Check rate staleness
    const cached = await getCachedRates();
    if (cached?.source === "stale") {
      setBannerState("stale_rates");
      return;
    }

    setBannerState(null); // all good — hide banner
  }, []);

  useEffect(() => {
    checkStatus();

    const handleOnline = () => {
      setBannerState("syncing");
      setTimeout(checkStatus, 2000); // give SW time to sync
    };
    const handleOffline = () => {
      setBannerState("offline");
      setDismissed(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for SW sync success messages
    const handleSwMessage = (e: MessageEvent) => {
      if (e.data?.type === "SYNC_SUCCESS") {
        checkStatus();
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    // Periodic check every 30s
    const interval = setInterval(checkStatus, 30_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
      clearInterval(interval);
    };
  }, [checkStatus]);

  if (!bannerState || bannerState === "online" || dismissed) return null;

  const config = BANNER_CONFIG[bannerState];

  return (
    <div
      className={`${config.color} text-white text-sm px-4 py-2 flex items-center justify-between z-50`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span
          className={bannerState === "syncing" ? "animate-spin inline-block" : ""}
          aria-hidden="true"
        >
          {config.icon}
        </span>
        <div>
          <span className="font-semibold">{config.message}</span>
          {pendingCount > 0 && bannerState !== "offline" && (
            <span className="ml-2 opacity-90">
              ({pendingCount} transfer{pendingCount !== 1 ? "s" : ""} queued)
            </span>
          )}
          {config.subtext && (
            <p className="text-xs opacity-90 mt-0.5">{config.subtext}</p>
          )}
        </div>
      </div>
      {bannerState !== "offline" && bannerState !== "syncing" && (
        <button
          onClick={() => setDismissed(true)}
          className="ml-4 opacity-75 hover:opacity-100 text-lg leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Hook version for components that need to react to connection state
 * without rendering a banner (e.g., to disable rate-lock button).
 */
export function useConnectionHealth() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isDegraded, setIsDegraded] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      setIsDegraded(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline, isDegraded, canLockRate: isOnline && !isDegraded };
}
