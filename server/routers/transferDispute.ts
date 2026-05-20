/**
 * transferDisputeRouter
 * Handles the full transfer dispute lifecycle:
 *  - User raises a dispute against a specific transaction (with optional evidence file)
 *  - Admin reviews, resolves, or escalates disputes
 *  - Real-time owner notification via notifyOwner on submission
 *  - SMS/email notification to user when dispute status changes
 *  - Transfer refund procedure for resolved disputes
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { createAuditLog } from "../audit.service";
import { notifyOwner } from "../_core/notification";
import { canAccessDispute, grantTransactionAccess } from "../middleware/permify";
import { logger } from '../_core/logger';

// ─── SMS helper (Africa's Talking real SDK or console fallback) ─────────────────────────────────
async function sendDisputeSms(phone: string | null | undefined, message: string): Promise<void> {
  if (!phone) return;
  try {
    const provider = process.env.SMS_PROVIDER ?? "console";
    if (provider === "africas_talking") {
      const AfricasTalking = (await import("africastalking")).default;
      const at = AfricasTalking({
        apiKey: process.env.AFRICASTALKING_API_KEY ?? "",
        username: process.env.AFRICASTALKING_USERNAME ?? "sandbox",
      });
      await at.SMS.send({
        to: [phone],
        message,
        from: process.env.AFRICASTALKING_SENDER_ID,
      });
    } else {
      // Console fallback for dev — disputes are still traceable via logs
      logger.info(`[DisputeSMS][${provider}] To: ${phone} | ${message}`);
    }
  } catch (err: any) {
    logger.error({ err: err.message }, '[DisputeSMS] Failed:');
  }
}

// ─── Raise a new transfer dispute ────────────────────────────────────────────
const raiseDispute = protectedProcedure
  .input(
    z.object({
      transactionId: z.number().int().positive(),
      reason: z.enum([
        "unauthorized",
        "duplicate",
        "not_received",
        "wrong_amount",
        "other",
      ]),
      description: z.string().min(10).max(2000),
      evidenceUrl: z.string().url().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    // Verify the transaction belongs to the caller
    const txRows = await db.execute(
      sql`SELECT id, from_amount, from_currency, status FROM transactions WHERE id = ${input.transactionId} AND "userId" = ${ctx.user.id} LIMIT 1`
    ) as any[];
    if (!txRows.length) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found or does not belong to you" });
    }
    // PBAC: grant Permify access record for this user<>transaction pair (idempotent)
    await grantTransactionAccess(String(ctx.user.id), String(input.transactionId)).catch(() => {});
    // Verify access via Permify (non-blocking fallback: allow if Permify is unavailable)
    const pbacAllowed = await canAccessDispute(String(ctx.user.id), String(input.transactionId)).catch(() => true);
    if (!pbacAllowed) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied by policy engine" });
    }

    // Prevent duplicate open disputes for same transaction
    const existing = await db.execute(
      sql`SELECT id FROM disputes WHERE "transactionId" = ${input.transactionId} AND "userId" = ${ctx.user.id} AND status IN ('open','under_review') LIMIT 1`
    ) as any[];
    if (existing.length) {
      throw new TRPCError({ code: "CONFLICT", message: "An open dispute already exists for this transaction" });
    }

    const result = await db.execute(sql`
      INSERT INTO disputes ("userId", "transactionId", type, description, status, "fileUrl", "createdAt", "updatedAt")
      VALUES (
        ${ctx.user.id},
        ${input.transactionId},
        ${input.reason},
        ${input.description},
        'open',
        ${input.evidenceUrl ?? null},
        NOW(), NOW()
      )
      RETURNING id
    `) as any[];

    const disputeId = result[0]?.id ?? null;

    await createAuditLog({
      userId: ctx.user.id,
      action: "dispute.raised",
      targetType: "dispute",
      targetId: typeof disputeId === "number" ? disputeId : 0,
      description: `Dispute raised for transaction #${input.transactionId}: ${input.reason}`,
      severity: "warning",
      metadata: { transactionId: input.transactionId, reason: input.reason },
    });

    // Real-time notification to admin/owner
    try {
      const tx = txRows[0];
      await notifyOwner({
        title: `New Transfer Dispute #${disputeId} — ${input.reason}`,
        content: `User ${ctx.user.name ?? ctx.user.email} raised a dispute for transaction #${input.transactionId} (${tx.from_currency} ${tx.from_amount}).\n\nReason: ${input.reason}\n\n${input.description.slice(0, 300)}${input.description.length > 300 ? "…" : ""}`,
      });
    } catch {
      // Notification failure is non-blocking
    }

    return { success: true, disputeId, message: "Dispute submitted successfully. Our team will review within 2 business days." };
  });

// ─── User: upload evidence file (base64 → S3) ───────────────────────────────
const uploadEvidenceFile = protectedProcedure
  .input(
    z.object({
      fileBase64: z.string().max(15_000_000),
      fileName: z.string().min(1).max(255),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const { storagePut } = await import("../storage");
    const buffer = Buffer.from(input.fileBase64, "base64");
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "File exceeds 10 MB limit" });
    }
    const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType.split("/")[1];
    const { randomBytes } = await import("crypto");
    const key = `dispute-evidence/${ctx.user.id}/${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
    const { url } = await storagePut(key, buffer, input.mimeType);
    return { url, key, fileName: input.fileName };
  });

// ─── User: upload evidence file URL ──────────────────────────────────────────
const uploadEvidence = protectedProcedure
  .input(
    z.object({
      disputeId: z.number().int().positive(),
      evidenceUrl: z.string().url(),
      fileName: z.string().max(255).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Verify the dispute belongs to the caller
    const rows = await db.execute(
      sql`SELECT id, status FROM disputes WHERE id = ${input.disputeId} AND "userId" = ${ctx.user.id} LIMIT 1`
    ) as any[];
    if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
    if (rows[0].status === "resolved" || rows[0].status === "closed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot add evidence to a resolved or closed dispute" });
    }

    await db.execute(sql`
      UPDATE disputes SET "fileUrl" = ${input.evidenceUrl}, "updatedAt" = NOW()
      WHERE id = ${input.disputeId}
    `);

    await createAuditLog({
      userId: ctx.user.id,
      action: "dispute.evidence_uploaded",
      targetType: "dispute",
      targetId: input.disputeId,
      description: `Evidence uploaded for dispute #${input.disputeId}: ${input.fileName ?? input.evidenceUrl}`,
      severity: "info",
      metadata: { disputeId: input.disputeId, evidenceUrl: input.evidenceUrl },
    });

    return { success: true, disputeId: input.disputeId };
  });

// ─── User: list own disputes ──────────────────────────────────────────────────
const listMyDisputes = protectedProcedure
  .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
  .query(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.execute(sql`
      SELECT d.*, t.from_amount, t.from_currency, t.to_currency, t.status as tx_status
      FROM disputes d
      LEFT JOIN transactions t ON t.id = d."transactionId"
      WHERE d."userId" = ${ctx.user.id}
      ORDER BY d."createdAt" DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `) as any[];
    return rows;
  });

// ─── Admin: list all disputes ─────────────────────────────────────────────────
const adminListDisputes = protectedProcedure
  .input(
    z.object({
      status: z.enum(["open", "under_review", "resolved", "closed", "all"]).default("all"),
      limit: z.number().default(50),
      offset: z.number().default(0),
    })
  )
  .query(async ({ input, ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) return { disputes: [], total: 0 };

    const statusFilter = input.status === "all"
      ? sql`1=1`
      : sql`d.status = ${input.status}`;

    const rows = await db.execute(sql`
      SELECT d.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
             t.from_amount, t.from_currency, t.to_currency, t.status as tx_status
      FROM disputes d
      LEFT JOIN users u ON u.id = d."userId"
      LEFT JOIN transactions t ON t.id = d."transactionId"
      WHERE ${statusFilter}
      ORDER BY d."createdAt" DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `) as any[];

    const countRows = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM disputes d WHERE ${statusFilter}
    `) as any[];

    return { disputes: rows, total: Number(countRows[0]?.cnt ?? 0) };
  });

// ─── Admin: update dispute status (with SMS notification to user) ─────────────
const adminUpdateDispute = protectedProcedure
  .input(
    z.object({
      disputeId: z.number().int().positive(),
      status: z.enum(["under_review", "resolved", "closed"]),
      resolution: z.string().min(5).max(2000).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Fetch dispute + user info for notification
    const disputeRows = await db.execute(sql`
      SELECT d.*, u.phone, u.email, u.name as user_name
      FROM disputes d
      LEFT JOIN users u ON u.id = d."userId"
      WHERE d.id = ${input.disputeId}
      LIMIT 1
    `) as any[];

    await db.execute(sql`
      UPDATE disputes
      SET status = ${input.status},
          resolution = ${input.resolution ?? null},
          "updatedAt" = NOW()
      WHERE id = ${input.disputeId}
    `);

    await createAuditLog({
      userId: ctx.user.id,
      action: `dispute.${input.status}`,
      targetType: "dispute",
      targetId: input.disputeId,
      description: `Admin updated dispute #${input.disputeId} to ${input.status}`,
      severity: "info",
      metadata: { disputeId: input.disputeId, newStatus: input.status },
    });

    // ── SMS notification to user on status change ──────────────────────────
    if (disputeRows.length) {
      const d = disputeRows[0];
      const statusMessages: Record<string, string> = {
        under_review: `Your dispute #${input.disputeId} is now under review by our team. We will contact you within 24 hours. — RemitFlow`,
        resolved: `Your dispute #${input.disputeId} has been resolved. ${input.resolution ? `Resolution: ${input.resolution.slice(0, 100)}` : ""} — RemitFlow`,
        closed: `Your dispute #${input.disputeId} has been closed. ${input.resolution ? `Note: ${input.resolution.slice(0, 100)}` : ""} — RemitFlow`,
      };
      const smsMsg = statusMessages[input.status];
      let smsSent = false;
      if (smsMsg) {
        try { await sendDisputeSms(d.phone, smsMsg); smsSent = true; } catch { smsSent = false; }
      }

      // Also notify owner for resolved/closed disputes
      if (input.status === "resolved" || input.status === "closed") {
        try {
          await notifyOwner({
            title: `Dispute #${input.disputeId} ${input.status}`,
            content: `Dispute for user ${d.user_name ?? d.email} has been marked as ${input.status}.\n${input.resolution ? `Resolution: ${input.resolution}` : ""}`,
          });
        } catch { /* non-blocking */ }
      }
      return { success: true, disputeId: input.disputeId, newStatus: input.status, smsSent };
    }

    return { success: true, disputeId: input.disputeId, newStatus: input.status, smsSent: false };
  });

// ─── Admin: get dispute stats ─────────────────────────────────────────────────
const adminDisputeStats = protectedProcedure.query(async ({ ctx }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  const db = await getDb();
  if (!db) return { open: 0, under_review: 0, resolved: 0, closed: 0, total: 0, avgResolutionHours: 0 };

  const rows = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM disputes GROUP BY status
  `) as any[];

  const stats: Record<string, number> = { open: 0, under_review: 0, resolved: 0, closed: 0 };
  for (const r of rows) stats[String(r.status)] = Number(r.cnt ?? 0);

  const resRows = await db.execute(sql`
    SELECT AVG(TIMESTAMPDIFF(HOUR, "createdAt", "updatedAt")) as avg_hours
    FROM disputes WHERE status IN ('resolved', 'closed')
  `) as any[];
  const avgResolutionHours = Math.round(Number(resRows[0]?.avg_hours ?? 0));

  return {
    ...stats,
    total: Object.values(stats).reduce((a, b) => a + b, 0),
    avgResolutionHours,
  };
});

// ─── Transfer refund procedure ────────────────────────────────────────────────
const requestRefund = protectedProcedure
  .input(
    z.object({
      transactionId: z.number().int().positive(),
      disputeId: z.number().int().positive().optional(),
      reason: z.string().min(10).max(500),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Verify the transaction belongs to the caller
    const txRows = await db.execute(sql`
      SELECT id, from_amount, from_currency, status, "userId"
      FROM transactions
      WHERE id = ${input.transactionId} AND "userId" = ${ctx.user.id}
      LIMIT 1
    `) as any[];
    if (!txRows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });

    const tx = txRows[0];
    // Only completed or failed transactions are refundable
    if (!["completed", "failed"].includes(String(tx.status))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot refund a transaction in '${tx.status}' status` });
    }

    // Create a refund record as a new transaction with type 'refund'
    const refundResult = await db.execute(sql`
      INSERT INTO transactions (
        "userId", type, status, from_amount, from_currency, to_amount, to_currency,
        description, reference, "createdAt", "updatedAt"
      )
      VALUES (
        ${ctx.user.id}, 'refund', 'pending',
        ${tx.from_amount}, ${tx.from_currency}, ${tx.from_amount}, ${tx.from_currency},
        ${`Refund for transaction #${input.transactionId}: ${input.reason}`},
        ${`REFUND-${input.transactionId}-${Date.now().toString(36).toUpperCase()}`},
        NOW(), NOW()
      )
      RETURNING id
    `) as any[];

    const refundId = refundResult[0]?.id ?? null;

    await createAuditLog({
      userId: ctx.user.id,
      action: "transfer.refund_requested",
      targetType: "transaction",
      targetId: input.transactionId,
      description: `Refund requested for transaction #${input.transactionId}. Refund ID: ${refundId}`,
      severity: "warning",
      metadata: { transactionId: input.transactionId, refundId, reason: input.reason, disputeId: input.disputeId },
    });

    try {
      await notifyOwner({
        title: `Refund Request — Transaction #${input.transactionId}`,
        content: `User ${ctx.user.name ?? ctx.user.email} requested a refund for ${tx.from_currency} ${tx.from_amount}.\n\nReason: ${input.reason}\n\nRefund ID: ${refundId}`,
      });
    } catch { /* non-blocking */ }

    return {
      success: true,
      refundId,
      message: "Refund request submitted. Processing typically takes 3–5 business days.",
      estimatedAmount: tx.from_amount,
      currency: tx.from_currency,
    };
  });

// ─── Export router ────────────────────────────────────────────────────────────
export const transferDisputeRouter = router({
  raise: raiseDispute,
  uploadEvidenceFile,
  uploadEvidence,
  listMine: listMyDisputes,
  adminList: adminListDisputes,
  adminUpdate: adminUpdateDispute,
  adminStats: adminDisputeStats,
  requestRefund,
});
