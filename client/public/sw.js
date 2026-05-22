// RemitFlow Service Worker v23 — Tier 1/2/3 feature routes + PBAC-aware caching
// Strategies: Cache-First (static), Network-First (API), Stale-While-Revalidate (FX + Community + Revenue Share + New CRUD)
// Features: Offline fallback, Background sync, Push notifications, Periodic sync, Revenue Share offline cache
// v170 additions: universal-fx + crypto rate caching, offline transfer queue replay, delta-rate sync tag
// v176 additions: Agent POS, My Transfers, Support Tickets, Rails Health, Crypto Custody, Agent Onboarding
// v204 additions: Form M history, HNW banking, CBN compliance, BDC portal, SME trade routes cached
// v23 additions: Tier 1 (Expense, Contractor, KYB, Payroll Tax), Tier 2 (Savings, Bonds, LC, Invoice Financing, Payroll Run), Tier 3 (Embedded Payroll, Mortgage, Credit Scoring, ESG)

const CACHE_VERSION = 'v23';
const STATIC_CACHE = `remitflow-static-${CACHE_VERSION}`;
const API_CACHE = `remitflow-api-${CACHE_VERSION}`;
const FX_CACHE = `remitflow-fx-${CACHE_VERSION}`;
const COMMUNITY_CACHE = `remitflow-community-${CACHE_VERSION}`;
const REVENUE_SHARE_CACHE = `remitflow-revenue-share-${CACHE_VERSION}`;

// Only pre-cache true static files, NOT SPA routes (which require auth checks)
const STATIC_ASSETS = [
  '/manifest.json', '/revenue-share-manifest.json', '/favicon.ico'
];

// v170: Universal FX + crypto rate patterns (15-min SWR)
const UNIVERSAL_FX_PATTERNS = [
  '/api/trpc/universalConversion.getRates',
  '/api/trpc/universalConversion.getQuote',
  '/api/trpc/cryptoTransfer.getSupportedAssets',
  '/api/trpc/papss.getFxRates',
];

const REVENUE_SHARE_API_PATTERNS = [
  '/api/trpc/revenueShare.myAgreement',
  '/api/trpc/revenueShare.myEarnings',
  '/api/trpc/revenueShare.listReports',
  '/api/trpc/revenueShare.adminAnalytics',
];

// v176: New page API patterns (Agent POS, Transfers, Support, Crypto, Rails Health)
const V176_API_PATTERNS = [
  '/api/trpc/posAgentCashFlow.agentStats',
  '/api/trpc/posAgentCashFlow.todayTransactions',
  '/api/trpc/transfers.list',
  '/api/trpc/support.tickets',
  '/api/trpc/newRails.railHealth',
  '/api/trpc/cryptoCustody.getBalance',
  '/api/trpc/agentOnboarding.myApplication',
];

// v23: Tier 1/2/3 Business Finance, Trade Finance, Advanced Products (5-min SWR)
const V23_TIER_API_PATTERNS = [
  // Tier 1 — Business Finance
  '/api/trpc/contractorPayments.listInvoices',
  '/api/trpc/contractorPayments.list',
  '/api/trpc/expenseManagement.listReports',
  '/api/trpc/expenseManagement.listPolicies',
  '/api/trpc/merchantKybReview.getMyStatus',
  '/api/trpc/merchantKybReview.adminList',
  '/api/trpc/payrollTaxFiling.list',
  // Tier 2 — Trade Finance
  '/api/trpc/businessSavings.list',
  '/api/trpc/businessSavings.listProducts',
  '/api/trpc/bondSecondaryMarket.listOpenOrders',
  '/api/trpc/bondSecondaryMarket.myOrders',
  '/api/trpc/letterOfCredit.list',
  '/api/trpc/invoiceFinancing.list',
  '/api/trpc/globalPayroll.listCompanies',
  '/api/trpc/globalPayroll.listRuns',
  // Tier 3 — Advanced Products
  '/api/trpc/embeddedPayrollApi.listApiKeys',
  '/api/trpc/embeddedPayrollApi.listRequests',
  '/api/trpc/diasporaMortgage.list',
  '/api/trpc/businessCreditScoring.getScore',
  '/api/trpc/esgReporting.list',
];

// v204: Form M, HNW banking, CBN compliance, BDC portal, SME trade (5-min SWR)
const V204_API_PATTERNS = [
  '/api/trpc/smeTrade.listFormMHistory',
  '/api/trpc/smeTrade.getFormMDocument',
  '/api/trpc/smeTrade.listFormMDocumentsAdmin',
  '/api/trpc/hnwBanking.getClientProfile',
  '/api/trpc/hnwBanking.getPortfolioSummary',
  '/api/trpc/hnwBanking.getRateLockQuote',
  '/api/trpc/cbnCompliance.listBdcPartners',
  '/api/trpc/cbnCompliance.getComplianceDashboard',
  '/api/trpc/cbnCompliance.getAllRatePairs',
  '/api/trpc/cbnCompliance.getCbnCorridors',
];

// Future-proofing APIs — SWR (5-min TTL for read endpoints)
const FUTURE_PROOFING_API_PATTERNS = [
  '/api/trpc/futureProofing.getPredictiveTransfers',
  '/api/trpc/futureProofing.getFxForecast',
  '/api/trpc/futureProofing.smartBeneficiaryMatch',
  '/api/trpc/futureProofing.getConnectedAccounts',
  '/api/trpc/futureProofing.getSupportedBanks',
  '/api/trpc/futureProofing.getSubscriptionTiers',
  '/api/trpc/futureProofing.getDynamicPricing',
  '/api/trpc/futureProofing.getMiddlewareHealth',
  '/api/trpc/futureProofing.getRailHealth',
  '/api/trpc/futureProofing.getEventSourcingStats',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('remitflow-') && ![STATIC_CACHE, API_CACHE, FX_CACHE, REVENUE_SHARE_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  // NEVER cache auth-related endpoints — always pass through to network
  if (url.pathname.includes('/api/trpc/auth.') || url.pathname.includes('/api/oauth')) return;

  // v170: Universal FX + crypto rates — Stale-While-Revalidate (15 min TTL)
  if (UNIVERSAL_FX_PATTERNS.some((p) => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, FX_CACHE, 900));
    return;
  }

  // Revenue Share APIs — Stale-While-Revalidate (2 min TTL for near-real-time earnings)
  if (REVENUE_SHARE_API_PATTERNS.some((p) => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, REVENUE_SHARE_CACHE, 120));
    return;
  }

  // Future-proofing APIs — Stale-While-Revalidate (5 min TTL)
  if (FUTURE_PROOFING_API_PATTERNS.some((p) => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE, 300));
    return;
  }

  // v176: Agent POS, Transfers, Support, Crypto, Rails Health — Stale-While-Revalidate (3 min TTL)
  if (V176_API_PATTERNS.some((p) => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE, 180));
    return;
  }

  // v204: Form M, HNW banking, CBN compliance — Stale-While-Revalidate (5 min TTL)
  if (V204_API_PATTERNS.some((p) => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE, 300));
    return;
  }

  // v23: Tier 1/2/3 Business Finance, Trade Finance, Advanced Products — Stale-While-Revalidate (5 min TTL)
  if (V23_TIER_API_PATTERNS.some((p) => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE, 300));
    return;
  }

  // New missingTables routes — Stale-While-Revalidate (5 min TTL, read-heavy)
  if (
    url.pathname.includes('/api/trpc/supportTickets.') ||
    url.pathname.includes('/api/trpc/consent.') ||
    url.pathname.includes('/api/trpc/paymentMetrics.') ||
    url.pathname.includes('/api/trpc/stablecoin.') ||
    url.pathname.includes('/api/trpc/mojaloop.') ||
    url.pathname.includes('/api/trpc/onboardingProgress.')
  ) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE, 300));
    return;
  }
  // FX rates — Stale-While-Revalidate (15 min TTL)
  if (url.pathname.includes('/api/trpc/fx.') || url.pathname.includes('/api/trpc/rateAlerts.')) {
    event.respondWith(staleWhileRevalidate(request, FX_CACHE, 900));
    return;
  }
  // Community & Ecosystem APIs — Stale-While-Revalidate (5 min TTL)
  if (
    url.pathname.includes('/api/trpc/marketplace.') ||
    url.pathname.includes('/api/trpc/community.') ||
    url.pathname.includes('/api/trpc/diaspora.') ||
    url.pathname.includes('/api/trpc/talent.') ||
    url.pathname.includes('/api/trpc/family.') ||
    url.pathname.includes('/api/trpc/referral.')
  ) {
    event.respondWith(staleWhileRevalidate(request, COMMUNITY_CACHE, 300));
    return;
  }
  // API calls — Network-First with 5s timeout
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithTimeout(request, API_CACHE, 5000));
    return;
  }
  // Static assets — Cache-First
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)$/)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  // HTML navigation — Network-First with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/').then((r) => r || new Response('Offline', { status: 503 }))
      )
    );
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) { const c = await caches.open(cacheName); c.put(request, response.clone()); }
  return response;
}

async function networkFirstWithTimeout(request, cacheName, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) { const c = await caches.open(cacheName); c.put(request, response.clone()); }
    return response;
  } catch {
    clearTimeout(timeout);
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'offline', cached: false }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    const age = (Date.now() - new Date(cached.headers.get('date') || 0).getTime()) / 1000;
    if (age < maxAgeSeconds) {
      fetch(request).then((r) => { if (r.ok) cache.put(request, r); }).catch(() => {});
      return cached;
    }
  }
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return cached || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

// Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-transfers') event.waitUntil(syncPendingTransfers());
  if (event.tag === 'remitflow-transfer-sync') event.waitUntil(syncOfflineQueue()); // v170
  if (event.tag === 'sync-fx-alerts') event.waitUntil(fetch('/api/trpc/rateAlerts.checkNow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}));
  if (event.tag === 'sync-marketplace-order') event.waitUntil(syncPendingMarketplaceOrders());
  if (event.tag === 'sync-revenue-share') event.waitUntil(syncRevenueShareData());
});

// v170: Replay the unified offline queue (enqueueTransfer in offlineQueue.ts)
async function syncOfflineQueue() {
  try {
    const db = await openKeyvalIDB();
    const queue = (await idbKeyvalGet(db, 'remitflow:offline-queue')) ?? [];
    const pending = queue.filter((t) => t.status === 'pending');
    for (const transfer of pending) {
      try {
        const res = await fetch('/api/offline-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(transfer),
        });
        if (res.ok) {
          const updated = queue.filter((t) => t.id !== transfer.id);
          await idbKeyvalSet(db, 'remitflow:offline-queue', updated);
          const clients = await self.clients.matchAll();
          clients.forEach((c) => c.postMessage({ type: 'SYNC_SUCCESS', transferId: transfer.id }));
        }
      } catch (err) {
        const updated = queue.map((t) =>
          t.id === transfer.id
            ? { ...t, retryCount: (t.retryCount ?? 0) + 1, lastError: String(err), status: 'failed' }
            : t
        );
        await idbKeyvalSet(db, 'remitflow:offline-queue', updated);
      }
    }
  } catch { /* IDB unavailable */ }
}

async function syncPendingTransfers() {
  try {
    const db = await openIDB();
    const pending = await getAllFromStore(db, 'pendingTransfers');
    for (const t of pending) {
      try {
        const res = await fetch('/api/trpc/transfers.send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t.data) });
        if (res.ok) await deleteFromStore(db, 'pendingTransfers', t.id);
      } catch { /* retry next sync */ }
    }
  } catch { /* ignore */ }
}

async function syncPendingMarketplaceOrders() {
  try {
    const db = await openIDB();
    const pending = await getAllFromStore(db, 'pendingOrders');
    for (const o of pending) {
      try {
        const res = await fetch('/api/trpc/marketplace.createOrder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.data) });
        if (res.ok) await deleteFromStore(db, 'pendingOrders', o.id);
      } catch { /* retry next sync */ }
    }
  } catch { /* ignore */ }
}

async function syncRevenueShareData() {
  // Refresh revenue share cache in background
  try {
    const urls = [
      '/api/trpc/revenueShare.myAgreement?batch=1&input=%7B%220%22%3A%7B%7D%7D',
      '/api/trpc/revenueShare.myEarnings?batch=1&input=%7B%220%22%3A%7B%7D%7D',
    ];
    const cache = await caches.open(REVENUE_SHARE_CACHE);
    await Promise.all(urls.map(async (u) => {
      try {
        const r = await fetch(u);
        if (r.ok) cache.put(u, r);
      } catch { /* ignore */ }
    }));
  } catch { /* ignore */ }
}

// Periodic Background Sync
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-fx-rates') {
    event.waitUntil(fetch('/api/trpc/fx.rates').then((r) => { if (r.ok) caches.open(FX_CACHE).then((c) => c.put('/api/trpc/fx.rates', r)); }).catch(() => {}));
  }
  if (event.tag === 'refresh-community') {
    event.waitUntil(
      Promise.all([
        fetch('/api/trpc/marketplace.list?batch=1&input=%7B%220%22%3A%7B%7D%7D').then((r) => { if (r.ok) caches.open(COMMUNITY_CACHE).then((c) => c.put(r.url, r)); }).catch(() => {}),
        fetch('/api/trpc/community.list?batch=1&input=%7B%220%22%3A%7B%7D%7D').then((r) => { if (r.ok) caches.open(COMMUNITY_CACHE).then((c) => c.put(r.url, r)); }).catch(() => {}),
      ])
    );
  }
  // Refresh revenue share data every 30 minutes
  if (event.tag === 'refresh-revenue-share') {
    event.waitUntil(syncRevenueShareData());
  }
});

// Push Notifications — enhanced for Revenue Share payout alerts
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const isPayoutAlert = data.tag === 'payout-alert' || data.type === 'payout';

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'RemitFlow', {
      body: data.body ?? 'You have a new notification',
      icon: '/manus-storage/icon-192_d0405887.png',
      badge: '/manus-storage/icon-192_d0405887.png',
      tag: data.tag || 'remitflow-notification',
      data: { url: data.url || (isPayoutAlert ? '/partner/revenue-share?tab=payouts' : '/dashboard') },
      actions: isPayoutAlert
        ? [
            { action: 'view-payout', title: 'View Payout', icon: '/manus-storage/icon-192_d0405887.png' },
            { action: 'dismiss', title: 'Dismiss' },
          ]
        : (data.actions || []),
      requireInteraction: isPayoutAlert || data.requireInteraction || false,
      vibrate: isPayoutAlert ? [200, 100, 200, 100, 200] : [200, 100, 200],
      image: isPayoutAlert ? undefined : data.image,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  let url = event.notification.data?.url || '/dashboard';

  if (action === 'view-payout') url = '/partner/revenue-share?tab=payouts';
  if (action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if (c.url.includes(self.location.origin) && 'focus' in c) { c.navigate(url); return c.focus(); } }
      return clients.openWindow(url);
    })
  );
});

// v170: idb-keyval compatible store (keyval-store / keyval)
function openKeyvalIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keyval');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbKeyvalGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keyval', 'readonly');
    const r = tx.objectStore('keyval').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbKeyvalSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keyval', 'readwrite');
    const r = tx.objectStore('keyval').put(value, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// Legacy IDB helpers
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('remitflow-sw', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendingTransfers')) db.createObjectStore('pendingTransfers', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('pendingOrders')) db.createObjectStore('pendingOrders', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('revenueShareCache')) db.createObjectStore('revenueShareCache', { keyPath: 'key' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
function getAllFromStore(db, s) { return new Promise((res, rej) => { const r = db.transaction(s, 'readonly').objectStore(s).getAll(); r.onsuccess = (e) => res(e.target.result); r.onerror = (e) => rej(e.target.error); }); }
function deleteFromStore(db, s, id) { return new Promise((res, rej) => { const r = db.transaction(s, 'readwrite').objectStore(s).delete(id); r.onsuccess = () => res(); r.onerror = (e) => rej(e.target.error); }); }

console.log('[SW] RemitFlow Service Worker v20 loaded — v170 offline resilience, universal-fx cache, offline queue sync');
