import { permify } from "../../middleware/middlewareIntegration";
import { getDb } from "../../db";
import { logger } from "../../_core/logger";

export async function auditPermifyPolicy(subjectId: string, entityType: string, entityId: string, permission: string, allowed: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO permify_audit_logs (subject_id, entity_type, entity_id, permission, allowed, created_at)
      VALUES (${subjectId}, ${entityType}, ${entityId}, ${permission}, ${allowed}, NOW())
    `);
    logger.info({ subjectId, permission, allowed }, "[Permify] Audit logged");
  } catch (err) {
    logger.error({ err, subjectId }, "[Permify] Audit log failed");
  }
}
