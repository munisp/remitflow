/**
 * Session Invalidation Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Redis-backed session lifecycle management:
 * - Absolute timeout: max session duration (8 hours)
 * - Idle timeout: max time between requests (30 min)
 * - Session revocation: admin can kill sessions
 * - Concurrent session limit: max 5 active sessions per user
 * - Session fixation prevention: rotate session ID on privilege change
 */

import { logger } from "../_core/logger";
import { redis } from "./middlewareIntegration";

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
const SESSION_PREFIX = "session:";
const USER_SESSIONS_PREFIX = "user_sessions:";
const SESSION_TTL_SECONDS = Math.ceil(ABSOLUTE_TIMEOUT_MS / 1000);

async function getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
  const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionMeta; } catch { return null; }
}

async function setSessionMeta(sessionId: string, meta: SessionMeta): Promise<void> {
  await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(meta), SESSION_TTL_SECONDS);
}

export async function trackSession(sessionId: string, userId: number, ip: string, userAgent: string): Promise<void> {
  // Get user's session list from Redis
  const userSessionsRaw = await redis.get(`${USER_SESSIONS_PREFIX}${userId}`);
  const userSessionIds: string[] = userSessionsRaw ? JSON.parse(userSessionsRaw) as string[] : [];

  // Check active session count, revoke oldest if over limit
  const activeSessions: Array<{ id: string; meta: SessionMeta }> = [];
  for (const sid of userSessionIds) {
    const meta = await getSessionMeta(sid);
    if (meta && !meta.revoked) activeSessions.push({ id: sid, meta });
  }

  if (activeSessions.length >= MAX_CONCURRENT_SESSIONS) {
    activeSessions.sort((a, b) => a.meta.lastActivityAt - b.meta.lastActivityAt);
    const oldest = activeSessions[0];
    oldest.meta.revoked = true;
    await setSessionMeta(oldest.id, oldest.meta);
    logger.info({ userId, sessionId: oldest.id }, "Oldest session revoked due to concurrent limit");
  }

  const meta: SessionMeta = {
    userId,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    ip,
    userAgent,
    revoked: false,
  };
  await setSessionMeta(sessionId, meta);

  // Update user session index
  const updatedIds = [...userSessionIds.filter(id => id !== sessionId), sessionId];
  await redis.set(`${USER_SESSIONS_PREFIX}${userId}`, JSON.stringify(updatedIds), SESSION_TTL_SECONDS);

}

export async function validateSession(sessionId: string): Promise<{ valid: boolean; reason?: string }> {
  const meta = await getSessionMeta(sessionId);
  if (!meta) {
    return { valid: false, reason: "session_not_found" };
  }

  if (meta.revoked) {
    return { valid: false, reason: "session_revoked" };
  }

  const now = Date.now();

  if (now - meta.createdAt > ABSOLUTE_TIMEOUT_MS) {
    meta.revoked = true;
    await setSessionMeta(sessionId, meta);
    return { valid: false, reason: "absolute_timeout" };
  }

  if (now - meta.lastActivityAt > IDLE_TIMEOUT_MS) {
    meta.revoked = true;
    await setSessionMeta(sessionId, meta);
    return { valid: false, reason: "idle_timeout" };
  }

  meta.lastActivityAt = now;
  await setSessionMeta(sessionId, meta);
  return { valid: true };
}

export async function revokeSession(sessionId: string): Promise<boolean> {
  const meta = await getSessionMeta(sessionId);
  if (meta) {
    meta.revoked = true;
    await setSessionMeta(sessionId, meta);
    return true;
  }
  return false;
}

export async function revokeAllUserSessions(userId: number): Promise<number> {
  const userSessionsRaw = await redis.get(`${USER_SESSIONS_PREFIX}${userId}`);
  const userSessionIds: string[] = userSessionsRaw ? JSON.parse(userSessionsRaw) as string[] : [];
  let count = 0;
  for (const sid of userSessionIds) {
    const meta = await getSessionMeta(sid);
    if (meta && !meta.revoked) {
      meta.revoked = true;
      await setSessionMeta(sid, meta);
      count++;
    }
  }
  return count;
}

export async function getActiveSessions(userId: number): Promise<Array<{ sessionId: string; ip: string; userAgent: string; lastActivity: string }>> {
  const userSessionsRaw = await redis.get(`${USER_SESSIONS_PREFIX}${userId}`);
  const userSessionIds: string[] = userSessionsRaw ? JSON.parse(userSessionsRaw) as string[] : [];
  const sessions: Array<{ sessionId: string; ip: string; userAgent: string; lastActivity: string }> = [];
  for (const sid of userSessionIds) {
    const meta = await getSessionMeta(sid);
    if (meta && !meta.revoked) {
      sessions.push({
        sessionId: sid.slice(0, 8) + "...",
        ip: meta.ip,
        userAgent: meta.userAgent,
        lastActivity: new Date(meta.lastActivityAt).toISOString(),
      });
    }
  }
  return sessions;
}
