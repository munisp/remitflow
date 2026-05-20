/**
 * useRealtimeRates.ts — v170
 *
 * Resilient FX rate subscription for African low-connectivity environments.
 *
 * Strategy (in priority order):
 * 1. SSE (Server-Sent Events) — primary, proxy-friendly HTTP/1.1 stream
 * 2. HTTP polling with exponential backoff — fallback when SSE fails
 * 3. IndexedDB cache — served when both network paths fail (offline)
 *
 * Delta updates: server sends only changed rates, not full snapshots.
 * The hook merges deltas into the full rate map locally.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getCachedRates, setCachedRates, applyRateDelta } from "@/lib/fxRateCache";

export type ConnectionStatus = "connecting" | "live" | "polling" | "cached" | "stale" | "offline";

export interface RateMap {
  rates: Record<string, number>;
  fetchedAt: number;
  source: ConnectionStatus;
  ageSeconds: number;
}

interface UseRealtimeRatesOptions {
  /** SSE endpoint for live delta rate stream */
  sseEndpoint?: string;
  /** HTTP polling endpoint for full rate snapshot */
  pollEndpoint?: string;
  /** Initial poll interval in ms (doubles on each failure, capped at maxPollMs) */
  minPollMs?: number;
  /** Maximum poll interval in ms */
  maxPollMs?: number;
  /** Whether to enable SSE at all (set false for very low bandwidth) */
  enableSse?: boolean;
}

const DEFAULT_SSE = "/api/sse/fx-rates";
const DEFAULT_POLL = "/api/trpc/universalConversion.getRates?batch=1&input=%7B%220%22%3A%7B%7D%7D";
const MIN_POLL_MS = 15_000; // 15 s
const MAX_POLL_MS = 120_000; // 2 min

export function useRealtimeRates(opts: UseRealtimeRatesOptions = {}): RateMap & { status: ConnectionStatus } {
  const {
    sseEndpoint = DEFAULT_SSE,
    pollEndpoint = DEFAULT_POLL,
    minPollMs = MIN_POLL_MS,
    maxPollMs = MAX_POLL_MS,
    enableSse = true,
  } = opts;

  const [rates, setRates] = useState<Record<string, number>>({});
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  const sseRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<number>(minPollMs);
  const mountedRef = useRef(true);

  // ── Load cached rates on mount ──────────────────────────────────────────────
  useEffect(() => {
    getCachedRates().then((cached) => {
      if (cached && mountedRef.current) {
        setRates(cached.rates);
        setFetchedAt(cached.fetchedAt);
        setStatus(cached.source === "stale" ? "stale" : "cached");
      }
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── HTTP polling with exponential backoff ───────────────────────────────────
  const schedulePoll = useCallback(
    (delayMs: number) => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        try {
          const res = await fetch(pollEndpoint, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          // tRPC batch response shape: [{ result: { data: { rates: {...} } } }]
          const data = Array.isArray(json) ? json[0]?.result?.data : json?.result?.data ?? json;
          const newRates: Record<string, number> = data?.rates ?? data ?? {};
          if (Object.keys(newRates).length > 0 && mountedRef.current) {
            setRates(newRates);
            setFetchedAt(Date.now());
            setStatus("polling");
            await setCachedRates(newRates);
            // Reset backoff on success
            pollIntervalRef.current = minPollMs;
          }
        } catch {
          if (mountedRef.current) {
            // Exponential backoff: double interval, cap at maxPollMs
            pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, maxPollMs);
            setStatus((prev) => (prev === "live" ? "polling" : prev === "polling" ? "cached" : "offline"));
          }
        }
        // Schedule next poll
        if (mountedRef.current) schedulePoll(pollIntervalRef.current);
      }, delayMs);
    },
    [pollEndpoint, minPollMs, maxPollMs]
  );

  // ── SSE connection ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enableSse) {
      schedulePoll(0);
      return;
    }

    let sseFailures = 0;

    function connectSse() {
      if (!mountedRef.current) return;
      setStatus("connecting");

      const es = new EventSource(sseEndpoint);
      sseRef.current = es;

      es.addEventListener("open", () => {
        if (!mountedRef.current) return;
        setStatus("live");
        sseFailures = 0;
        pollIntervalRef.current = minPollMs;
        // Cancel any running poll when SSE reconnects
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      });

      // Full snapshot event
      es.addEventListener("fx-snapshot", async (e: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const snapshot: Record<string, number> = JSON.parse(e.data);
          setRates(snapshot);
          setFetchedAt(Date.now());
          setStatus("live");
          await setCachedRates(snapshot);
        } catch {
          // malformed — ignore
        }
      });

      // Delta update event (only changed rates)
      es.addEventListener("fx-delta", async (e: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const delta: Record<string, number> = JSON.parse(e.data);
          const merged = await applyRateDelta(delta);
          if (merged) {
            setRates({ ...merged.rates });
            setFetchedAt(Date.now());
            setStatus("live");
          }
        } catch {
          // malformed — ignore
        }
      });

      es.onerror = () => {
        es.close();
        sseRef.current = null;
        sseFailures++;
        if (!mountedRef.current) return;

        // After 3 SSE failures, fall back to HTTP polling
        if (sseFailures >= 3) {
          setStatus("polling");
          schedulePoll(0);
          // Retry SSE after 5 minutes
          setTimeout(() => {
            if (mountedRef.current) {
              sseFailures = 0;
              connectSse();
            }
          }, 5 * 60 * 1000);
        } else {
          // Exponential reconnect: 2s, 4s, 8s
          const delay = Math.min(2000 * Math.pow(2, sseFailures - 1), 30_000);
          setTimeout(() => {
            if (mountedRef.current) connectSse();
          }, delay);
        }
      };
    }

    connectSse();

    return () => {
      mountedRef.current = false;
      sseRef.current?.close();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [sseEndpoint, enableSse, schedulePoll, minPollMs]);

  const ageSeconds = fetchedAt ? Math.floor((Date.now() - fetchedAt) / 1000) : 0;

  return {
    rates,
    fetchedAt,
    source: status,
    status,
    ageSeconds,
  };
}
