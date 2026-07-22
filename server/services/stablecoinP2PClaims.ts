import { randomBytes } from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";

export type StablecoinP2PClaim = {
  id: string;
  senderId: string;
  recipientIdentifier: string;
  stablecoin: string;
  amount: number;
  claimCode: string;
  message: string | null;
  expiresAt: string;
  ledgerReference: string;
};

function rows(result: unknown): Record<string, unknown>[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function claimFromRow(row: Record<string, unknown>): StablecoinP2PClaim {
  return {
    id: String(row.id),
    senderId: String(row.sender_id),
    recipientIdentifier: String(row.recipient_identifier),
    stablecoin: String(row.stablecoin),
    amount: Number(row.amount),
    claimCode: String(row.claim_code),
    message: row.message == null ? null : String(row.message),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    ledgerReference: String(row.ledger_reference),
  };
}

export async function createStablecoinP2PClaim(input: {
  senderId: number | string;
  recipientIdentifier: string;
  stablecoin: string;
  amount: number;
  message?: string;
}): Promise<StablecoinP2PClaim> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const id = createId();
  const claimCode = randomBytes(16).toString("hex").toUpperCase();
  const ledgerReference = `P2P-${createId()}`;
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    INSERT INTO stablecoin_p2p_claims (
      id, sender_id, recipient_identifier, stablecoin, amount, claim_code, message, expires_at, ledger_reference
    ) VALUES (
      ${id}, ${String(input.senderId)}, ${input.recipientIdentifier}, ${input.stablecoin}, ${String(input.amount)},
      ${claimCode}, ${input.message ?? null}, ${expiresAt.toISOString()}, ${ledgerReference}
    ) RETURNING *
  `);
  const row = rows(result)[0];
  if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to persist the P2P claim" });
  return claimFromRow(row);
}

export async function reserveStablecoinP2PClaim(claimCode: string, recipientUserId: number | string): Promise<StablecoinP2PClaim> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const result = await db.execute(sql`
    UPDATE stablecoin_p2p_claims
    SET status = 'redeeming', claimed_by_user_id = ${String(recipientUserId)}
    WHERE claim_code = ${claimCode} AND status = 'pending' AND expires_at > NOW()
    RETURNING *
  `);
  const row = rows(result)[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "The claim is invalid, expired, or has already been redeemed." });
  return claimFromRow(row);
}

export async function completeStablecoinP2PClaim(claimId: string, recipientUserId: number | string): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const result = await db.execute(sql`
    UPDATE stablecoin_p2p_claims
    SET status = 'claimed', claimed_at = NOW()
    WHERE id = ${claimId} AND status = 'redeeming' AND claimed_by_user_id = ${String(recipientUserId)}
    RETURNING id
  `);
  if (!rows(result)[0]) throw new TRPCError({ code: "CONFLICT", message: "The P2P claim could not be finalized." });
}

export async function releaseStablecoinP2PClaim(claimId: string, recipientUserId: number | string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE stablecoin_p2p_claims
    SET status = 'pending', claimed_by_user_id = NULL
    WHERE id = ${claimId} AND status = 'redeeming' AND claimed_by_user_id = ${String(recipientUserId)}
  `);
}
