import { keycloak } from "../../middleware/middlewareIntegration";
import { getDb } from "../../db";
import { logger } from "../../_core/logger";

export async function syncKeycloakSession(userId: number, sessionId: string, token: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO keycloak_sessions (user_id, session_id, token, created_at, updated_at)
      VALUES (${userId}, ${sessionId}, ${token}, NOW(), NOW())
      ON CONFLICT (session_id) DO UPDATE SET token = EXCLUDED.token, updated_at = NOW()
    `);
    logger.info({ userId, sessionId }, "[Keycloak] Session synced");
  } catch (err) {
    logger.error({ err, userId }, "[Keycloak] Session sync failed");
  }
}

export async function revokeKeycloakSession(sessionId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      UPDATE keycloak_sessions SET revoked_at = NOW() WHERE session_id = ${sessionId}
    `);
    logger.info({ sessionId }, "[Keycloak] Session revoked");
  } catch (err) {
    logger.error({ err, sessionId }, "[Keycloak] Session revoke failed");
  }
}
