/**
 * Audit Service — logs admin actions to the auditLogs table.
 * Used by admin procedures to create a tamper-evident trail of privileged operations.
 */
import { getDb } from "./db";
import { auditLogs } from "../drizzle/schema";
import { logger } from './_core/logger';

export interface AdminActionPayload {
  actorId?: number;
  userId?: number;
  action: string;
  targetId?: number;
  targetType?: string;
  description?: string;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Persist an admin action to the auditLogs table.
 * Non-blocking — errors are swallowed so audit failures never break the primary action.
 */
export async function logAdminAction(payload: AdminActionPayload): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const actorId = payload.actorId ?? payload.userId ?? 0;
    await db.insert(auditLogs).values({
      userId: actorId,
      targetId: payload.targetId ?? null,
      targetType: payload.targetType ?? null,
      action: payload.action,
      description: payload.description ?? null,
      severity: payload.severity ?? "info",
      metadata: payload.metadata ?? null,
      ipAddress: payload.ipAddress ?? null,
      userAgent: payload.userAgent ?? null,
    });
  } catch (err) {
    // Audit failures must never interrupt the primary operation
    logger.error("[Audit] Failed to write audit log:", (err as Error).message);
  }
}

// Alias for compatibility with routers that import createAuditLog from this module
export const createAuditLog = logAdminAction;
