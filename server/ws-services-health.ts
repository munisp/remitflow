/**
 * RemitFlow — WebSocket Services Health Broadcaster
 * ──────────────────────────────────────────────────
 * Upgrades HTTP connections at /ws/services-health and pushes circuit-breaker
 * and service health updates to all connected admin clients every 15 seconds.
 *
 * Message format (JSON):
 *   { type: "health_update", timestamp: ISO8601, services: ServiceHealth[], summary: { total, healthy, degraded, unavailable, status } }
 *   { type: "circuit_trip",  timestamp: ISO8601, service: string, previousStatus: string, currentStatus: string }
 *   { type: "ping",          timestamp: ISO8601 }
 */

import { IncomingMessage, Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { jwtVerify } from "jose";
import { checkAllServicesHealth, type ServiceHealth } from "./_core/serviceRegistry.js";
import { getDb } from "./db.js";
import { auditLogs } from "../drizzle/schema.js";
import { logger } from './_core/logger';

// ─── Auth helper ──────────────────────────────────────────────────────────────
async function verifyWsSession(req: IncomingMessage): Promise<boolean> {
  try {
    const cookieHeader = req.headers.cookie ?? "";
    const match = cookieHeader.match(/app_session_id=([^;]+)/);
    const token = match?.[1];
    if (!token) return false;
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
    await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let wss: WebSocketServer | null = null;
let broadcastInterval: ReturnType<typeof setInterval> | null = null;
let lastHealthSnapshot: Map<string, string> = new Map(); // name → status

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildSummary(services: ServiceHealth[]) {
  const healthy   = services.filter((s) => s.status === "healthy").length;
  const degraded  = services.filter((s) => s.status === "degraded").length;
  const unavailable = services.filter((s) => s.status === "unavailable").length;
  const total = services.length;
  const status =
    unavailable > total * 0.5 ? "critical" :
    degraded > 0              ? "degraded" : "healthy";
  return { total, healthy, degraded, unavailable, status };
}

function broadcast(payload: unknown) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

async function runHealthBroadcast() {
  try {
    const services = await checkAllServicesHealth();
    const timestamp = new Date().toISOString();

    // Detect circuit-breaker trips (status changes)
    const trips: Array<{ service: string; previousStatus: string; currentStatus: string }> = [];
    for (const svc of services) {
      const prev = lastHealthSnapshot.get(svc.name);
      if (prev && prev !== svc.status) {
        trips.push({ service: svc.name, previousStatus: prev, currentStatus: svc.status });
      }
      lastHealthSnapshot.set(svc.name, svc.status);
    }

    // Broadcast circuit-trip events first (so clients can highlight them)
    for (const trip of trips) {
      broadcast({ type: "circuit_trip", timestamp, ...trip });
      logger.info(`[WS-Health] Circuit trip: ${trip.service} ${trip.previousStatus} → ${trip.currentStatus}`);
      // Persist circuit-breaker trip to auditLogs
      try {
        const db = await getDb();
        if (db) {
          await db.insert(auditLogs).values({
            userId: 0,
            action: "circuit_trip",
            resource: "service_health",
            resourceId: trip.service,
            details: JSON.stringify({ previousStatus: trip.previousStatus, currentStatus: trip.currentStatus }),
            ipAddress: "system",
            userAgent: "ws-health-broadcaster",
            createdAt: new Date(),
          }).catch(() => {}); // non-blocking
        }
      } catch { /* non-blocking */ }
    }

    // Broadcast full health snapshot
    broadcast({
      type: "health_update",
      timestamp,
      services,
      summary: buildSummary(services),
    });
  } catch (err: any) {
    logger.warn("[WS-Health] Broadcast error:", err?.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attach the WebSocket server to an existing HTTP server.
 * Upgrades connections whose URL path is /ws/services-health.
 */
export function attachServicesHealthWS(httpServer: HttpServer) {
  wss = new WebSocketServer({ noServer: true });

  // Handle upgrade requests — only accept /ws/services-health
  httpServer.on("upgrade", async (req: IncomingMessage, socket, head) => {
    if (req.url === "/ws/services-health") {
      // Auth guard: only authenticated users may connect
      const authorized = await verifyWsSession(req);
      if (!authorized) {
        (socket as any).write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        (socket as any).destroy();
        logger.warn("[WS-Health] Rejected unauthenticated upgrade attempt");
        return;
      }
      wss!.handleUpgrade(req, socket as any, head, (ws) => {
        wss!.emit("connection", ws, req);
      });
    } else {
      // Let other upgrade handlers (e.g. Vite HMR) handle their paths
      // by NOT destroying the socket here.
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    logger.info("[WS-Health] Client connected");

    // Send immediate snapshot on connect so the UI doesn't wait 15 s
    runHealthBroadcast().catch(() => {});

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      logger.info("[WS-Health] Client disconnected");
    });

    ws.on("error", (err) => {
      logger.warn("[WS-Health] Client error:", err.message);
    });
  });

  // Start the 15-second broadcast interval
  broadcastInterval = setInterval(runHealthBroadcast, 15_000);
  logger.info("[WS-Health] WebSocket server attached at /ws/services-health (15 s interval)");
}

/** Stop the broadcaster (called during graceful shutdown). */
export function stopServicesHealthWS() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
}
