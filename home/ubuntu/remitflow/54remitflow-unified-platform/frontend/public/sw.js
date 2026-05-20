// Remittance Platform Service Worker
// Version 1.0.0

const CACHE_NAME = 'remittance-v1.0.0';
const OFFLINE_URL = '/offline.html';
const FALLBACK_IMAGE = '/images/fallback-image.png';

// Resources to cache immediately
const STATIC_CACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/images/fallback-image.png'
];

// API endpoints that should be cached
const API_CACHE_PATTERNS = [
  /\/api\/agents/,
  /\/api\/transactions/,
  /\/api\/customers/,
  /\/api\/commission/,
  /\/api\/analytics/
];

// Resources that should always be fetched from network
const NETWORK_FIRST_PATTERNS = [
  /\/api\/auth/,
  /\/api\/notifications/,
  /\/api\/real-time/,
  /\/api\/sync/
];

// Install event - cache static resources
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching static resources');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        console.log('Static resources cached successfully');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Failed to cache static resources:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => cacheName !== CACHE_NAME)
            .map(cacheName => {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('Old caches cleaned up');
        return self.clients.claim();
      })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
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
  
  // Handle different request types with appropriate strategies
  if (isStaticResource(request)) {
    event.respondWith(cacheFirst(request));
  } else if (isAPIRequest(request)) {
    if (isNetworkFirstAPI(request)) {
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(staleWhileRevalidate(request));
    }
  } else if (isImageRequest(request)) {
    event.respondWith(cacheFirstWithFallback(request, FALLBACK_IMAGE));
  } else if (isNavigationRequest(request)) {
    event.respondWith(networkFirstWithOfflineFallback(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

// Cache-first strategy for static resources
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('Cache-first strategy failed:', error);
    return new Response('Resource not available', { status: 503 });
  }
}

// Network-first strategy for real-time data
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('Network failed, trying cache:', error);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response('Resource not available', { status: 503 });
  }
}

// Stale-while-revalidate strategy for API data
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(error => {
    console.log('Network request failed:', error);
    return null;
  });
  
  return cachedResponse || await fetchPromise || new Response('Resource not available', { status: 503 });
}

// Cache-first with fallback for images
async function cacheFirstWithFallback(request, fallbackUrl) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    
    return caches.match(fallbackUrl);
  } catch (error) {
    console.error('Image request failed:', error);
    return caches.match(fallbackUrl);
  }
}

// Network-first with offline fallback for navigation
async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    
    const cachedResponse = await caches.match(request);
    return cachedResponse || caches.match(OFFLINE_URL);
  } catch (error) {
    console.log('Navigation request failed, serving offline page:', error);
    const cachedResponse = await caches.match(request);
    return cachedResponse || caches.match(OFFLINE_URL);
  }
}

// Helper functions
function isStaticResource(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith('/static/') || 
         url.pathname.startsWith('/icons/') ||
         url.pathname.endsWith('.js') ||
         url.pathname.endsWith('.css') ||
         url.pathname.endsWith('.woff') ||
         url.pathname.endsWith('.woff2');
}

function isAPIRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith('/api/');
}

function isNetworkFirstAPI(request) {
  const url = new URL(request.url);
  return NETWORK_FIRST_PATTERNS.some(pattern => pattern.test(url.pathname));
}

function isImageRequest(request) {
  return request.destination === 'image' || 
         request.url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// Background sync for offline transactions
self.addEventListener('sync', event => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync-transactions') {
    event.waitUntil(syncOfflineTransactions());
  } else if (event.tag === 'background-sync-customer-data') {
    event.waitUntil(syncOfflineCustomerData());
  } else if (event.tag === 'background-sync-agent-data') {
    event.waitUntil(syncOfflineAgentData());
  }
});

// Sync offline transactions when connection is restored
async function syncOfflineTransactions() {
  try {
    console.log('Syncing offline transactions...');
    
    // Get offline transactions from IndexedDB
    const offlineTransactions = await getOfflineTransactions();
    
    for (const transaction of offlineTransactions) {
      try {
        const response = await fetch('/api/transactions/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transaction)
        });
        
        if (response.ok) {
          await removeOfflineTransaction(transaction.id);
          console.log('Transaction synced:', transaction.id);
        }
      } catch (error) {
        console.error('Failed to sync transaction:', transaction.id, error);
      }
    }
    
    console.log('Offline transaction sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Sync offline customer data
async function syncOfflineCustomerData() {
  try {
    console.log('Syncing offline customer data...');
    
    const offlineCustomers = await getOfflineCustomers();
    
    for (const customer of offlineCustomers) {
      try {
        const response = await fetch('/api/customers/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(customer)
        });
        
        if (response.ok) {
          await removeOfflineCustomer(customer.id);
          console.log('Customer synced:', customer.id);
        }
      } catch (error) {
        console.error('Failed to sync customer:', customer.id, error);
      }
    }
    
    console.log('Offline customer sync completed');
  } catch (error) {
    console.error('Customer sync failed:', error);
  }
}

// Sync offline agent data
async function syncOfflineAgentData() {
  try {
    console.log('Syncing offline agent data...');
    
    const offlineAgents = await getOfflineAgents();
    
    for (const agent of offlineAgents) {
      try {
        const response = await fetch('/api/agents/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(agent)
        });
        
        if (response.ok) {
          await removeOfflineAgent(agent.id);
          console.log('Agent synced:', agent.id);
        }
      } catch (error) {
        console.error('Failed to sync agent:', agent.id, error);
      }
    }
    
    console.log('Offline agent sync completed');
  } catch (error) {
    console.error('Agent sync failed:', error);
  }
}

// Push notification handling
self.addEventListener('push', event => {
  console.log('Push notification received:', event);
  
  if (!event.data) {
    return;
  }
  
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    image: data.image,
    data: data.data,
    actions: data.actions || [
      {
        action: 'view',
        title: 'View',
        icon: '/icons/action-view.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icons/action-dismiss.png'
      }
    ],
    tag: data.tag || 'remittance-notification',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    silent: data.silent || false,
    vibrate: data.vibrate || [200, 100, 200],
    timestamp: Date.now()
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click handling
self.addEventListener('notificationclick', event => {
  console.log('Notification clicked:', event);
  
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data;
  
  if (action === 'dismiss') {
    return;
  }
  
  let url = '/';
  if (data && data.url) {
    url = data.url;
  } else if (action === 'view' && data && data.transactionId) {
    url = `/transactions/${data.transactionId}`;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      // Check if there's already a window/tab open with the target URL
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      
      // If no existing window/tab, open a new one
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Message handling for communication with main thread
self.addEventListener('message', event => {
  console.log('Service Worker received message:', event.data);
  
  if (event.data && event.data.type) {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
      case 'GET_VERSION':
        event.ports[0].postMessage({ version: CACHE_NAME });
        break;
      case 'CLEAR_CACHE':
        event.waitUntil(clearAllCaches());
        break;
      case 'CACHE_URLS':
        event.waitUntil(cacheUrls(event.data.urls));
        break;
      default:
        console.log('Unknown message type:', event.data.type);
    }
  }
});

// Utility functions for IndexedDB operations (simplified)
async function getOfflineTransactions() {
  // In a real implementation, this would use IndexedDB
  return [];
}

async function removeOfflineTransaction(id) {
  // In a real implementation, this would remove from IndexedDB
  console.log('Removing offline transaction:', id);
}

async function getOfflineCustomers() {
  // In a real implementation, this would use IndexedDB
  return [];
}

async function removeOfflineCustomer(id) {
  // In a real implementation, this would remove from IndexedDB
  console.log('Removing offline customer:', id);
}

async function getOfflineAgents() {
  // In a real implementation, this would use IndexedDB
  return [];
}

async function removeOfflineAgent(id) {
  // In a real implementation, this would remove from IndexedDB
  console.log('Removing offline agent:', id);
}

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('All caches cleared');
}

async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(urls);
  console.log('URLs cached:', urls);
}

// Periodic background sync for data updates
self.addEventListener('periodicsync', event => {
  console.log('Periodic sync triggered:', event.tag);
  
  if (event.tag === 'agent-data-sync') {
    event.waitUntil(performPeriodicSync());
  }
});

async function performPeriodicSync() {
  try {
    console.log('Performing periodic sync...');
    
    // Sync critical data in background
    await Promise.all([
      syncOfflineTransactions(),
      syncOfflineCustomerData(),
      syncOfflineAgentData()
    ]);
    
    // Update cached data
    const criticalUrls = [
      '/api/agents/hierarchy',
      '/api/commission/summary',
      '/api/analytics/dashboard'
    ];
    
    for (const url of criticalUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(url, response.clone());
        }
      } catch (error) {
        console.error('Failed to update cached data:', url, error);
      }
    }
    
    console.log('Periodic sync completed');
  } catch (error) {
    console.error('Periodic sync failed:', error);
  }
}

console.log('Remittance Platform Service Worker loaded successfully');
