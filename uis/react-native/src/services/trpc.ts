/**
 * tRPC client for RemitFlow React Native app
 * Connects to the RemitFlow API server
 */
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { secureGet } from './secureStorage';
import { fetchWithTimeout } from '../api/fetchWithTimeout';
// NOTE: AppRouter is a local placeholder type — see src/types/appRouter.d.ts
// for why the server/routers type import is decoupled from this package.
import type { AppRouter } from '../types/appRouter';

// With the placeholder router type, createTRPCReact's mapped proxy type
// collapses to tRPC's "property collides with a built-in method" marker
// union. Cast the proxy to a permissive shape: call sites are untyped
// (documented in appRouter.d.ts), but JSX usage (`trpc.Provider`) and hook
// calls compile cleanly.
const trpcProxy = createTRPCReact<AppRouter>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc: any = trpcProxy;

/**
 * Legacy raw-envelope REST helper used by RequestMoneyScreen and
 * TransactionReceiptScreen, which read `data.result.data` directly (the
 * tRPC JSON envelope, un-unwrapped — unlike api.ts which unwraps it).
 * Previously imported from this module but NEVER exported here — both
 * screens would have crashed on first use. wave14: implemented for real,
 * with the same 15s timeout and session cookie as the batch link.
 */
export const ApiService = {
  async get(path: string): Promise<any> {
    const sessionId = await secureGet('session_id');
    const res = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(sessionId ? { Cookie: `app_session_id=${sessionId}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json();
  },
  async post(path: string, data: unknown): Promise<any> {
    const sessionId = await secureGet('session_id');
    const res = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(sessionId ? { Cookie: `app_session_id=${sessionId}` } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json();
  },
};

const API_BASE_URL = process.env.REMITFLOW_API_URL ?? 'https://remitflow.app';

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${API_BASE_URL}/api/trpc`,
      transformer: superjson,
      // wave14 perf (M1): cap every tRPC batch at 15s instead of hanging
      // indefinitely on a stalled connection.
      fetch: (input, init) => fetchWithTimeout(input, init),
      async headers() {
        // CLI-005: session token from keystore-backed storage.
        // wave14 perf (H2): secureGet is memoized in module memory after the
        // first read, so this no longer crosses the native bridge per batch.
        const sessionId = await secureGet('session_id');
        return sessionId ? { Cookie: `app_session_id=${sessionId}` } : {};
      },
    }),
  ],
});
