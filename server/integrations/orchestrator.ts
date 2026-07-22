import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import type { KYCWorkflowInput, TransferWorkflowInput } from "../temporal/workflows";

export interface TransferOrchestrationInput extends TransferWorkflowInput {
  /** Routing rail is recorded in downstream events; Temporal receives its canonical workflow fields. */
  rail: string;
}

export interface TransferOrchestrationResult {
  success: boolean;
  temporalWorkflowId: string;
  error?: string;
}

function workflowAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer amount must be a finite positive number." });
  }
  return amount;
}

/**
 * Runs the authoritative transfer orchestration. It fails when any configured
 * durable dependency rejects an action; no event, analytics, or authorization
 * result is fabricated locally.
 */
export async function orchestrateTransfer(input: TransferOrchestrationInput): Promise<TransferOrchestrationResult> {
  const { userId, amount, fromCurrency, toCurrency, idempotencyKey, rail } = input;
  workflowAmount(amount);
  logger.info({ userId, amount, fromCurrency, toCurrency, rail }, "[Orchestrator] Starting transfer orchestration");

  const { getRedisClient, REDIS_KEYS } = await import("../middleware/redis");
  const redis = getRedisClient();
  if (!redis) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Redis is unavailable for transfer idempotency." });
  const existing = await redis.get(REDIS_KEYS.IDEMPOTENCY(idempotencyKey));
  if (existing) return JSON.parse(existing) as TransferOrchestrationResult;

  const { permify, dapr, fluvio, lakehouse } = await import("../middleware/middlewareIntegration");
  const authorized = await permify.check({
    entity: "wallet",
    entityId: String(userId),
    permission: "transfer",
    subject: "user",
    subjectId: String(userId),
  });
  if (!authorized) throw new TRPCError({ code: "FORBIDDEN", message: "Transfer not authorized by Permify." });

  const { startTransferWorkflow } = await import("../temporal/client");
  const temporal = await startTransferWorkflow({
    userId,
    fromCurrency,
    toCurrency,
    amount,
    recipientName: input.recipientName,
    recipientAccount: input.recipientAccount,
    recipientBank: input.recipientBank,
    recipientCountry: input.recipientCountry,
    description: input.description,
    idempotencyKey,
    fxRate: input.fxRate,
    fee: input.fee,
    toAmount: input.toAmount,
  });
  if (temporal.fallback) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Temporal workflow service did not accept the transfer." });

  const event = {
    userId,
    amount,
    fromCurrency,
    toCurrency,
    rail,
    workflowId: temporal.workflowId,
    idempotencyKey,
    timestamp: new Date().toISOString(),
  };
  await dapr.publishEvent("transfer.initiated", event);
  const fluvioPublished = await fluvio.produce("transfer-events", idempotencyKey, JSON.stringify(event));
  if (!fluvioPublished) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Fluvio rejected the transfer event." });
  const ingested = await lakehouse.ingest("transfer_audit", [event]);
  if (ingested.ingested < 1) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Lakehouse audit ingestion failed." });

  const result: TransferOrchestrationResult = { success: true, temporalWorkflowId: temporal.workflowId };
  await redis.setex(REDIS_KEYS.IDEMPOTENCY(idempotencyKey), 86_400, JSON.stringify(result));
  logger.info({ userId, workflowId: temporal.workflowId }, "[Orchestrator] Transfer orchestration completed");
  return result;
}

/** Starts the complete KYC workflow and records real cross-service state. */
export async function orchestrateKycVerification(input: KYCWorkflowInput): Promise<{ workflowId: string; success: true }> {
  logger.info({ userId: input.userId, documentId: input.kycDocId }, "[Orchestrator] Starting KYC orchestration");
  const { startKYCWorkflow } = await import("../temporal/client");
  const temporal = await startKYCWorkflow(input);
  if (temporal.fallback) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Temporal workflow service did not accept KYC verification." });

  const { dapr, fluvio, keycloak } = await import("../middleware/middlewareIntegration");
  const event = { userId: input.userId, documentId: input.kycDocId, workflowId: temporal.workflowId, timestamp: new Date().toISOString() };
  await dapr.publishEvent("kyc.verification.started", event);
  if (!(await fluvio.produce("kyc-events", String(input.userId), JSON.stringify(event)))) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Fluvio rejected the KYC event." });
  }
  await keycloak.updateUserAttributes(String(input.userId), { kyc_status: "verification_in_progress" });
  return { workflowId: temporal.workflowId, success: true };
}

/** Provisions the required identity, authorization, ledger, and event resources for a user. */
export async function provisionNewUser(userId: number, currencies: string[]): Promise<void> {
  if (!currencies.length) throw new TRPCError({ code: "BAD_REQUEST", message: "At least one account currency is required." });
  logger.info({ userId, currencies }, "[Orchestrator] Provisioning new user");
  const { provisionTigerBeetleAccounts } = await import("../_core/tigerBeetleProvisioning");
  await provisionTigerBeetleAccounts(userId, currencies);

  const { permify, keycloak, dapr } = await import("../middleware/middlewareIntegration");
  const relationshipWritten = await permify.writeRelationship({
    entity: "user",
    entityId: String(userId),
    relation: "owner",
    subject: "user",
    subjectId: String(userId),
  });
  if (!relationshipWritten) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Permify rejected user provisioning." });
  await keycloak.updateUserAttributes(String(userId), {
    tigerbeetle_provisioned: "true",
    provisioned_at: new Date().toISOString(),
  });
  await dapr.publishEvent("user.provisioned", { userId, currencies, timestamp: new Date().toISOString() });
  logger.info({ userId }, "[Orchestrator] User provisioning completed");
}
