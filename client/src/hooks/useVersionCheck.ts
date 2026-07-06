import { useEffect, useRef, useCallback } from "react";

const VERSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const currentBuildHash = typeof __BUILD_HASH__ !== "undefined" ? __BUILD_HASH__ : "dev";

interface VersionInfo {
  hash: string;
  timestamp: string;
  version: string;
}

export function useVersionCheck() {
  const lastKnownHash = useRef(currentBuildHash);

  const checkVersion = useCallback(async () => {
    if (currentBuildHash === "dev") return;

    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;

      const info: VersionInfo = await res.json();
      if (info.hash !== "dev" && info.hash !== lastKnownHash.current) {
        lastKnownHash.current = info.hash;

        if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            reg.update();
          }
        }
      }
    } catch {
      // Network error — skip this check
    }
  }, []);

  useEffect(() => {
    // Check on mount (page load / navigation)
    checkVersion();

    // Periodic polling
    const interval = setInterval(checkVersion, VERSION_CHECK_INTERVAL);

    // Check when tab becomes visible (user returns from another tab)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkVersion();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Listen for SW update messages
    const onSWMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATED") {
        window.location.reload();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSWMessage);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker?.removeEventListener("message", onSWMessage);
    };
  }, [checkVersion]);

  return { buildHash: currentBuildHash };
}
