/**
 * server/db-shim.ts
 *
 * Provides a synchronous `db` export compatible with routers that use
 * `import { db } from "../db"` pattern.
 *
 * The actual connection is lazy — it initialises on first use via a Proxy
 * that calls getDb() under the hood.
 */
import { getDb } from "./db";

// Lazy proxy: every property access triggers getDb() and delegates to the
// resolved drizzle instance. This avoids top-level await in ESM.
export const db: any = new Proxy({} as any, {
  get(_target, prop) {
    // Return a function that resolves the db and calls the method
    return (...args: any[]) =>
      getDb().then((resolvedDb: any) => {
        if (!resolvedDb) throw new Error("[db-shim] Database not available");
        const method = resolvedDb[prop];
        if (typeof method === "function") return method.apply(resolvedDb, args);
        return method;
      });
  },
});
