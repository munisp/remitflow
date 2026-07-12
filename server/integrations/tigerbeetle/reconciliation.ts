import { tigerBeetle } from "../../middleware/middlewareIntegration";
import { getDb } from "../../db";
import { logger } from "../../_core/logger";
import { TRPCError } from "@trpc/server";

export async function reconcileTigerBeetleAccounts(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Check if the user has a provisioned account
    const { sql } = await import("drizzle-orm");
    const res = await (db as any).execute(sql`
      SELECT tigerbeetle_wallet_account, tigerbeetle_escrow_account, tigerbeetle_fee_account
      FROM users WHERE id = ${userId}
    `);

    if (res.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    const row = res[0];
    const tbWalletId = row.tigerbeetle_wallet_account;
    
    if (!tbWalletId) {
      // User needs provisioning
      logger.info({ userId }, "[TigerBeetle] User needs account provisioning");
      // Trigger provisioning workflow
      const { provisionTigerBeetleAccounts } = await import("../../_core/tigerBeetleProvisioning");
      await provisionTigerBeetleAccounts(userId, ["NGN", "USD"]);
      return;
    }

    logger.info({ userId, tbWalletId }, "[TigerBeetle] Account reconciled");
  } catch (err) {
    logger.error({ err, userId }, "[TigerBeetle] Reconciliation failed");
  }
}

}
