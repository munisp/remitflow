import { apisix } from "../../middleware/middlewareIntegration";
import { getDb } from "../../db";
import { logger } from "../../_core/logger";

export async function syncApisixRoute(routeId: string, path: string, upstreamUrl: string): Promise<void> {
  try {
    const config = {
      uri: path,
      upstream: {
        type: "roundrobin",
        nodes: {
          [upstreamUrl]: 1
        }
      },
      plugins: {
        "proxy-rewrite": {},
        "limit-req": {
          rate: 10,
          burst: 5,
          rejected_code: 429,
          key_type: "var",
          key: "remote_addr"
        }
      }
    };
    
    await apisix.createRoute(routeId, config);
    logger.info({ routeId, path }, "[APISIX] Route synced");
    
    // Log to audit table
    const db = await getDb();
    if (db) {
      const { sql } = await import("drizzle-orm");
      await (db as any).execute(sql`
        INSERT INTO apisix_route_logs (route_id, path, upstream_url, created_at)
        VALUES (${routeId}, ${path}, ${upstreamUrl}, NOW())
      `);
    }
  } catch (err) {
    logger.error({ err, routeId }, "[APISIX] Route sync failed");
  }
}
