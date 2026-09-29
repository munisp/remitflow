import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './i18n';

// PERF (wave14): @tanstack/react-query QueryClientProvider removed — no
// component in this app uses trpc.* react hooks or useQuery/useMutation
// (verified by grep; all data access goes through the vanilla `trpcClient`
// or services/api.ts fetch wrappers). The package itself stays in
// package.json because @trpc/react-query (still imported by
// services/trpc.ts) has it as a peer dependency; only the unused provider
// and its client instance are gone, which also drops a per-boot
// QueryClient allocation from the critical path.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.log('SW registration failed:', error);
    });
  });
}

// SECURITY (CLI-004): purge the legacy 'api-cache' runtime cache created by
// older service-worker builds — it may still hold authenticated API
// responses (balances, transactions, PII) on existing installs.
if ('caches' in window) {
  caches.delete('api-cache').catch(() => {});
}
