/**
 * usePWA.ts — Comprehensive PWA hooks for RemitFlow
 * Covers: install prompt, push notifications, offline status,
 *         background sync, cache status, periodic sync, share target
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export type PWAInstallStatus = "installed" | "installable" | "browser" | "unknown";

export interface PWAInstallState {
  status: PWAInstallStatus;
  canInstall: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  install: () => Promise<boolean>;
  dismiss: () => void;
}

export interface PushNotificationState {
  permission: NotificationPermission;
  isSupported: boolean;
  isSubscribed: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  sendTestNotification: () => void;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
}

export interface OfflineStatusState {
  isOnline: boolean;
  isOffline: boolean;
  lastOnline: Date | null;
  connectionType: string;
  effectiveType: string;
}

export interface BackgroundSyncState {
  isSupported: boolean;
  pendingCount: number;
  registerSync: (tag: string) => Promise<boolean>;
  clearQueue: () => void;
}

export interface CacheStatusState {
  isSupported: boolean;
  totalSize: number;
  totalSizeFormatted: string;
  cacheNames: string[];
  refresh: () => Promise<void>;
}

export interface PeriodicSyncState {
  isSupported: boolean;
  registrations: string[];
  register: (tag: string, minInterval?: number) => Promise<boolean>;
  unregister: (tag: string) => Promise<boolean>;
}

// ─── useInstallPrompt ─────────────────────────────────────────────────────────

export function useInstallPrompt(): PWAInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<PWAInstallStatus>("unknown");

  const isIOS =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  const isAndroid =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

  useEffect(() => {
    // Check if already installed (standalone mode)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      setStatus("installed");
      return;
    }

    // iOS doesn't fire beforeinstallprompt
    if (isIOS) {
      setStatus("installable");
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setStatus("installable");
    };

    window.addEventListener("beforeinstallprompt", handler);

    const appInstalled = () => {
      setDeferredPrompt(null);
      setStatus("installed");
    };
    window.addEventListener("appinstalled", appInstalled);

    // If no prompt after 3s, assume browser mode
    const timer = setTimeout(() => {
      setStatus((prev) => (prev === "unknown" ? "browser" : prev));
    }, 3000);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", appInstalled);
      clearTimeout(timer);
    };
  }, [isIOS]);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (outcome === "accepted") {
        setStatus("installed");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setDeferredPrompt(null);
  }, []);

  return {
    status,
    canInstall: status === "installable" && !isIOS,
    isInstalled: status === "installed",
    isIOS,
    isAndroid,
    install,
    dismiss,
  };
}

// ─── usePushNotifications ─────────────────────────────────────────────────────

export function usePushNotifications(): PushNotificationState {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  const isSupported =
    typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  useEffect(() => {
    if (!isSupported) return;
    // Check existing subscription
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setIsSubscribed(!!sub))
      .catch(() => {});
  }, [isSupported]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) return "denied";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [isSupported]);

  const sendTestNotification = useCallback(() => {
    if (permission !== "granted") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification("RemitFlow", {
          body: "🚀 Push notifications are working! Your transfers will be tracked in real-time.",
          icon: "/manus-storage/icon-192_d0405887.png",
          badge: "/manus-storage/icon-192_d0405887.png",
          tag: "test-notification",
          data: { url: "/dashboard" },
        } as NotificationOptions);
      });
    } else if (permission === "granted") {
      new Notification("RemitFlow", {
        body: "🚀 Push notifications are working!",
        icon: "/manus-storage/icon-192_d0405887.png",
      });
    }
  }, [permission]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported || permission !== "granted") return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          // Demo VAPID public key — replace with real key in production
          "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U"
        ) as BufferSource,
      });
      setIsSubscribed(!!sub);
      return true;
    } catch {
      return false;
    }
  }, [isSupported, permission]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        setIsSubscribed(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [isSupported]);

  return {
    permission,
    isSupported,
    isSubscribed,
    requestPermission,
    sendTestNotification,
    subscribe,
    unsubscribe,
  };
}

// ─── useOfflineStatus ─────────────────────────────────────────────────────────

export function useOfflineStatus(): OfflineStatusState {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [lastOnline, setLastOnline] = useState<Date | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastOnline(new Date());
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const connection = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection;

  return {
    isOnline,
    isOffline: !isOnline,
    lastOnline,
    connectionType: connection?.type ?? "unknown",
    effectiveType: connection?.effectiveType ?? "unknown",
  };
}

// ─── useBackgroundSync ────────────────────────────────────────────────────────

export function useBackgroundSync(): BackgroundSyncState {
  const [pendingCount, setPendingCount] = useState(0);
  const queueRef = useRef<string[]>([]);

  const isSupported =
    "serviceWorker" in navigator && "SyncManager" in window;

  const registerSync = useCallback(async (tag: string): Promise<boolean> => {
    if (!isSupported) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register(tag);
      queueRef.current = [...queueRef.current, tag];
      setPendingCount((c) => c + 1);
      return true;
    } catch {
      return false;
    }
  }, [isSupported]);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setPendingCount(0);
  }, []);

  return { isSupported, pendingCount, registerSync, clearQueue };
}

// ─── useCacheStatus ───────────────────────────────────────────────────────────

export function useCacheStatus(): CacheStatusState {
  const [totalSize, setTotalSize] = useState(0);
  const [cacheNames, setCacheNames] = useState<string[]>([]);

  const isSupported = "caches" in window;

  const refresh = useCallback(async () => {
    if (!isSupported) return;
    try {
      const names = await caches.keys();
      setCacheNames(names);
      let size = 0;
      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        for (const req of keys) {
          const res = await cache.match(req);
          if (res) {
            const blob = await res.blob();
            size += blob.size;
          }
        }
      }
      setTotalSize(size);
    } catch {
      // Cache API may be restricted in some contexts
    }
  }, [isSupported]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return {
    isSupported,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    cacheNames,
    refresh,
  };
}

// ─── usePeriodicSync ──────────────────────────────────────────────────────────

export function usePeriodicSync(): PeriodicSyncState {
  const [registrations, setRegistrations] = useState<string[]>([]);

  const isSupported =
    "serviceWorker" in navigator &&
    "PeriodicSyncManager" in window;

  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.ready
      .then((reg) => {
        const psm = (reg as unknown as { periodicSync?: { getTags: () => Promise<string[]> } }).periodicSync;
        return psm?.getTags() ?? Promise.resolve([]);
      })
      .then((tags) => setRegistrations(tags))
      .catch(() => {});
  }, [isSupported]);

  const register = useCallback(async (tag: string, minInterval = 24 * 60 * 60 * 1000): Promise<boolean> => {
    if (!isSupported) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const psm = (reg as unknown as { periodicSync?: { register: (tag: string, opts: object) => Promise<void>; getTags: () => Promise<string[]> } }).periodicSync;
      if (!psm) return false;
      await psm.register(tag, { minInterval });
      const tags = await psm.getTags();
      setRegistrations(tags);
      return true;
    } catch {
      return false;
    }
  }, [isSupported]);

  const unregister = useCallback(async (tag: string): Promise<boolean> => {
    if (!isSupported) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const psm = (reg as unknown as { periodicSync?: { unregister: (tag: string) => Promise<void>; getTags: () => Promise<string[]> } }).periodicSync;
      if (!psm) return false;
      await psm.unregister(tag);
      const tags = await psm.getTags();
      setRegistrations(tags);
      return true;
    } catch {
      return false;
    }
  }, [isSupported]);

  return { isSupported, registrations, register, unregister };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
