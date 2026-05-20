import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

const CACHE_VERSION = 'v1';
const CACHE_NAME = `remittance-pwa-${CACHE_VERSION}`;

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: `${CACHE_NAME}-images`,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/products'),
  new StaleWhileRevalidate({
    cacheName: `${CACHE_NAME}-products`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60,
      }),
    ],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: `${CACHE_NAME}-api`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

self.addEventListener('sync', (event) => {
  if (event.tag === 'order_data_sync') {
    event.waitUntil(syncOrderData());
  } else if (event.tag === 'product_data_sync') {
    event.waitUntil(syncProductData());
  } else if (event.tag === 'inventory_sync') {
    event.waitUntil(syncInventory());
  } else if (event.tag === 'marketplace_sync') {
    event.waitUntil(syncMarketplace());
  } else if (event.tag === 'forecast_sync') {
    event.waitUntil(syncForecast());
  }
});

async function syncOrderData() {
  try {
    const db = await openIndexedDB();
    const pendingOrders = await db.getAll('pendingSync');
    const orderSyncs = pendingOrders.filter(item => item.type === 'order_data_sync');
    
    for (const sync of orderSyncs) {
      await fetch('/api/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sync.data)
      });
      await db.delete('pendingSync', sync.id);
    }
  } catch (error) {
    console.error('Order sync failed:', error);
  }
}

async function syncProductData() {
  try {
    const db = await openIndexedDB();
    const pendingProducts = await db.getAll('pendingSync');
    const productSyncs = pendingProducts.filter(item => item.type === 'product_data_sync');
    
    for (const sync of productSyncs) {
      await fetch('/api/products/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sync.data)
      });
      await db.delete('pendingSync', sync.id);
    }
  } catch (error) {
    console.error('Product sync failed:', error);
  }
}

async function syncInventory() {
  try {
    const db = await openIndexedDB();
    const pendingInventory = await db.getAll('pendingSync');
    const inventorySyncs = pendingInventory.filter(item => item.type === 'inventory_sync');
    
    for (const sync of inventorySyncs) {
      await fetch('/api/inventory/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sync.data)
      });
      await db.delete('pendingSync', sync.id);
    }
  } catch (error) {
    console.error('Inventory sync failed:', error);
  }
}

async function syncMarketplace() {
  try {
    const db = await openIndexedDB();
    const pendingMarketplace = await db.getAll('pendingSync');
    const marketplaceSyncs = pendingMarketplace.filter(item => item.type === 'marketplace_sync');
    
    for (const sync of marketplaceSyncs) {
      await fetch('/api/marketplace/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sync.data)
      });
      await db.delete('pendingSync', sync.id);
    }
  } catch (error) {
    console.error('Marketplace sync failed:', error);
  }
}

async function syncForecast() {
  try {
    const db = await openIndexedDB();
    const pendingForecasts = await db.getAll('pendingSync');
    const forecastSyncs = pendingForecasts.filter(item => item.type === 'forecast_sync');
    
    for (const sync of forecastSyncs) {
      await fetch('/api/forecasts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sync.data)
      });
      await db.delete('pendingSync', sync.id);
    }
  } catch (error) {
    console.error('Forecast sync failed:', error);
  }
}

async function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AgentBankingPWA', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Remittance Platform';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    data: data,
    actions: data.actions || []
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (let client of windowClients) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('remittance-pwa-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  return self.clients.claim();
});
