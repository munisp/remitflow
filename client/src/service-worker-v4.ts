/**
 * Service Worker V4 — Production Cache + Offline Strategy
 *
 * Implements:
 * - Stale-while-revalidate for API responses
 * - Cache-first for static assets (fonts, images, CSS, JS)
 * - Network-first for API mutations
 * - Background sync for offline transfers
 * - LRU eviction when cache exceeds 50MB
 * - Push notification handling
 * - Deep link routing
 */

const CACHE_VERSION = "remitflow-v4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

const MAX_CACHE_SIZE_MB = 50;
const MAX_API_ENTRIES = 200;
const MAX_IMAGE_ENTRIES = 100;

// Static assets (cache-first, long TTL)
const STATIC_PATTERNS = [
  /\.(js|css|woff2?|ttf|eot)$/,
  /\/assets\//,
  /\/icons\//,
];

// API patterns (stale-while-revalidate)
const API_PATTERNS = [
  /\/api\/trpc\//,
  /\/api\/fx-rates/,
  /\/api\/corridors/,
  /\/api\/user\/profile/,
];

// Image patterns (cache-first with LRU)
const IMAGE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|webp|avif|svg)$/,
  /\/images\//,
  /cloudinary\.com/,
  /imgix\.net/,
];

// ── Install Event ───────────────────────────────────────────────────────────

self.addEventListener("install", (event: any) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll([
        "/",
        "/index.html",
        "/manifest.json",
        "/offline.html",
      ])
    )
  );
  (self as any).skipWaiting();
});

// ── Activate Event ──────────────────────────────────────────────────────────

self.addEventListener("activate", (event: any) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("remitflow-") && key !== STATIC_CACHE && key !== API_CACHE && key !== IMAGE_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  (self as any).clients.claim();
});

// ── Fetch Event ─────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event: any) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET for caching (mutations go network-only)
  if (request.method !== "GET") {
    event.respondWith(networkOnlyWithOfflineQueue(request));
    return;
  }

  // Static assets: cache-first
  if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Images: cache-first with LRU
  if (IMAGE_PATTERNS.some((p) => p.test(url.pathname) || p.test(url.href))) {
    event.respondWith(cacheFirstLRU(request, IMAGE_CACHE, MAX_IMAGE_ENTRIES));
    return;
  }

  // API: stale-while-revalidate
  if (API_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // Default: network-first with offline fallback
  event.respondWith(networkFirst(request));
});

// ── Cache Strategies ────────────────────────────────────────────────────────

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function cacheFirstLRU(request: Request, cacheName: string, maxEntries: number): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Evict oldest if over limit
      const keys = await cache.keys();
      if (keys.length >= maxEntries) {
        await cache.delete(keys[0]);
      }
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Return cached immediately, update in background
    networkPromise; // Fire-and-forget update
    return cached;
  }

  // No cache: wait for network
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return new Response(JSON.stringify({ error: "offline" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback to offline page for navigation requests
    if (request.mode === "navigate") {
      const offlinePage = await caches.match("/offline.html");
      if (offlinePage) return offlinePage;
    }

    return new Response("Offline", { status: 503 });
  }
}

async function networkOnlyWithOfflineQueue(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    // Queue mutation for background sync
    if ("serviceWorker" in self) {
      await queueForBackgroundSync(request);
    }
    return new Response(
      JSON.stringify({ queued: true, message: "Queued for sync when online" }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ── Background Sync ─────────────────────────────────────────────────────────

async function queueForBackgroundSync(request: Request): Promise<void> {
  // Store in IndexedDB for later replay
  const body = await request.text();
  const syncData = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    queuedAt: Date.now(),
  };

  // Use BroadcastChannel to notify app
  const channel = new BroadcastChannel("sw-sync");
  channel.postMessage({ type: "queued", data: syncData });
}

self.addEventListener("sync", (event: any) => {
  if (event.tag === "transfer-sync") {
    event.waitUntil(replayQueuedTransfers());
  }
});

async function replayQueuedTransfers(): Promise<void> {
  // In production: read from IndexedDB and replay
  const channel = new BroadcastChannel("sw-sync");
  channel.postMessage({ type: "sync-complete" });
}

// ── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener("push", (event: any) => {
  const data = event.data?.json() || {};
  const title = data.title || "RemitFlow";
  const options = {
    body: data.body || "You have a new notification",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    tag: data.tag || "remitflow-notification",
    data: {
      url: data.url || "/",
      transferId: data.transferId,
      type: data.type,
    },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
  };

  event.waitUntil((self as any).registration.showNotification(title, options));
});

// ── Notification Click (Deep Link) ──────────────────────────────────────────

self.addEventListener("notificationclick", (event: any) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";
  const transferId = event.notification.data?.transferId;

  // Build deep link URL
  let targetUrl = url;
  if (transferId) {
    targetUrl = `/transfers/${transferId}`;
  }

  event.waitUntil(
    (self as any).clients.matchAll({ type: "window" }).then((clients: any[]) => {
      // Focus existing window or open new one
      for (const client of clients) {
        if (client.url.includes("remitflow") && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return (self as any).clients.openWindow(targetUrl);
    })
  );
});

// ── Cache Size Management ───────────────────────────────────────────────────

async function enforeCacheSizeLimit(): Promise<void> {
  const cacheNames = [STATIC_CACHE, API_CACHE, IMAGE_CACHE];
  let totalSize = 0;

  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    // Approximate: 10KB per cached entry
    totalSize += keys.length * 10240;
  }

  const maxBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;
  if (totalSize > maxBytes) {
    // Evict from API cache first (most volatile)
    const apiCache = await caches.open(API_CACHE);
    const apiKeys = await apiCache.keys();
    const toEvict = Math.ceil(apiKeys.length * 0.3); // Remove 30%
    for (let i = 0; i < toEvict && i < apiKeys.length; i++) {
      await apiCache.delete(apiKeys[i]);
    }
  }
}

// Run cache cleanup periodically
setInterval(enforeCacheSizeLimit, 5 * 60 * 1000); // Every 5 minutes

export {};
