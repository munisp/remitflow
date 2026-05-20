// Service Worker for Video KYC PWA
// Provides offline functionality, caching, and background sync

const CACHE_NAME = 'video-kyc-v1.0.0';
const STATIC_CACHE = 'video-kyc-static-v1.0.0';
const DYNAMIC_CACHE = 'video-kyc-dynamic-v1.0.0';

// Files to cache for offline functionality
const STATIC_FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/js/app.js',
    '/js/video-recorder.js',
    '/js/face-detection.js',
    '/js/sync-manager.js',
    '/js/power-manager.js',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/icons/icon-32x32.png',
    '/icons/icon-16x16.png'
];

// API endpoints that should be cached
const API_CACHE_PATTERNS = [
    /\/api\/health/,
    /\/api\/config/,
    /\/api\/power\/profile/
];

// API endpoints that should trigger background sync
const SYNC_PATTERNS = [
    /\/api\/sessions/,
    /\/api\/videos/,
    /\/api\/sync/
];

// Install event - cache static files
self.addEventListener('install', event => {
    console.log('Service Worker installing...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('Caching static files...');
                return cache.addAll(STATIC_FILES);
            })
            .then(() => {
                console.log('Static files cached successfully');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('Error caching static files:', error);
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
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && 
                            cacheName !== DYNAMIC_CACHE &&
                            cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('Service Worker activated');
                return self.clients.claim();
            })
    );
});

// Fetch event - handle network requests
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Handle different types of requests
    if (request.method === 'GET') {
        if (isStaticFile(request.url)) {
            // Static files - cache first strategy
            event.respondWith(cacheFirst(request));
        } else if (isAPIRequest(url)) {
            // API requests - network first with cache fallback
            event.respondWith(networkFirstWithCache(request));
        } else {
            // Other requests - network first
            event.respondWith(networkFirst(request));
        }
    } else if (request.method === 'POST' || request.method === 'PUT') {
        // Handle POST/PUT requests for background sync
        if (shouldSync(request.url)) {
            event.respondWith(handleSyncRequest(request));
        } else {
            event.respondWith(fetch(request));
        }
    }
});

// Background sync event
self.addEventListener('sync', event => {
    console.log('Background sync triggered:', event.tag);
    
    if (event.tag === 'video-kyc-sync') {
        event.waitUntil(performBackgroundSync());
    } else if (event.tag === 'video-upload') {
        event.waitUntil(uploadPendingVideos());
    } else if (event.tag === 'session-sync') {
        event.waitUntil(syncPendingSessions());
    }
});

// Push notification event
self.addEventListener('push', event => {
    console.log('Push notification received:', event);
    
    const options = {
        body: event.data ? event.data.text() : 'Video KYC sync completed',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-32x32.png',
        vibrate: [200, 100, 200],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Open App',
                icon: '/icons/icon-32x32.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: '/icons/icon-32x32.png'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('Video KYC', options)
    );
});

// Notification click event
self.addEventListener('notificationclick', event => {
    console.log('Notification clicked:', event);
    
    event.notification.close();
    
    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Message event - handle messages from main thread
self.addEventListener('message', event => {
    console.log('Service Worker received message:', event.data);
    
    if (event.data && event.data.type) {
        switch (event.data.type) {
            case 'SKIP_WAITING':
                self.skipWaiting();
                break;
            case 'CACHE_VIDEO':
                cacheVideo(event.data.videoData);
                break;
            case 'TRIGGER_SYNC':
                triggerBackgroundSync();
                break;
            case 'GET_CACHE_STATUS':
                getCacheStatus().then(status => {
                    event.ports[0].postMessage(status);
                });
                break;
        }
    }
});

// Utility functions

function isStaticFile(url) {
    return STATIC_FILES.some(file => url.endsWith(file)) ||
           url.includes('/icons/') ||
           url.includes('/js/') ||
           url.includes('/css/');
}

function isAPIRequest(url) {
    return url.pathname.startsWith('/api/');
}

function shouldSync(url) {
    return SYNC_PATTERNS.some(pattern => pattern.test(url));
}

function shouldCache(url) {
    return API_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// Caching strategies

async function cacheFirst(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.error('Cache first strategy failed:', error);
        return new Response('Offline', { status: 503 });
    }
}

async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Network failed, trying cache:', error);
        
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response('Offline', { status: 503 });
    }
}

async function networkFirstWithCache(request) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok && shouldCache(request.url)) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Network failed for API request, trying cache:', error);
        
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return offline response for API requests
        return new Response(JSON.stringify({
            error: 'Offline',
            message: 'This request will be retried when connection is restored',
            offline: true
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Background sync functions

async function handleSyncRequest(request) {
    try {
        // Try to make the request immediately
        const response = await fetch(request);
        
        if (response.ok) {
            return response;
        } else {
            throw new Error('Network request failed');
        }
    } catch (error) {
        console.log('Request failed, storing for background sync:', error);
        
        // Store request for background sync
        await storeRequestForSync(request);
        
        // Register background sync
        await registerBackgroundSync('video-kyc-sync');
        
        // Return success response (request will be retried in background)
        return new Response(JSON.stringify({
            success: true,
            message: 'Request queued for background sync',
            queued: true
        }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function storeRequestForSync(request) {
    try {
        const requestData = {
            url: request.url,
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            body: request.method !== 'GET' ? await request.text() : null,
            timestamp: Date.now()
        };
        
        // Store in IndexedDB
        const db = await openSyncDB();
        const transaction = db.transaction(['sync_queue'], 'readwrite');
        const store = transaction.objectStore('sync_queue');
        
        await store.add({
            id: generateId(),
            request: requestData,
            retries: 0,
            maxRetries: 3,
            status: 'pending'
        });
        
        console.log('Request stored for sync:', requestData.url);
    } catch (error) {
        console.error('Error storing request for sync:', error);
    }
}

async function performBackgroundSync() {
    console.log('Performing background sync...');
    
    try {
        const db = await openSyncDB();
        const transaction = db.transaction(['sync_queue'], 'readwrite');
        const store = transaction.objectStore('sync_queue');
        
        const pendingRequests = await store.getAll();
        
        for (const item of pendingRequests) {
            if (item.status === 'pending' && item.retries < item.maxRetries) {
                try {
                    const request = new Request(item.request.url, {
                        method: item.request.method,
                        headers: item.request.headers,
                        body: item.request.body
                    });
                    
                    const response = await fetch(request);
                    
                    if (response.ok) {
                        // Success - remove from queue
                        await store.delete(item.id);
                        console.log('Background sync successful:', item.request.url);
                    } else {
                        // Failed - increment retry count
                        item.retries++;
                        if (item.retries >= item.maxRetries) {
                            item.status = 'failed';
                        }
                        await store.put(item);
                    }
                } catch (error) {
                    console.error('Background sync failed:', error);
                    
                    // Increment retry count
                    item.retries++;
                    if (item.retries >= item.maxRetries) {
                        item.status = 'failed';
                    }
                    await store.put(item);
                }
            }
        }
        
        // Notify main thread of sync completion
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_COMPLETED',
                timestamp: Date.now()
            });
        });
        
    } catch (error) {
        console.error('Error in background sync:', error);
    }
}

async function uploadPendingVideos() {
    console.log('Uploading pending videos...');
    
    try {
        const db = await openSyncDB();
        const transaction = db.transaction(['video_queue'], 'readwrite');
        const store = transaction.objectStore('video_queue');
        
        const pendingVideos = await store.getAll();
        
        for (const video of pendingVideos) {
            try {
                const formData = new FormData();
                formData.append('video', video.blob, 'video.mp4');
                formData.append('session_id', video.sessionId);
                formData.append('metadata', JSON.stringify(video.metadata));
                
                const response = await fetch('/api/videos/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    await store.delete(video.id);
                    console.log('Video uploaded successfully:', video.id);
                } else {
                    console.error('Video upload failed:', response.status);
                }
            } catch (error) {
                console.error('Error uploading video:', error);
            }
        }
    } catch (error) {
        console.error('Error in video upload sync:', error);
    }
}

async function syncPendingSessions() {
    console.log('Syncing pending sessions...');
    
    try {
        const db = await openSyncDB();
        const transaction = db.transaction(['session_queue'], 'readwrite');
        const store = transaction.objectStore('session_queue');
        
        const pendingSessions = await store.getAll();
        
        for (const session of pendingSessions) {
            try {
                const response = await fetch('/api/sessions/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(session.data)
                });
                
                if (response.ok) {
                    await store.delete(session.id);
                    console.log('Session synced successfully:', session.id);
                } else {
                    console.error('Session sync failed:', response.status);
                }
            } catch (error) {
                console.error('Error syncing session:', error);
            }
        }
    } catch (error) {
        console.error('Error in session sync:', error);
    }
}

// IndexedDB functions

async function openSyncDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('VideoKYCSyncDB', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create object stores
            if (!db.objectStoreNames.contains('sync_queue')) {
                const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
                syncStore.createIndex('status', 'status', { unique: false });
            }
            
            if (!db.objectStoreNames.contains('video_queue')) {
                const videoStore = db.createObjectStore('video_queue', { keyPath: 'id' });
                videoStore.createIndex('sessionId', 'sessionId', { unique: false });
            }
            
            if (!db.objectStoreNames.contains('session_queue')) {
                const sessionStore = db.createObjectStore('session_queue', { keyPath: 'id' });
                sessionStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

async function registerBackgroundSync(tag) {
    try {
        await self.registration.sync.register(tag);
        console.log('Background sync registered:', tag);
    } catch (error) {
        console.error('Background sync registration failed:', error);
    }
}

async function triggerBackgroundSync() {
    try {
        await registerBackgroundSync('video-kyc-sync');
        await registerBackgroundSync('video-upload');
        await registerBackgroundSync('session-sync');
    } catch (error) {
        console.error('Error triggering background sync:', error);
    }
}

async function cacheVideo(videoData) {
    try {
        const db = await openSyncDB();
        const transaction = db.transaction(['video_queue'], 'readwrite');
        const store = transaction.objectStore('video_queue');
        
        await store.add({
            id: generateId(),
            blob: videoData.blob,
            sessionId: videoData.sessionId,
            metadata: videoData.metadata,
            timestamp: Date.now()
        });
        
        console.log('Video cached for offline sync');
    } catch (error) {
        console.error('Error caching video:', error);
    }
}

async function getCacheStatus() {
    try {
        const cacheNames = await caches.keys();
        const totalSize = await calculateCacheSize();
        
        const db = await openSyncDB();
        const syncTransaction = db.transaction(['sync_queue'], 'readonly');
        const syncStore = syncTransaction.objectStore('sync_queue');
        const pendingSync = await syncStore.count();
        
        const videoTransaction = db.transaction(['video_queue'], 'readonly');
        const videoStore = videoTransaction.objectStore('video_queue');
        const pendingVideos = await videoStore.count();
        
        return {
            caches: cacheNames.length,
            totalSize: totalSize,
            pendingSync: pendingSync,
            pendingVideos: pendingVideos,
            timestamp: Date.now()
        };
    } catch (error) {
        console.error('Error getting cache status:', error);
        return null;
    }
}

async function calculateCacheSize() {
    try {
        const cacheNames = await caches.keys();
        let totalSize = 0;
        
        for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            
            for (const request of requests) {
                const response = await cache.match(request);
                if (response) {
                    const blob = await response.blob();
                    totalSize += blob.size;
                }
            }
        }
        
        return totalSize;
    } catch (error) {
        console.error('Error calculating cache size:', error);
        return 0;
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Periodic cleanup
setInterval(async () => {
    try {
        // Clean up old cache entries
        const cache = await caches.open(DYNAMIC_CACHE);
        const requests = await cache.keys();
        
        // Remove entries older than 24 hours
        const cutoff = Date.now() - (24 * 60 * 60 * 1000);
        
        for (const request of requests) {
            const response = await cache.match(request);
            if (response) {
                const dateHeader = response.headers.get('date');
                if (dateHeader && new Date(dateHeader).getTime() < cutoff) {
                    await cache.delete(request);
                }
            }
        }
        
        console.log('Cache cleanup completed');
    } catch (error) {
        console.error('Error in cache cleanup:', error);
    }
}, 60 * 60 * 1000); // Run every hour

