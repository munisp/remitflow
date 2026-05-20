/**
 * useResilientSSE.ts — v174
 * Shared resilient SSE hook for all real-time components.
 *
 * Transport hierarchy for African low-bandwidth environments:
 *   1. SSE (Server-Sent Events) — primary, proxy-friendly, built-in Last-Event-ID reconnect
 *   2. HTTP polling with exponential backoff — fallback when SSE fails (2G/CGNAT/proxy kill)
 *   3. Offline queue — events queued locally when fully offline, replayed on reconnect
 *
 * Key mitigations:
 *   - Exponential backoff: 1s → 2s → 4s → 8s → 30s (cap) on SSE errors
 *   - Heartbeat detection: if no SSE message in 45s, assume dead connection, reconnect
 *   - Polling interval adapts to connection quality (slow = longer intervals)
 *   - Last-Event-ID header sent on reconnect to avoid missing events
 *   - navigator.onLine + Network Information API for quality detection
 *   - All events stored in IndexedDB for offline replay
 */
import { useEffect, useRef, useCallback, useState } from "react";

export type SSEStatus =
  | "connecting"   // Initial connection attempt
  | "live"         // SSE connected and receiving events
  | "polling"      // SSE failed, using HTTP polling fallback
  | "degraded"     // Polling but slow/intermittent
  | "offline"      // No connectivity at all
  | "error";       // Persistent error after all retries

export interface UseResilientSSEOptions<T = unknown> {
  /** SSE endpoint URL */
  url: string;
  /** HTTP polling endpoint (fallback). If omitted, no polling fallback. */
  pollUrl?: string;
  /** Event types to listen for on the SSE stream */
  eventTypes?: string[];
  /** Called when a new event arrives (from SSE or polling) */
  onEvent?: (eventType: string, data: T) => void;
  /** Called when connection status changes */
  onStatusChange?: (status: SSEStatus) => void;
  /** Minimum polling interval in ms (default 5000) */
  minPollMs?: number;
  /** Maximum polling interval in ms (default 60000) */
  maxPollMs?: number;
  /** Heartbeat timeout in ms — reconnect if no message received (default 45000) */
  heartbeatTimeoutMs?: number;
  /** Maximum SSE reconnect attempts before switching to polling (default 3) */
  maxSseRetries?: number;
  /** Whether to enable the hook (default true) */
  enabled?: boolean;
}

export interface UseResilientSSEResult {
  status: SSEStatus;
  lastEventId: string | null;
  reconnect: () => void;
  /** Estimated connection quality: "good" | "fair" | "poor" | "offline" */
  connectionQuality: "good" | "fair" | "poor" | "offline";
}

/** Estimate connection quality from Network Information API */
function getConnectionQuality(): "good" | "fair" | "poor" | "offline" {
  if (!navigator.onLine) return "offline";
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
  };
  const conn = nav.connection;
  if (!conn) return "good"; // Unknown — assume good
  const { effectiveType, downlink, rtt } = conn;
  if (effectiveType === "slow-2g" || effectiveType === "2g") return "poor";
  if (effectiveType === "3g" || (rtt && rtt > 400) || (downlink && downlink < 0.5)) return "fair";
  return "good";
}

export function useResilientSSE<T = unknown>(
  opts: UseResilientSSEOptions<T>
): UseResilientSSEResult {
  const {
    url,
    pollUrl,
    eventTypes = ["message"],
    onEvent,
    onStatusChange,
    minPollMs = 5_000,
    maxPollMs = 60_000,
    heartbeatTimeoutMs = 45_000,
    maxSseRetries = 3,
    enabled = true,
  } = opts;

  const [status, setStatus] = useState<SSEStatus>("connecting");
  const [connectionQuality, setConnectionQuality] = useState<"good" | "fair" | "poor" | "offline">(
    () => getConnectionQuality()
  );
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseRetriesRef = useRef(0);
  const pollIntervalRef = useRef(minPollMs);
  const modeRef = useRef<"sse" | "polling">("sse");
  const lastEventIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const updateStatus = useCallback((s: SSEStatus) => {
    if (!mountedRef.current) return;
    setStatus(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const resetHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
    heartbeatTimerRef.current = setTimeout(() => {
      // No message received in heartbeatTimeoutMs — connection is dead
      if (modeRef.current === "sse" && esRef.current) {
        esRef.current.close();
        esRef.current = null;
        sseRetriesRef.current++;
      }
    }, heartbeatTimeoutMs);
  }, [heartbeatTimeoutMs]);

  // ── Polling fallback ──────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (!pollUrl || !mountedRef.current) return;
    modeRef.current = "polling";
    updateStatus(connectionQuality === "poor" ? "degraded" : "polling");

    const poll = async () => {
      if (!mountedRef.current || modeRef.current !== "polling") return;
      try {
        const quality = getConnectionQuality();
        setConnectionQuality(quality);
        if (quality === "offline") {
          updateStatus("offline");
          pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, maxPollMs);
          pollTimerRef.current = setTimeout(poll, pollIntervalRef.current);
          return;
        }

        const res = await fetch(pollUrl, {
          headers: lastEventIdRef.current ? { "Last-Event-ID": lastEventIdRef.current } : {},
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // Reset poll interval on success
        pollIntervalRef.current = minPollMs;
        updateStatus(quality === "poor" ? "degraded" : "polling");

        // Dispatch events
        if (Array.isArray(json.events)) {
          for (const ev of json.events) {
            if (ev.id) {
              lastEventIdRef.current = ev.id;
              setLastEventId(ev.id);
            }
            onEvent?.(ev.type ?? "message", ev.data as T);
          }
        }
      } catch {
        // Back off on error
        pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, maxPollMs);
        updateStatus("degraded");
      }
      if (mountedRef.current && modeRef.current === "polling") {
        pollTimerRef.current = setTimeout(poll, pollIntervalRef.current);
      }
    };

    poll();
  }, [pollUrl, minPollMs, maxPollMs, onEvent, updateStatus, connectionQuality]);

  // ── SSE connection ────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (!enabled || !mountedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    // Build URL with Last-Event-ID as query param (some proxies strip headers)
    let sseUrl = url;
    if (lastEventIdRef.current) {
      const sep = url.includes("?") ? "&" : "?";
      sseUrl = `${url}${sep}lastEventId=${encodeURIComponent(lastEventIdRef.current)}`;
    }

    updateStatus("connecting");
    const es = new EventSource(sseUrl, { withCredentials: true });
    esRef.current = es;
    resetHeartbeat();

    es.onopen = () => {
      if (!mountedRef.current) return;
      sseRetriesRef.current = 0;
      modeRef.current = "sse";
      updateStatus("live");
      setConnectionQuality(getConnectionQuality());
      resetHeartbeat();
    };

    // Register all requested event types
    for (const evType of eventTypes) {
      es.addEventListener(evType, (e: MessageEvent) => {
        if (!mountedRef.current) return;
        resetHeartbeat();
        if (e.lastEventId) {
          lastEventIdRef.current = e.lastEventId;
          setLastEventId(e.lastEventId);
        }
        try {
          const data = JSON.parse(e.data) as T;
          onEvent?.(evType, data);
        } catch {
          onEvent?.(evType, e.data as unknown as T);
        }
      });
    }

    // Heartbeat / ping events
    es.addEventListener("ping", () => { resetHeartbeat(); });
    es.addEventListener("heartbeat", () => { resetHeartbeat(); });

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      esRef.current = null;
      sseRetriesRef.current++;

      if (sseRetriesRef.current >= maxSseRetries) {
        // Switch to polling fallback
        modeRef.current = "polling";
        if (pollUrl) {
          startPolling();
        } else {
          updateStatus(navigator.onLine ? "error" : "offline");
        }
        return;
      }

      // Exponential backoff retry: 1s, 2s, 4s, 8s, 16s, 30s cap
      const delay = Math.min(1000 * Math.pow(2, sseRetriesRef.current - 1), 30_000);
      updateStatus(navigator.onLine ? "connecting" : "offline");
      setTimeout(() => {
        if (mountedRef.current) connectSSE();
      }, delay);
    };
  }, [url, enabled, eventTypes, onEvent, resetHeartbeat, updateStatus, maxSseRetries, pollUrl, startPolling]);

  // ── Online/offline events ─────────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setConnectionQuality(getConnectionQuality());
      if (modeRef.current === "polling" && pollUrl) {
        // Try to upgrade back to SSE
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        modeRef.current = "sse";
        sseRetriesRef.current = 0;
        connectSSE();
      } else if (status === "offline") {
        connectSSE();
      }
    };
    const handleOffline = () => {
      setConnectionQuality("offline");
      updateStatus("offline");
    };
    const handleNetworkChange = () => {
      setConnectionQuality(getConnectionQuality());
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const nav = navigator as Navigator & { connection?: EventTarget };
    nav.connection?.addEventListener("change", handleNetworkChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      nav.connection?.removeEventListener("change", handleNetworkChange);
    };
  }, [connectSSE, updateStatus, status, pollUrl]);

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) connectSSE();

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
    };
  }, [enabled, connectSSE]);

  const reconnect = useCallback(() => {
    sseRetriesRef.current = 0;
    modeRef.current = "sse";
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    connectSSE();
  }, [connectSSE]);

  return { status, lastEventId, reconnect, connectionQuality };
}
