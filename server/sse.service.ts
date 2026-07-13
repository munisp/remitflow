/**
 * SSE Service — Server-Sent Events for real-time admin notifications.
 * Maintains a registry of connected admin SSE clients and broadcasts events.
 */
import type { Response } from "express";

export interface SseClient {
  userId: number;
  res: Response;
}

export interface AdminSseEvent {
  type: "new_kyc" | "new_compliance_case" | "case_updated" | "kyc_updated" | "case_escalated" | "fraud_alert" | "fraud_alert_reviewed" | "kyc_provider_result" | "fx_alert_triggered" | "ping";
  payload: Record<string, unknown>;
  timestamp: string;
}

// In-memory registry: userId → array of SSE response objects (multiple tabs)
const clients = new Map<number, Response[]>();

/**
 * Register a new SSE client connection for an admin user.
 * Sends initial ping and sets up cleanup on disconnect.
 */
export function registerSseClient(userId: number, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering
  res.flushHeaders();

  // Add to registry
  const existing = clients.get(userId) ?? [];
  existing.push(res);
  clients.set(userId, existing);

  // Send initial ping to confirm connection
  sendToClient(res, { type: "ping", payload: { connected: true }, timestamp: new Date().toISOString() });

  // Keep-alive heartbeat every 25 seconds
  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    sendToClient(res, { type: "ping", payload: {}, timestamp: new Date().toISOString() });
  }, 25_000);

  // Cleanup on disconnect
  res.on("close", () => {
    clearInterval(heartbeat);
    const arr = clients.get(userId) ?? [];
    const filtered = arr.filter((r) => r !== res);
    if (filtered.length === 0) {
      clients.delete(userId);
    } else {
      clients.set(userId, filtered);
    }
  });
}

/**
 * Send an SSE event to a single response stream.
 */
function sendToClient(res: Response, event: AdminSseEvent): void {
  try {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch {
    // Client disconnected mid-write — ignore
  }
}

/**
 * Broadcast an event to all connected admin SSE clients.
 * If userIds is provided, only those users receive the event.
 */
export function broadcastAdminEvent(event: Omit<AdminSseEvent, "timestamp">, userIds?: number[]): void {
  const fullEvent: AdminSseEvent = { ...event, timestamp: new Date().toISOString() };
  if (userIds) {
    for (const uid of userIds) {
      const arr = clients.get(uid) ?? [];
      for (const res of arr) sendToClient(res, fullEvent);
    }
  } else {
    Array.from(clients.values()).forEach((arr) => {
      arr.forEach((res) => sendToClient(res, fullEvent));
    });
  }
}

/**
 * Returns the number of currently connected SSE clients.
 */
export function getSseClientCount(): number {
  let total = 0;
  Array.from(clients.values()).forEach((arr) => { total += arr.length; });
  return total;
}

// ─── USER SSE REGISTRY ────────────────────────────────────────────────────────
// Separate registry for per-user real-time notifications (transactions, security events)
// Rate-limited: max 5 concurrent connections per user

export interface UserSseEvent {
  type:
    | "transfer_sent" | "transfer_received" | "transfer_failed" | "transfer_pending" | "transfer_update"
    | "kyc_approved" | "kyc_rejected" | "kyc_pending"
    | "login_new_device" | "password_changed" | "2fa_enabled" | "2fa_disabled"
    | "rate_alert_hit" | "low_balance" | "referral_bonus" | "card_transaction"
    | "cash_pickup_assigned" | "cash_pickup_ready" | "cash_pickup_completed" | "cash_pickup_expired"
    | "pickup_code_regenerated" | "float_topup_approved" | "float_topup_requested" | "float_balance_low"
    | "ping" | "notification";
  payload: Record<string, unknown>;
  timestamp: string;
}

const MAX_USER_CONNECTIONS = 5;
const userClients = new Map<number, Response[]>();

/**
 * Register a new SSE client connection for a regular user.
 * Enforces max 5 concurrent connections per user.
 */
export function registerUserSseClient(userId: number, res: Response): void {
  const existing = userClients.get(userId) ?? [];
  // Enforce connection limit
  if (existing.length >= MAX_USER_CONNECTIONS) {
    // Close the oldest connection to make room
    const oldest = existing.shift();
    if (oldest && !oldest.writableEnded) {
      oldest.write(`data: ${JSON.stringify({ type: "ping", payload: { replaced: true }, timestamp: new Date().toISOString() })}\n\n`);
      oldest.end();
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  existing.push(res);
  userClients.set(userId, existing);

  // Send initial ping
  const initEvent: UserSseEvent = { type: "ping", payload: { connected: true, userId }, timestamp: new Date().toISOString() };
  res.write(`data: ${JSON.stringify(initEvent)}\n\n`);

  // Keep-alive heartbeat every 25 seconds
  const heartbeat = setInterval(() => {
    if (res.writableEnded) { clearInterval(heartbeat); return; }
    res.write(`data: ${JSON.stringify({ type: "ping", payload: {}, timestamp: new Date().toISOString() })}\n\n`);
  }, 25_000);

  res.on("close", () => {
    clearInterval(heartbeat);
    const arr = userClients.get(userId) ?? [];
    const filtered = arr.filter((r) => r !== res);
    if (filtered.length === 0) userClients.delete(userId);
    else userClients.set(userId, filtered);
  });
}

/**
 * Send a real-time event to a specific user's SSE connections.
 */
export function broadcastUserEvent(userId: number, event: Omit<UserSseEvent, "timestamp">): void {
  const fullEvent: UserSseEvent = { ...event, timestamp: new Date().toISOString() };
  const arr = userClients.get(userId) ?? [];
  for (const res of arr) {
    try {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(fullEvent)}\n\n`);
    } catch { /* disconnected */ }
  }
}

/**
 * Returns the number of currently connected user SSE clients.
 */
export function getUserSseClientCount(): number {
  let total = 0;
  Array.from(userClients.values()).forEach((arr) => { total += arr.length; });
  return total;
}
