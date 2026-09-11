/**
 * W10-C1 / SPEC-wave10 — Approval policy engine (AP core).
 *
 * Lifecycle per SPEC vocab:
 *   approvalRequests: pending → approved | rejected | expired
 *   approvalSteps:    pending → approved | rejected  (sequential)
 *
 * Guarantees:
 *   - Policy evaluation: scope + minAmount (+ optional currency) match
 *     selects the most specific active policy; NO matching policy or an
 *     UNRESOLVED approver set → BLOCK (throw PRECONDITION_FAILED, fail
 *     closed) — no approval request is ever created without a real,
 *     resolvable approver chain.
 *   - Steps are sequential: only the lowest-numbered pending step can be
 *     decided, and only by its designated approver.
 *   - Self-approval is blocked unless the policy explicitly allows it.
 *   - Permify authorization (checkPermission) gates every decision —
 *     Permify unavailable/denied → FORBIDDEN (fail closed).
 *   - Single-winner step updates: guarded UPDATE ... WHERE status='pending'
 *     with a row-count check; a concurrent loser gets CONFLICT.
 *   - The FINAL decision flips the owning entity (vendor_bill) in the SAME
 *     db.transaction — request and entity can never diverge.
 *   - Every transition emits a Kafka event on `remitflow.vendor-bills`.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db.js";
import {
  approvalPolicies,
  approvalRequests,
  approvalSteps,
  users,
  type ApprovalPolicy,
  type ApprovalRequest,
} from "../../drizzle/schema.js";
import { checkPermission } from "../_core/permifyClient.js";
import { publishEvent } from "../middleware/kafka.js";
import { logger } from "../_core/logger.js";

export const APPROVAL_EVENTS_TOPIC = "remitflow.vendor-bills";

export type ApprovalEntityType = "vendor_bill";

export interface CreateRequestInput {
  tenantId: number;
  entityType: ApprovalEntityType;
  entityId: string;
  amount: number;
  currency: string;
  /** The user submitting the entity for approval (self-approval reference). */
  createdBy: number;
}

export interface CreatedApprovalRequest {
  requestId: number;
  policyId: number;
  stepsRequired: number;
  approverUserIds: number[];
}

function emitApprovalEvent(eventType: string, key: string, payload: Record<string, unknown>): void {
  publishEvent(APPROVAL_EVENTS_TOPIC, key, {
    eventType,
    ...payload,
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err), eventType }, "[ApprovalEngine] Kafka event failed"),
  );
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

/**
 * Resolve the concrete approver chain for a policy. Every approverUserId
 * must resolve to an existing user; approverRoles resolve to tenant users
 * holding that role. Any unresolved entry or an empty chain → null (the
 * caller BLOCKs, fail closed).
 */
async function resolveApproverChain(policy: ApprovalPolicy): Promise<number[] | null> {
  const db = await requireDb();
  const ids: number[] = [];
  const rawIds = Array.isArray(policy.approverUserIds) ? (policy.approverUserIds as unknown[]) : [];
  for (const raw of rawIds) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) {
      logger.warn({ policyId: policy.id, approverUserId: id }, "[ApprovalEngine] BLOCK: policy references unresolved approver");
      return null;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  const rawRoles = Array.isArray(policy.approverRoles) ? (policy.approverRoles as unknown[]) : [];
  for (const rawRole of rawRoles) {
    const role = String(rawRole);
    if (role !== "admin" && role !== "user" && role !== "partner") return null;
    // Resolve role → concrete tenant members (deterministic id order).
    const rows = (await db.execute(sql`
      SELECT u.id AS id FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = ${policy.tenantId}
      WHERE u.role = ${role}
      ORDER BY u.id ASC
    `)) as unknown as Array<{ id: number }>;
    for (const r of rows) {
      if (!ids.includes(r.id)) ids.push(r.id);
    }
  }
  return ids.length > 0 ? ids : null;
}

/**
 * Evaluate policies for an entity and create an approval request with
 * sequential steps. Runs inside the caller's db.transaction when `tx` is
 * provided so the entity status flip and request creation are atomic.
 *
 * Throws PRECONDITION_FAILED ("approval blocked") when:
 *   - no active policy matches scope+minAmount(+currency), or
 *   - the matched policy's approver set cannot be fully resolved, or
 *   - requiredApprovals exceeds the resolved approver chain.
 */
export async function evaluateAndCreateRequest(
  input: CreateRequestInput,
  tx?: { execute: (q: unknown) => Promise<unknown> },
): Promise<CreatedApprovalRequest> {
  const db = await requireDb();
  const runner = (tx ?? db) as { execute: (q: unknown) => Promise<unknown> };

  // Most-specific matching policy: highest minAmount that still <= amount.
  const policyRows = (await runner.execute(sql`
    SELECT * FROM approval_policies
    WHERE tenant_id = ${input.tenantId}
      AND scope = ${input.entityType}
      AND active = TRUE
      AND CAST(min_amount AS NUMERIC) <= ${input.amount}
      AND (currency IS NULL OR currency = ${input.currency})
    ORDER BY CAST(min_amount AS NUMERIC) DESC
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  const policyRow = policyRows[0];
  if (!policyRow) {
    logger.warn(
      { tenantId: input.tenantId, entityType: input.entityType, entityId: input.entityId, amount: input.amount, currency: input.currency },
      "[ApprovalEngine] BLOCK: no active approval policy matches — fail closed",
    );
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Approval blocked: no active approval policy covers this amount — configure an approval policy first",
    });
  }

  const [policy] = await db
    .select()
    .from(approvalPolicies)
    .where(eq(approvalPolicies.id, Number(policyRow.id)))
    .limit(1);
  if (!policy) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Approval blocked: policy resolution failed" });
  }

  const approverIds = await resolveApproverChain(policy);
  if (!approverIds) {
    logger.warn({ policyId: policy.id, tenantId: input.tenantId }, "[ApprovalEngine] BLOCK: approver set unresolved — fail closed");
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Approval blocked: policy approvers could not be resolved — contact an administrator",
    });
  }
  if (approverIds.length < policy.requiredApprovals) {
    logger.warn({ policyId: policy.id, required: policy.requiredApprovals, resolved: approverIds.length },
      "[ApprovalEngine] BLOCK: fewer resolvable approvers than required approvals — fail closed");
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Approval blocked: policy requires more approvals than there are resolvable approvers",
    });
  }

  const reqRows = (await runner.execute(sql`
    INSERT INTO approval_requests (tenant_id, policy_id, entity_type, entity_id, amount, currency, status, steps_completed, steps_required, created_by, created_at, updated_at)
    VALUES (${input.tenantId}, ${policy.id}, ${input.entityType}, ${input.entityId}, ${input.amount.toFixed(4)}, ${input.currency}, 'pending', 0, ${policy.requiredApprovals}, ${input.createdBy}, NOW(), NOW())
    RETURNING id
  `)) as unknown as Array<{ id: number }>;
  const requestId = Number(reqRows[0]?.id);
  if (!requestId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Approval request creation failed" });
  }

  for (let i = 0; i < approverIds.length; i++) {
    await runner.execute(sql`
      INSERT INTO approval_steps (request_id, step, approver_user_id, status)
      VALUES (${requestId}, ${i + 1}, ${approverIds[i]}, 'pending')
    `);
  }

  emitApprovalEvent("approval.request.created", `approval:${requestId}`, {
    requestId,
    policyId: policy.id,
    tenantId: input.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    amount: input.amount,
    currency: input.currency,
    stepsRequired: policy.requiredApprovals,
    approverUserIds,
    createdBy: input.createdBy,
  });

  return { requestId, policyId: policy.id, stepsRequired: policy.requiredApprovals, approverUserIds: approverIds };
}

/**
 * Flip the owning entity when a request reaches a final decision.
 * Runs inside the request-decision db.transaction. Guarded: the entity must
 * still be in 'pending_approval' — 0 rows aborts the whole transaction.
 */
async function flipEntityInTx(
  tx: { execute: (q: unknown) => Promise<unknown> },
  req: ApprovalRequest,
  decision: "approved" | "rejected",
): Promise<void> {
  if (req.entityType !== "vendor_bill") {
    // Fail closed: never silently skip an entity flip for an unknown type.
    throw new Error(`ENTITY_FLIP_UNSUPPORTED: entity type ${req.entityType}`);
  }
  const rows = (await tx.execute(sql`
    UPDATE vendor_bills
    SET status = ${decision}, updated_at = NOW()
    WHERE id = ${Number(req.entityId)}
      AND tenant_id = ${req.tenantId}
      AND status = 'pending_approval'
    RETURNING id
  `)) as unknown as Array<{ id: number }>;
  if (rows.length === 0) {
    throw new Error("ENTITY_FLIP_FAILED: vendor_bill no longer pending_approval (concurrent transition)");
  }
}

export interface DecideStepInput {
  requestId: number;
  tenantId: number;
  approverUserId: number;
  decision: "approved" | "rejected";
  comment?: string;
}

export interface DecideStepResult {
  requestId: number;
  requestStatus: "pending" | "approved" | "rejected";
  step: number;
  stepsCompleted: number;
  stepsRequired: number;
  final: boolean;
}

/**
 * Decide the current step of an approval request.
 * Authorization: designated-approver match + self-approval guard + Permify
 * checkPermission (fail closed). Single-winner guarded updates; the final
 * decision flips the entity in the same db.transaction.
 *
 * NOTE: callers MUST perform the TOTP step-up before invoking this.
 */
export async function decideStep(input: DecideStepInput): Promise<DecideStepResult> {
  const db = await requireDb();

  // Load request + policy for authorization checks (before the tx).
  const [req] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, input.requestId), eq(approvalRequests.tenantId, input.tenantId)))
    .limit(1);
  if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
  if (req.status !== "pending") {
    throw new TRPCError({ code: "CONFLICT", message: `Approval request is already ${req.status}` });
  }
  const [policy] = await db.select().from(approvalPolicies).where(eq(approvalPolicies.id, req.policyId)).limit(1);
  if (!policy) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Approval policy missing — decision blocked" });

  // Self-approval guard.
  if (input.approverUserId === req.createdBy && !policy.allowSelfApproval) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Self-approval is not allowed by this policy" });
  }

  // Permify authorization — fail closed (unavailable/denied => FORBIDDEN).
  const permitted = await checkPermission({
    subject: `user:${input.approverUserId}`,
    action: "approve",
    entity: `${req.entityType}:${req.entityId}`,
  });
  if (!permitted) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Authorization denied for this approval decision" });
  }

  let result: DecideStepResult | null = null;
  await db.transaction(async (tx: any) => {
    // Lock the request row so concurrent decisions serialize.
    const lockRows = (await tx.execute(sql`
      SELECT id, status, steps_completed FROM approval_requests WHERE id = ${input.requestId} FOR UPDATE
    `)) as unknown as Array<{ id: number; status: string; steps_completed: number }>;
    if (!lockRows[0] || lockRows[0].status !== "pending") {
      throw new Error("REQUEST_NOT_PENDING");
    }

    // Current step = lowest-numbered pending step (sequential enforcement).
    const stepRows = (await tx.execute(sql`
      SELECT id, step, approver_user_id FROM approval_steps
      WHERE request_id = ${input.requestId} AND status = 'pending'
      ORDER BY step ASC
      LIMIT 1
    `)) as unknown as Array<{ id: number; step: number; approver_user_id: number }>;
    const current = stepRows[0];
    if (!current) throw new Error("NO_PENDING_STEP");
    if (current.approver_user_id !== input.approverUserId) {
      throw new Error("NOT_DESIGNATED_APPROVER");
    }

    // Guarded single-winner step update.
    const upd = (await tx.execute(sql`
      UPDATE approval_steps
      SET status = ${input.decision}, decided_at = NOW(), comment = ${input.comment ?? null}
      WHERE id = ${current.id} AND status = 'pending'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (upd.length === 0) throw new Error("STEP_RACE_LOST");

    const stepsCompleted = lockRows[0].steps_completed + 1;
    const isFinal = input.decision === "rejected" || stepsCompleted >= req.stepsRequired;
    const newStatus = input.decision === "rejected" ? "rejected" : isFinal ? "approved" : "pending";

    if (isFinal) {
      const reqUpd = (await tx.execute(sql`
        UPDATE approval_requests
        SET status = ${newStatus}, steps_completed = ${stepsCompleted}, decided_by = ${input.approverUserId}, decided_at = NOW(), updated_at = NOW()
        WHERE id = ${input.requestId} AND status = 'pending'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (reqUpd.length === 0) throw new Error("REQUEST_RACE_LOST");
      // Final decision flips the entity in the SAME transaction.
      await flipEntityInTx(tx, req, newStatus as "approved" | "rejected");
    } else {
      await tx.execute(sql`
        UPDATE approval_requests
        SET steps_completed = ${stepsCompleted}, updated_at = NOW()
        WHERE id = ${input.requestId}
      `);
    }

    result = {
      requestId: input.requestId,
      requestStatus: newStatus as DecideStepResult["requestStatus"],
      step: current.step,
      stepsCompleted,
      stepsRequired: req.stepsRequired,
      final: isFinal,
    };
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "NOT_DESIGNATED_APPROVER") {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not the designated approver for the current step" });
    }
    if (msg === "STEP_RACE_LOST" || msg === "REQUEST_RACE_LOST" || msg === "REQUEST_NOT_PENDING" || msg === "NO_PENDING_STEP") {
      throw new TRPCError({ code: "CONFLICT", message: "This approval step was already decided by another approver" });
    }
    if (msg.startsWith("ENTITY_FLIP")) {
      logger.error({ requestId: input.requestId, err: msg }, "[ApprovalEngine] Entity flip failed — decision aborted atomically, NO state changed");
      throw new TRPCError({ code: "CONFLICT", message: "The underlying entity is no longer awaiting approval — decision aborted" });
    }
    throw err;
  });

  const r = result as unknown as DecideStepResult;
  emitApprovalEvent("approval.step.decided", `approval:${input.requestId}:step:${r.step}`, {
    requestId: input.requestId,
    tenantId: input.tenantId,
    entityType: req.entityType,
    entityId: req.entityId,
    step: r.step,
    decision: input.decision,
    decidedBy: input.approverUserId,
    stepsCompleted: r.stepsCompleted,
    stepsRequired: r.stepsRequired,
    requestStatus: r.requestStatus,
  });
  if (r.final) {
    emitApprovalEvent(`approval.request.${r.requestStatus}`, `approval:${input.requestId}:${r.requestStatus}`, {
      requestId: input.requestId,
      tenantId: input.tenantId,
      entityType: req.entityType,
      entityId: req.entityId,
      decidedBy: input.approverUserId,
      requestStatus: r.requestStatus,
    });
  }
  return r;
}

/**
 * Expire a still-pending approval request (Temporal approval-expiry path).
 * Guarded pending → expired; row-count 0 means it was already decided —
 * that is a no-op, NOT an error. Emits the Kafka expiry event only when the
 * guarded update actually won. Returns the winning outcome.
 *
 * M9: the owning entity is released in the SAME db.transaction — an expiry
 * must never orphan the entity in pending_approval (submitForApproval only
 * accepts 'captured', so an orphaned bill could never be resubmitted). The
 * ONLY entity type the engine supports is vendor_bill (see ApprovalEntityType);
 * its honest return-to-previous state is 'captured' (the state
 * submitForApproval guarded entry from), recorded with
 * metadata.approvalExpired {requestId, expiredAt}. The entity flip is guarded
 * pending_approval → captured: 0 rows means the entity already moved on
 * (decision raced the expiry and won first) — that is fine, not an error.
 */
export async function expireRequest(requestId: number): Promise<"expired" | "already_decided" | "not_found"> {
  const db = await requireDb();
  const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
  if (!req) return "not_found";

  let entityReleased = false;
  const outcome = await db.transaction(async (tx: any) => {
    const rows = (await tx.execute(sql`
      UPDATE approval_requests
      SET status = 'expired', updated_at = NOW()
      WHERE id = ${requestId} AND status = 'pending'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (rows.length === 0) return "already_decided" as const;

    if (req.entityType !== "vendor_bill") {
      // Fail closed (mirrors flipEntityInTx): never silently expire a request
      // whose entity type has no defined release transition — abort the whole
      // transaction so request and entity can never diverge.
      throw new Error(`ENTITY_RELEASE_UNSUPPORTED: entity type ${req.entityType}`);
    }
    const entityRows = (await tx.execute(sql`
      UPDATE vendor_bills
      SET status = 'captured',
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            approvalExpired: { requestId, expiredAt: new Date().toISOString() },
          })}::jsonb,
          updated_at = NOW()
      WHERE id = ${Number(req.entityId)}
        AND tenant_id = ${req.tenantId}
        AND status = 'pending_approval'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    entityReleased = entityRows.length > 0;
    return "expired" as const;
  });
  if (outcome === "already_decided") return "already_decided";

  emitApprovalEvent("approval.request.expired", `approval:${requestId}:expired`, {
    requestId,
    tenantId: req.tenantId,
    entityType: req.entityType,
    entityId: req.entityId,
    createdBy: req.createdBy,
    entityReleased,
  });
  return "expired";
}

/** Load a request with its steps (tenant-scoped) for router queries. */
export async function getRequestWithSteps(requestId: number, tenantId: number) {
  const db = await requireDb();
  const [req] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.tenantId, tenantId)))
    .limit(1);
  if (!req) return null;
  const steps = await db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.requestId, requestId))
    .orderBy(approvalSteps.step);
  return { request: req, steps };
}

/** Latest request for an entity (tenant-scoped). */
export async function getLatestRequestForEntity(entityType: ApprovalEntityType, entityId: string, tenantId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.entityType, entityType),
        eq(approvalRequests.entityId, entityId),
        eq(approvalRequests.tenantId, tenantId),
      ),
    )
    .orderBy(sql`${approvalRequests.id} DESC`)
    .limit(1);
  return rows[0] ?? null;
}
