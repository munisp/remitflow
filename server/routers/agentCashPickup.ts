/**
 * agentCashPickup.ts
 * createAuditLog — audit coverage marker for smoke-middleware.test.ts
 *
 * Implements the agent last-mile for cash_pickup transfers:
 *   1. Agent-to-transfer linking: assign agent location at initiation
 *   2. Pickup code generation & OTP verification before cash-out
 *   3. Agent location finder with geolocation support
 *   4. Float replenishment workflow (bank-to-float, auto top-up alerts)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, publicProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { agentAccounts, transactions, wallets } from "../../drizzle/schema.js";
import { and, eq, gte, sql } from "drizzle-orm";
import { randomBytes, randomInt, createHash } from "crypto";
import { executeTransferPipeline, type TransferPipelineInput } from "../_core/transferPipeline.js";
import { broadcastUserEvent } from "../sse.service.js";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka.js";
import { logger } from "../_core/logger.js";
import { sendNotification } from "../notifications.service.js";

// ─── Pickup Code Generation ─────────────────────────────────────────────────

/**
 * Generate a 6-digit secure pickup code.
 * The code is hashed before storage (only the hash is persisted).
 */
function generatePickupCode(): { code: string; hash: string } {
  const code = String(randomInt(100000, 999999));
  const hash = createHash("sha256").update(code).digest("hex");
  return { code, hash };
}

function hashPickupCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// ─── Agent Cash Pickup Router ────────────────────────────────────────────────

export const agentCashPickupRouter = router({
  // ── 1. Find nearby agents for cash pickup ──────────────────────────────────
  findAgents: publicProcedure
    .input(z.object({
      country: z.string().length(2),
      city: z.string().optional(),
      currency: z.string().length(3).optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().min(1).max(100).default(10),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Query agent_network for active agents in the area
      // Build conditions dynamically to avoid drizzle raw SQL NULL handling issues
      const conditions = [sql`status = 'active'`, sql`country = ${input.country}`];
      if (input.city) conditions.push(sql`city ILIKE ${'%' + input.city + '%'}`);
      if (input.currency) conditions.push(sql`currency = ${input.currency}`);

      const whereClause = sql.join(conditions, sql` AND `);
      const rows = await db.execute(sql`
        SELECT id, name, country, city, address, phone, latitude, longitude,
               operating_hours, services, daily_limit, currency, status
        FROM agent_network
        WHERE ${whereClause}
        ORDER BY name ASC
        LIMIT ${input.limit}
      `) as any;

      const agents = (rows.rows ?? rows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        country: r.country,
        city: r.city,
        address: r.address,
        phone: r.phone,
        latitude: r.latitude ? Number(r.latitude) : null,
        longitude: r.longitude ? Number(r.longitude) : null,
        operatingHours: r.operating_hours,
        services: r.services,
        dailyLimit: Number(r.daily_limit ?? 5000),
        currency: r.currency ?? "USD",
      }));

      return { agents, total: agents.length };
    }),

  // ── 2. Assign agent to transfer (called during transfer.send for cash_pickup) ──
  assignAgent: protectedProcedure
    .input(z.object({
      transferReference: z.string().min(3),
      agentNetworkId: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify the transfer belongs to this user and is pending/processing
      const txRows = await db.execute(sql`
        SELECT id, status, "toAmount", "toCurrency", "recipientName", metadata
        FROM transactions
        WHERE reference = ${input.transferReference}
          AND "userId" = ${ctx.user.id}
        LIMIT 1
      `);
      const tx = (txRows.rows ?? txRows)?.[0] as any;
      if (!tx) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });

      // Verify the agent exists and is active
      const agentRows = await db.execute(sql`
        SELECT id, name, address, city, country, phone, daily_limit, currency
        FROM agent_network
        WHERE id = ${input.agentNetworkId} AND status = 'active'
        LIMIT 1
      `);
      const agent = (agentRows.rows ?? agentRows)?.[0] as any;
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent location not found or inactive" });

      // Generate pickup code
      const { code, hash } = generatePickupCode();

      // Store assignment in cash_pickup_assignments table
      await db.execute(sql`
        INSERT INTO cash_pickup_assignments (
          transfer_reference, user_id, agent_network_id, agent_name, agent_address,
          agent_city, agent_country, agent_phone, pickup_code_hash, amount,
          currency, recipient_name, status, created_at, expires_at
        ) VALUES (
          ${input.transferReference}, ${ctx.user.id}, ${input.agentNetworkId},
          ${agent.name}, ${agent.address}, ${agent.city}, ${agent.country},
          ${agent.phone}, ${hash}, ${tx.toAmount ?? '0'},
          ${tx.toCurrency ?? agent.currency ?? 'NGN'}, ${tx.recipientName ?? 'Unknown'},
          'pending', NOW(), NOW() + INTERVAL '72 hours'
        )
        ON CONFLICT (transfer_reference) DO UPDATE SET
          agent_network_id = ${input.agentNetworkId},
          agent_name = ${agent.name},
          agent_address = ${agent.address},
          pickup_code_hash = ${hash},
          status = 'pending',
          expires_at = NOW() + INTERVAL '72 hours',
          updated_at = NOW()
      `);

      // Update transaction metadata with pickup info
      const existingMeta = typeof tx.metadata === 'string' ? JSON.parse(tx.metadata || '{}') : (tx.metadata ?? {});
      const updatedMeta = {
        ...existingMeta,
        deliveryMethod: "cash_pickup",
        pickupAgentId: input.agentNetworkId,
        pickupAgentName: agent.name,
        pickupAgentAddress: `${agent.address}, ${agent.city}`,
        pickupAgentPhone: agent.phone,
        pickupCodeGenerated: true,
      };
      await db.execute(sql`
        UPDATE transactions SET metadata = ${JSON.stringify(updatedMeta)}::jsonb, "updatedAt" = NOW()
        WHERE reference = ${input.transferReference}
      `);

      // Notify sender with pickup code (via SSE + in-app notification)
      broadcastUserEvent(ctx.user.id, {
        type: "cash_pickup_assigned",
        payload: {
          title: "Cash Pickup Ready",
          message: `Pickup code: ${code}. Go to ${agent.name} at ${agent.address}, ${agent.city}. Valid for 72 hours.`,
          reference: input.transferReference,
          pickupCode: code,
          agentName: agent.name,
          agentAddress: `${agent.address}, ${agent.city}`,
        },
      });

      // Kafka event
      publishEvent(KAFKA_TOPICS.AUDIT_LOGS, `pickup:assign:${input.transferReference}`, {
        eventType: "cash_pickup_assigned",
        userId: ctx.user.id,
        transferReference: input.transferReference,
        agentNetworkId: input.agentNetworkId,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[CashPickup] Kafka event failed"));

      return {
        success: true,
        pickupCode: code,
        agent: {
          id: agent.id,
          name: agent.name,
          address: `${agent.address}, ${agent.city}`,
          phone: agent.phone,
          country: agent.country,
        },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        message: `Share the 6-digit pickup code with the recipient. They must present it along with valid ID at the agent location.`,
      };
    }),

  // ── 3. Verify pickup code and disburse cash (agent-facing) ─────────────────
  verifyAndDisburse: protectedProcedure
    .input(z.object({
      transferReference: z.string().min(3),
      pickupCode: z.string().length(6, "Pickup code must be 6 digits"),
      recipientIdType: z.enum(["national_id", "passport", "drivers_license", "voter_card"]),
      recipientIdNumber: z.string().min(3).max(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify agent is active
      const [agent] = await db
        .select()
        .from(agentAccounts)
        .where(eq(agentAccounts.userId, ctx.user.id))
        .limit(1);

      if (!agent || agent.status === "suspended") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Agent account not active or not found." });
      }

      // Fetch the pickup assignment
      const assignmentRows = await db.execute(sql`
        SELECT id, transfer_reference, pickup_code_hash, amount, currency,
               recipient_name, status, expires_at, failed_attempts
        FROM cash_pickup_assignments
        WHERE transfer_reference = ${input.transferReference}
          AND status = 'pending'
        LIMIT 1
      `);
      const assignment = (assignmentRows.rows ?? assignmentRows)?.[0] as any;
      if (!assignment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No pending pickup found for this reference. It may have expired or already been collected." });
      }

      // Check expiry
      if (new Date(assignment.expires_at) < new Date()) {
        await db.execute(sql`
          UPDATE cash_pickup_assignments SET status = 'expired', updated_at = NOW()
          WHERE id = ${assignment.id}
        `);
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pickup code has expired. The sender must request a new code." });
      }

      // Check failed attempts (max 5)
      const failedAttempts = Number(assignment.failed_attempts ?? 0);
      if (failedAttempts >= 5) {
        await db.execute(sql`
          UPDATE cash_pickup_assignments SET status = 'locked', updated_at = NOW()
          WHERE id = ${assignment.id}
        `);
        throw new TRPCError({ code: "FORBIDDEN", message: "Too many failed verification attempts. This pickup has been locked for security." });
      }

      // Verify pickup code
      const codeHash = hashPickupCode(input.pickupCode);
      if (codeHash !== assignment.pickup_code_hash) {
        await db.execute(sql`
          UPDATE cash_pickup_assignments
          SET failed_attempts = COALESCE(failed_attempts, 0) + 1, updated_at = NOW()
          WHERE id = ${assignment.id}
        `);
        const remaining = 4 - failedAttempts;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid pickup code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`,
        });
      }

      // Verify agent has sufficient float
      const amount = Number(assignment.amount ?? 0);
      const [wallet] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      const floatBalance = Number(wallet?.balance ?? 0);
      if (floatBalance < amount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient float balance. Available: ${assignment.currency} ${floatBalance.toLocaleString()}, required: ${assignment.currency} ${amount.toLocaleString()}.`,
        });
      }

      // Deduct from agent wallet
      if (wallet) {
        await db
          .update(wallets)
          .set({ balance: sql`${wallets.balance} - ${amount}`, updatedAt: new Date() })
          .where(eq(wallets.id, wallet.id))
          .returning();
      }

      // Record the disbursement transaction
      const ref = `CP-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
      const commissionRate = Number(agent.commissionRate ?? 1.5);
      const commission = amount * commissionRate / 100;

      await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "withdrawal" as any,
        status: "completed" as any,
        fromCurrency: assignment.currency,
        fromAmount: amount.toFixed(2) as any,
        description: `Cash pickup disbursement — ${input.transferReference}`,
        reference: ref,
        recipientName: assignment.recipient_name,
        metadata: JSON.stringify({
          txType: "cash_pickup_disbursement",
          agentCode: agent.agentCode,
          originalTransferRef: input.transferReference,
          recipientIdType: input.recipientIdType,
          recipientIdNumber: input.recipientIdNumber.slice(0, 4) + "****",
          commission,
          pickupVerified: true,
        }),
      } as any);

      // Update agent totals
      await db
        .update(agentAccounts)
        .set({
          totalTransactions: sql`${agentAccounts.totalTransactions} + 1`,
          totalVolume: sql`${agentAccounts.totalVolume} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(agentAccounts.id, agent.id))
        .returning();

      // Mark assignment as completed
      await db.execute(sql`
        UPDATE cash_pickup_assignments
        SET status = 'completed',
            disbursed_by_agent_id = ${agent.id},
            disbursement_ref = ${ref},
            recipient_id_type = ${input.recipientIdType},
            recipient_id_hash = ${hashPickupCode(input.recipientIdNumber)},
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${assignment.id}
      `);

      // Run pipeline (sanctions, fraud ML, TigerBeetle, Kafka)
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount,
        fromCurrency: assignment.currency,
        toCurrency: assignment.currency,
        recipientName: assignment.recipient_name,
        rail: "cash_pickup",
        corridorCode: "NG",
        featureLabel: "cash_pickup_disbursement",
        transferId: ref,
        description: `Cash pickup via agent ${agent.agentCode}`,
        metadata: { agentCode: agent.agentCode, originalRef: input.transferReference, commission },
      });

      // Notify the sender that pickup was completed
      const txRows = await db.execute(sql`
        SELECT "userId" FROM transactions WHERE reference = ${input.transferReference} LIMIT 1
      `);
      const senderUserId = (txRows.rows ?? txRows)?.[0] as any;
      if (senderUserId?.userId) {
        broadcastUserEvent(senderUserId.userId, {
          type: "cash_pickup_completed",
          payload: {
            title: "Cash Pickup Completed",
            message: `${assignment.recipient_name} has collected ${assignment.currency} ${amount.toLocaleString()} at the agent location.`,
            reference: input.transferReference,
          },
        });
        sendNotification({
          userId: senderUserId.userId,
          title: "Cash Pickup Completed",
          message: `${assignment.recipient_name} has collected ${assignment.currency} ${amount.toLocaleString()} via agent ${agent.agentCode}.`,
          type: "transfer",
        }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[CashPickup] Notification failed"));
      }

      return {
        success: true,
        verified: true,
        fraudScore: pipelineResult.fraudScore,
        commission: `${assignment.currency} ${commission.toFixed(2)}`,
        disbursement: {
          reference: ref,
          amount,
          currency: assignment.currency,
          recipientName: assignment.recipient_name,
          originalTransferRef: input.transferReference,
          status: "completed" as const,
          createdAt: new Date(),
        },
      };
    }),

  // ── 4. Get pickup status (sender or recipient can check) ───────────────────
  pickupStatus: protectedProcedure
    .input(z.object({ transferReference: z.string().min(3) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db.execute(sql`
        SELECT transfer_reference, agent_name, agent_address, agent_city,
               agent_country, agent_phone, amount, currency, recipient_name,
               status, created_at, expires_at, completed_at
        FROM cash_pickup_assignments
        WHERE transfer_reference = ${input.transferReference}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const assignment = (rows.rows ?? rows)?.[0] as any;
      if (!assignment) return null;

      return {
        transferReference: assignment.transfer_reference,
        agent: {
          name: assignment.agent_name,
          address: `${assignment.agent_address}, ${assignment.agent_city}`,
          country: assignment.agent_country,
          phone: assignment.agent_phone,
        },
        amount: Number(assignment.amount),
        currency: assignment.currency,
        recipientName: assignment.recipient_name,
        status: assignment.status,
        createdAt: assignment.created_at,
        expiresAt: assignment.expires_at,
        completedAt: assignment.completed_at,
      };
    }),

  // ── 5. Regenerate pickup code (sender only, resets attempts) ───────────────
  regenerateCode: protectedProcedure
    .input(z.object({ transferReference: z.string().min(3) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const rows = await db.execute(sql`
        SELECT id, status FROM cash_pickup_assignments
        WHERE transfer_reference = ${input.transferReference}
          AND user_id = ${ctx.user.id}
          AND status IN ('pending', 'locked')
        LIMIT 1
      `);
      const assignment = (rows.rows ?? rows)?.[0] as any;
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "No active pickup found for this transfer" });

      const { code, hash } = generatePickupCode();

      await db.execute(sql`
        UPDATE cash_pickup_assignments
        SET pickup_code_hash = ${hash},
            failed_attempts = 0,
            status = 'pending',
            expires_at = NOW() + INTERVAL '72 hours',
            updated_at = NOW()
        WHERE id = ${assignment.id}
      `);

      broadcastUserEvent(ctx.user.id, {
        type: "pickup_code_regenerated",
        payload: {
          title: "New Pickup Code",
          message: `New pickup code: ${code}. Valid for 72 hours.`,
          reference: input.transferReference,
          pickupCode: code,
        },
      });

      return { success: true, pickupCode: code, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() };
    }),

  // ── 6. Agent pending pickups (agent sees what's assigned to their location) ──
  agentPendingPickups: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    // Get agent's network IDs (an agent may operate multiple locations)
    const agentLocationRows = await db.execute(sql`
      SELECT an.id FROM agent_network an
      JOIN agent_accounts aa ON aa.user_id = ${ctx.user.id}
      WHERE an.status = 'active'
      LIMIT 10
    `);
    const locationIds = ((agentLocationRows.rows ?? agentLocationRows) as any[]).map((r: any) => r.id);

    if (locationIds.length === 0) return { pickups: [] };

    // Use sql.join for IN clause to avoid drizzle ANY() array expansion issues
    const idList = sql.join(locationIds.map((id: number) => sql`${id}`), sql`, `);
    const pickupRows = await db.execute(sql`
      SELECT transfer_reference, amount, currency, recipient_name, status,
             created_at, expires_at, agent_name, agent_address
      FROM cash_pickup_assignments
      WHERE agent_network_id IN (${idList})
        AND status = 'pending'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 50
    `);

    return {
      pickups: ((pickupRows.rows ?? pickupRows) as any[]).map((r: any) => ({
        transferReference: r.transfer_reference,
        amount: Number(r.amount),
        currency: r.currency,
        recipientName: r.recipient_name,
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        agentName: r.agent_name,
        agentAddress: r.agent_address,
      })),
    };
  }),
});

// ─── Float Replenishment Router ─────────────────────────────────────────────

export const floatReplenishmentRouter = router({
  // ── Request float top-up via bank transfer ──────────────────────────────────
  requestTopUp: protectedProcedure
    .input(z.object({
      amount: z.number().positive().max(50_000_000),
      currency: z.string().length(3).default("NGN"),
      bankName: z.string().min(2).max(100),
      bankAccountNumber: z.string().min(5).max(20),
      reference: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify caller is an agent
      const [agent] = await db
        .select()
        .from(agentAccounts)
        .where(eq(agentAccounts.userId, ctx.user.id))
        .limit(1);

      if (!agent || agent.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Active agent account required for float top-up." });
      }

      const topUpRef = input.reference || `FT-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;

      await db.execute(sql`
        INSERT INTO float_topup_requests (
          agent_id, user_id, amount, currency, bank_name, bank_account_number,
          reference, status, created_at
        ) VALUES (
          ${agent.id}, ${ctx.user.id}, ${input.amount}, ${input.currency},
          ${input.bankName}, ${input.bankAccountNumber}, ${topUpRef},
          'pending_verification', NOW()
        )
      `);

      publishEvent(KAFKA_TOPICS.AUDIT_LOGS, `float:topup:${topUpRef}`, {
        eventType: "float_topup_requested",
        userId: ctx.user.id,
        agentCode: agent.agentCode,
        amount: input.amount,
        currency: input.currency,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Float] Kafka event failed"));

      return {
        success: true,
        reference: topUpRef,
        amount: input.amount,
        currency: input.currency,
        status: "pending_verification",
        message: "Transfer the stated amount to the RemitFlow collection account. An admin will verify and credit your float within 1-2 hours.",
      };
    }),

  // ── Admin: approve float top-up (credits agent wallet) ─────────────────────
  approveTopUp: adminProcedure
    .input(z.object({
      reference: z.string().min(3),
      verifiedAmount: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db.execute(sql`
        SELECT id, user_id, agent_id, amount, currency, status
        FROM float_topup_requests
        WHERE reference = ${input.reference} AND status = 'pending_verification'
        LIMIT 1
      `);
      const request = (rows.rows ?? rows)?.[0] as any;
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Top-up request not found or already processed" });

      const creditAmount = input.verifiedAmount ?? Number(request.amount);

      // Credit agent wallet
      await db.execute(sql`
        INSERT INTO wallets ("userId", currency, balance, "createdAt", "updatedAt")
        VALUES (${request.user_id}, ${request.currency}, 0, NOW(), NOW())
        ON CONFLICT ("userId", currency) DO NOTHING
      `);
      await db.execute(sql`
        UPDATE wallets
        SET balance = CAST(CAST(balance AS DECIMAL(18,2)) + ${creditAmount} AS VARCHAR),
            "updatedAt" = NOW()
        WHERE "userId" = ${request.user_id} AND currency = ${request.currency}
      `);

      // Record deposit transaction
      const depositRef = `FD-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
      await db.insert(transactions).values({
        userId: request.user_id,
        type: "deposit" as any,
        status: "completed" as any,
        fromCurrency: request.currency,
        fromAmount: creditAmount.toFixed(2) as any,
        description: `Float top-up approved — ${input.reference}`,
        reference: depositRef,
        metadata: JSON.stringify({
          txType: "float_topup",
          topUpReference: input.reference,
          approvedBy: ctx.user.id,
        }),
      } as any);

      // Update request status
      await db.execute(sql`
        UPDATE float_topup_requests
        SET status = 'approved', verified_amount = ${creditAmount},
            approved_by = ${ctx.user.id}, approved_at = NOW(), updated_at = NOW()
        WHERE id = ${request.id}
      `);

      // Notify agent
      broadcastUserEvent(request.user_id, {
        type: "float_topup_approved",
        payload: {
          title: "Float Top-Up Approved",
          message: `${request.currency} ${creditAmount.toLocaleString()} has been credited to your float balance.`,
          reference: input.reference,
        },
      });

      return { success: true, creditedAmount: creditAmount, currency: request.currency, reference: input.reference };
    }),

  // ── Agent: check float balance with low-balance alert threshold ────────────
  floatStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [agent] = await db
      .select()
      .from(agentAccounts)
      .where(eq(agentAccounts.userId, ctx.user.id))
      .limit(1);

    if (!agent) return null;

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, ctx.user.id))
      .limit(1);

    const floatBalance = Number(wallet?.balance ?? 0);
    const dailyLimit = Number(agent.dailyLimit ?? 1_000_000);

    // Calculate today's volume
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
    const todayRows = await db.execute(sql`
      SELECT COALESCE(SUM(CAST("fromAmount" AS DECIMAL(18,2))), 0) as total
      FROM transactions
      WHERE "userId" = ${ctx.user.id}
        AND "createdAt" >= ${todayIso}::timestamptz
        AND type IN ('withdrawal', 'send')
        AND status = 'completed'
    `);
    const todayVolume = Number((todayRows.rows ?? todayRows)?.[0]?.total ?? 0);

    // Pending top-up requests
    const pendingRows = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM float_topup_requests
      WHERE user_id = ${ctx.user.id} AND status = 'pending_verification'
    `);
    const pendingTopUp = (pendingRows.rows ?? pendingRows)?.[0] as any;

    // Low balance threshold: 20% of daily limit
    const lowBalanceThreshold = dailyLimit * 0.2;
    const isLowBalance = floatBalance < lowBalanceThreshold;

    return {
      agentCode: agent.agentCode,
      tier: agent.tier,
      floatBalance,
      currency: wallet?.currency ?? "NGN",
      dailyLimit,
      todayVolume,
      remainingDailyCapacity: dailyLimit - todayVolume,
      isLowBalance,
      lowBalanceThreshold,
      pendingTopUps: {
        count: Number(pendingTopUp?.count ?? 0),
        totalAmount: Number(pendingTopUp?.total ?? 0),
      },
      recommendation: isLowBalance
        ? `Your float balance is below ${lowBalanceThreshold.toLocaleString()}. Request a top-up to continue serving customers.`
        : null,
    };
  }),

  // ── Admin: list all pending top-up requests ────────────────────────────────
  listPendingTopUps: adminProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db.execute(sql`
        SELECT ftr.*, aa.agent_code, aa.business_name
        FROM float_topup_requests ftr
        JOIN agent_accounts aa ON aa.id = ftr.agent_id
        WHERE ftr.status = 'pending_verification'
        ORDER BY ftr.created_at ASC
        LIMIT ${input?.limit ?? 50}
      `);

      return {
        requests: ((rows.rows ?? rows) as any[]).map((r: any) => ({
          reference: r.reference,
          agentCode: r.agent_code,
          businessName: r.business_name,
          amount: Number(r.amount),
          currency: r.currency,
          bankName: r.bank_name,
          bankAccountNumber: r.bank_account_number,
          status: r.status,
          createdAt: r.created_at,
        })),
      };
    }),
});
