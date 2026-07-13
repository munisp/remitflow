/**
 * fxRateSse.ts — v170
 *
 * Server-Sent Events endpoint for real-time FX rate streaming.
 * Sends delta updates (only changed rates) to minimise bandwidth
 * for African low-connectivity environments (2G/3G).
 *
 * Endpoint: GET /api/sse/fx-rates
 *
 * Event types:
 *   fx-snapshot  — full rate map on first connect (JSON object)
 *   fx-delta     — only changed rates since last tick (JSON object, may be empty)
 *   heartbeat    — empty keep-alive every 25s (prevents proxy timeouts)
 *
 * Delta compression rationale:
 *   Full snapshot: ~8 KB (97 assets × avg 80 bytes per entry)
 *   Typical delta: <500 bytes (3–8 assets change per tick)
 *   Bandwidth saving on 2G (50 kbps): ~94% per tick
 */

import { Request, Response } from "express";

// In-memory last-known rates for delta computation
// Populated from universalConversion router on each rate refresh
let lastRates: Record<string, number> = {};
const sseClients: Set<Response> = new Set();

/**
 * Push a rate update to all connected SSE clients.
 * Computes delta vs. last known rates and sends only changed values.
 * Called by the universal-fx polling loop in the server.
 */
export function pushRateUpdate(newRates: Record<string, number>): void {
  if (sseClients.size === 0) {
    lastRates = newRates;
    return;
  }

  // Compute delta
  const delta: Record<string, number> = {};
  for (const [asset, rate] of Object.entries(newRates)) {
    const prev = lastRates[asset];
    // Include if new asset or rate changed by >0.01%
    if (prev === undefined || Math.abs(rate - prev) / prev > 0.0001) {
      delta[asset] = rate;
    }
  }

  lastRates = newRates;

  if (Object.keys(delta).length === 0) return; // no meaningful change

  const payload = `event: fx-delta\ndata: ${JSON.stringify(delta)}\n\n`;
  for (const client of Array.from(sseClients)) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Set the initial rate map (called on server startup).
 */
export function setInitialRates(rates: Record<string, number>): void {
  lastRates = rates;
}

const MAX_SSE_CLIENTS = parseInt(process.env.MAX_SSE_CLIENTS || "1000", 10);

/**
 * Express handler for GET /api/sse/fx-rates
 */
export function fxRateSseHandler(req: Request, res: Response): void {
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    res.status(503).json({ error: "Too many SSE connections" });
    return;
  }
  // SSE headers — HTTP/1.1 compatible (no HTTP/2 push)
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering
  res.flushHeaders();

  // Send full snapshot on connect
  if (Object.keys(lastRates).length > 0) {
    res.write(`event: fx-snapshot\ndata: ${JSON.stringify(lastRates)}\n\n`);
  }

  sseClients.add(res);

  // Heartbeat every 25s to prevent proxy/CGNAT timeouts
  // (Many African mobile carriers kill idle TCP connections at 30s)
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

/**
 * Get current SSE client count (for monitoring).
 */
export function getSseClientCount(): number {
  return sseClients.size;
}
