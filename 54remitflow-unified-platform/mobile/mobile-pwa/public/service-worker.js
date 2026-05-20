/**
 * Production Service Worker for Remittance Platform PWA
 * 
 * Features:
 * - App shell caching for instant loading
 * - Runtime caching with network-first/cache-first strategies
 * - Background sync for offline transactions
 * - Push notification handling
 * - Periodic sync for data freshness
 */

const CACHE_VERSION = 'v1.0.0';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;

// App shell resources - cached on install
const APP_SHELL_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/static/js/main.js',
  '/static/js/vendor.js',
  '/static/css/main.css',
  '/static/css/vendor.css',
  '/offline.html',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/fonts/inter-regular.woff2',
  '/fonts/inter-medium.woff2',
  '/fonts/inter-bold.woff2'
];

// API endpoints that should be cached
const CACHEABLE_API_PATTERNS = [
  /\/api\/v1\/config/,
  /\/api\/v1\/user\/profile/,
  /\/api\/v1\/agents\/nearby/,
  /\/api\/v1\/transactions\/history/,
  /\/api\/v1\/rates/
];

// API endpoints that should never be cached
const NO_CACHE_API_PATTERNS = [
  /\/api\/v1\/auth/,
  /\/api\/v1\/transactions\/create/,
  /\/api\/v1\/otp/,
  /\/api\/v1\/pin/
];

// ============================================================================
// Install Event - Cache App Shell
// ============================================================================

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => {
        console.log('[SW] Caching app shell resources');
        return cache.addAll(APP_SHELL_RESOURCES);
      })
      .then(() => {
        console.log('[SW] App shell cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache app shell:', error);
      })
  );
});

// ============================================================================
// Activate Event - Clean Old Caches
// ============================================================================

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  const currentCaches = [APP_SHELL_CACHE, RUNTIME_CACHE, API_CACHE, IMAGE_CACHE];
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => !currentCaches.includes(cacheName))
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// ============================================================================
// Fetch Event - Caching Strategies
// ============================================================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Determine caching strategy based on request type
  if (isAppShellRequest(url)) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
  } else if (isApiRequest(url)) {
    if (shouldCacheApi(url)) {
      event.respondWith(networkFirst(request, API_CACHE));
    } else {
      event.respondWith(networkOnly(request));
    }
  } else if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
  } else {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

// ============================================================================
// Caching Strategies
// ============================================================================

/**
 * Cache First - Try cache, fall back to network
 * Best for: App shell, static assets, images
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache first failed:', error);
    return caches.match('/offline.html');
  }
}

/**
 * Network First - Try network, fall back to cache
 * Best for: API requests, dynamic content
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Network Only - Always fetch from network
 * Best for: Auth, transactions, sensitive operations
 */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Network unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Stale While Revalidate - Return cache immediately, update in background
 * Best for: Non-critical dynamic content
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);
  
  return cachedResponse || fetchPromise || caches.match('/offline.html');
}

// ============================================================================
// Request Type Detection
// ============================================================================

function isAppShellRequest(url) {
  const pathname = url.pathname;
  return pathname === '/' ||
         pathname === '/index.html' ||
         pathname.startsWith('/static/') ||
         pathname.startsWith('/icons/') ||
         pathname.startsWith('/fonts/');
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isImageRequest(url) {
  return /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(url.pathname);
}

function shouldCacheApi(url) {
  const pathname = url.pathname;
  
  // Never cache sensitive endpoints
  if (NO_CACHE_API_PATTERNS.some(pattern => pattern.test(pathname))) {
    return false;
  }
  
  // Cache allowed endpoints
  return CACHEABLE_API_PATTERNS.some(pattern => pattern.test(pathname));
}

// ============================================================================
// Background Sync - Offline Transaction Queue
// ============================================================================

self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncOfflineTransactions());
  } else if (event.tag === 'sync-analytics') {
    event.waitUntil(syncAnalytics());
  }
});

async function syncOfflineTransactions() {
  console.log('[SW] Syncing offline transactions...');
  
  try {
    const db = await openIndexedDB();
    const transactions = await getOfflineTransactions(db);
    
    for (const transaction of transactions) {
      try {
        const response = await fetch('/api/v1/transactions/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Offline-Transaction': 'true'
          },
          body: JSON.stringify(transaction)
        });
        
        if (response.ok) {
          await deleteOfflineTransaction(db, transaction.id);
          console.log('[SW] Transaction synced:', transaction.id);
          
          // Notify user
          await notifyTransactionSynced(transaction);
        }
      } catch (error) {
        console.error('[SW] Failed to sync transaction:', transaction.id, error);
      }
    }
    
    console.log('[SW] Offline transaction sync complete');
  } catch (error) {
    console.error('[SW] Offline sync failed:', error);
  }
}

async function syncAnalytics() {
  console.log('[SW] Syncing analytics...');
  
  try {
    const db = await openIndexedDB();
    const events = await getOfflineAnalytics(db);
    
    if (events.length > 0) {
      const response = await fetch('/api/v1/analytics/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events })
      });
      
      if (response.ok) {
        await clearOfflineAnalytics(db);
        console.log('[SW] Analytics synced:', events.length, 'events');
      }
    }
  } catch (error) {
    console.error('[SW] Analytics sync failed:', error);
  }
}

// ============================================================================
// Push Notifications
// ============================================================================

self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let data = {
    title: 'Remittance Platform',
    body: 'You have a new notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: 'default',
    data: {}
  };
  
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    data: data.data,
    vibrate: [100, 50, 100],
    actions: getNotificationActions(data.type),
    requireInteraction: data.type === 'transaction'
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  
  event.notification.close();
  
  const data = event.notification.data || {};
  let url = '/';
  
  // Determine URL based on notification type
  switch (data.type) {
    case 'transaction':
      url = `/transactions/${data.transactionId}`;
      break;
    case 'promotion':
      url = `/promotions/${data.promotionId}`;
      break;
    case 'alert':
      url = '/alerts';
      break;
    case 'agent':
      url = `/agents/${data.agentId}`;
      break;
    default:
      url = data.url || '/';
  }
  
  // Handle action buttons
  if (event.action === 'view') {
    url = data.viewUrl || url;
  } else if (event.action === 'dismiss') {
    return;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Open new window
        return clients.openWindow(url);
      })
  );
});

function getNotificationActions(type) {
  switch (type) {
    case 'transaction':
      return [
        { action: 'view', title: 'View Details', icon: '/icons/view.png' },
        { action: 'dismiss', title: 'Dismiss', icon: '/icons/dismiss.png' }
      ];
    case 'promotion':
      return [
        { action: 'view', title: 'Learn More', icon: '/icons/learn.png' }
      ];
    default:
      return [];
  }
}

// ============================================================================
// Periodic Background Sync
// ============================================================================

self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
  
  if (event.tag === 'refresh-rates') {
    event.waitUntil(refreshExchangeRates());
  } else if (event.tag === 'refresh-agents') {
    event.waitUntil(refreshNearbyAgents());
  }
});

async function refreshExchangeRates() {
  try {
    const response = await fetch('/api/v1/rates');
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      await cache.put('/api/v1/rates', response);
      console.log('[SW] Exchange rates refreshed');
    }
  } catch (error) {
    console.error('[SW] Failed to refresh rates:', error);
  }
}

async function refreshNearbyAgents() {
  try {
    const response = await fetch('/api/v1/agents/nearby');
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      await cache.put('/api/v1/agents/nearby', response);
      console.log('[SW] Nearby agents refreshed');
    }
  } catch (error) {
    console.error('[SW] Failed to refresh agents:', error);
  }
}

// ============================================================================
// IndexedDB Helpers
// ============================================================================

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AgentBankingOffline', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('transactions')) {
        db.createObjectStore('transactions', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('analytics')) {
        db.createObjectStore('analytics', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

function getOfflineTransactions(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['transactions'], 'readonly');
    const store = transaction.objectStore('transactions');
    const request = store.getAll();
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function deleteOfflineTransaction(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['transactions'], 'readwrite');
    const store = transaction.objectStore('transactions');
    const request = store.delete(id);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function getOfflineAnalytics(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['analytics'], 'readonly');
    const store = transaction.objectStore('analytics');
    const request = store.getAll();
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function clearOfflineAnalytics(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['analytics'], 'readwrite');
    const store = transaction.objectStore('analytics');
    const request = store.clear();
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// ============================================================================
// User Notifications
// ============================================================================

async function notifyTransactionSynced(transaction) {
  const clients = await self.clients.matchAll({ type: 'window' });
  
  for (const client of clients) {
    client.postMessage({
      type: 'TRANSACTION_SYNCED',
      transaction: {
        id: transaction.id,
        amount: transaction.amount,
        type: transaction.type
      }
    });
  }
}

// ============================================================================
// Message Handling
// ============================================================================

self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CACHE_URLS':
      event.waitUntil(
        caches.open(RUNTIME_CACHE)
          .then((cache) => cache.addAll(event.data.urls))
      );
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      );
      break;
      
    case 'GET_CACHE_SIZE':
      event.waitUntil(
        getCacheSize().then((size) => {
          event.source.postMessage({ type: 'CACHE_SIZE', size });
        })
      );
      break;
  }
});

async function getCacheSize() {
  const cacheNames = await caches.keys();
  let totalSize = 0;
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.clone().blob();
        totalSize += blob.size;
      }
    }
  }
  
  return totalSize;
}

console.log('[SW] Service worker loaded');
