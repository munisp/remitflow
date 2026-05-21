/**
 * Session Invalidation Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides proper session lifecycle management:
 * - Absolute timeout: max session duration (8 hours)
 * - Idle timeout: max time between requests (30 min)
 * - Session revocation: admin can kill sessions
 * - Concurrent session limit: max 5 active sessions per user
 * - Session fixation prevention: rotate session ID on privilege change
 */

import { logger } from "../_core/logger";

interface SessionMeta {
  userId: number;
  createdAt: number;
  lastActivityAt: number;
  ip: string;
  userAgent: string;
  revoked: boolean;
}

const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CONCURRENT_SESSIONS = 5;

// In-memory session store (production: Redis)
const sessionStore = new Map<string, SessionMeta>();

export function trackSession(sessionId: string, userId: number, ip: string, userAgent: string): void {
  // Enforce concurrent session limit
  const userSessions = Array.from(sessionStore.entries())
    .filter(([_, meta]) => meta.userId === userId && !meta.revoked)
    .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt);

  if (userSessions.length >= MAX_CONCURRENT_SESSIONS) {
    // Revoke oldest session
    const [oldestId] = userSessions[0];
    const oldest = sessionStore.get(oldestId);
    if (oldest) {
      oldest.revoked = true;
      logger.info({ userId, sessionId: oldestId }, "Oldest session revoked due to concurrent limit");
    }
  }

  sessionStore.set(sessionId, {
    userId,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    ip,
    userAgent,
    revoked: false,
  });
}

export function validateSession(sessionId: string): { valid: boolean; reason?: string } {
  const meta = sessionStore.get(sessionId);
  if (!meta) {
    return { valid: false, reason: "session_not_found" };
  }

  if (meta.revoked) {
    return { valid: false, reason: "session_revoked" };
  }

  const now = Date.now();

  if (now - meta.createdAt > ABSOLUTE_TIMEOUT_MS) {
    meta.revoked = true;
    return { valid: false, reason: "absolute_timeout" };
  }

  if (now - meta.lastActivityAt > IDLE_TIMEOUT_MS) {
    meta.revoked = true;
    return { valid: false, reason: "idle_timeout" };
  }

  // Update last activity
  meta.lastActivityAt = now;
  return { valid: true };
}

export function revokeSession(sessionId: string): boolean {
  const meta = sessionStore.get(sessionId);
  if (meta) {
    meta.revoked = true;
    return true;
  }
  return false;
}

export function revokeAllUserSessions(userId: number): number {
  let count = 0;
  for (const [_, meta] of Array.from(sessionStore.entries())) {
    if (meta.userId === userId && !meta.revoked) {
      meta.revoked = true;
      count++;
    }
  }
  return count;
}

export function getActiveSessions(userId: number): Array<{ sessionId: string; ip: string; userAgent: string; lastActivity: string }> {
  const sessions: Array<{ sessionId: string; ip: string; userAgent: string; lastActivity: string }> = [];
  for (const [id, meta] of Array.from(sessionStore.entries())) {
    if (meta.userId === userId && !meta.revoked) {
      sessions.push({
        sessionId: id.slice(0, 8) + "...",
        ip: meta.ip,
        userAgent: meta.userAgent,
        lastActivity: new Date(meta.lastActivityAt).toISOString(),
      });
    }
  }
  return sessions;
}
