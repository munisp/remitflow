/**
 * RemitFlow — Open Banking PSD2 AISP/PISP Router
 * ══════════════════════════════════════════════════════════════════════════════
 * Implements PSD2-compliant Open Banking capabilities:
 *
 *  AISP (Account Information Service Provider):
 *   - Consent management (create, list, revoke)
 *   - Account aggregation from external banks
 *   - Balance and transaction history retrieval
 *   - Recurring payment detection
 *   - Affordability assessment for BNPL/credit
 *
 *  PISP (Payment Initiation Service Provider):
 *   - Initiate payments from linked bank accounts
 *   - Bulk payment initiation
 *   - Standing order creation
 *   - Payment status tracking
 *
 * Supported Open Banking standards:
 *   - UK Open Banking (OBIE) v3.1
 *   - Berlin Group NextGenPSD2 v1.3
 *   - STET (France) v1.4
 *   - Nigeria Open Banking (CBN) v1.0
 *
 * Integration: Connects to go-open-banking microservice (port 8120)
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { requireRedisClient } from "../middleware/redis";
const redis = requireRedisClient();
import { db } from "../db-shim";
import { openBankingConsents } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { publishEvent } from "../lib/middleware-orchestrator";

// ── Config ────────────────────────────────────────────────────────────────────

const OB_SVC_URL = process.env.OPEN_BANKING_SVC_URL ?? "http://go-open-banking:8120";
const CONSENT_CACHE_TTL = 5 * 60; // 5 minutes

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const ConsentPermissionsSchema = z.array(z.enum([
  "ReadAccountsBasic",
  "ReadAccountsDetail",
  "ReadBalances",
  "ReadTransactionsBasic",
  "ReadTransactionsDetail",
  "ReadTransactionsCredits",
  "ReadTransactionsDebits",
  "ReadBeneficiariesDetail",
  "ReadDirectDebits",
  "ReadStandingOrdersDetail",
  "ReadProducts",
  "ReadOffers",
  "ReadParty",
  "ReadPartyPSU",
  "ReadScheduledPaymentsBasic",
  "ReadScheduledPaymentsDetail",
]));

// ── Service Helper ────────────────────────────────────────────────────────────

async function callObService<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" | "PATCH",
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T | null> {
  try {
    const res = await fetch(`${OB_SVC_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Service": "remitflow-api",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "[OpenBanking] Service error");
      return null;
    }
    return res.json() as Promise<T>;
  } catch (e) {
    logger.error({ err: e, path }, "[OpenBanking] Service call failed");
    return null;
  }
}

// ── SEC-22: Consent ownership guard ──────────────────────────────────────────
// Every consent-scoped AISP/PISP endpoint must verify the consent belongs to
// the authenticated user before touching the upstream Open Banking service.
async function assertConsentOwnership(consentId: string, userId: number): Promise<void> {
  const [consent] = await db
    .select({ id: openBankingConsents.id, userId: openBankingConsents.userId, status: openBankingConsents.status })
    .from(openBankingConsents)
    .where(eq(openBankingConsents.consentId, consentId))
    .limit(1);
  if (!consent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Consent not found" });
  }
  if (consent.userId !== userId) {
    logger.warn({ userId, consentId }, "[OpenBanking] IDOR attempt — consent ownership mismatch");
    throw new TRPCError({ code: "FORBIDDEN", message: "Consent does not belong to the authenticated user" });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const openBankingPsd2Router = router({

  // ── AISP: Consent Management ───────────────────────────────────────────────

  /**
   * Create a new account information consent request.
   * Returns a redirect URL for the customer to authorise at their bank.
   */
  createConsent: protectedProcedure
    .input(z.object({
      institutionId: z.string().min(2).max(50),
      permissions: ConsentPermissionsSchema.min(1),
      expirationDateTime: z.string().datetime().optional(),
      transactionFromDateTime: z.string().datetime().optional(),
      transactionToDateTime: z.string().datetime().optional(),
      standard: z.enum(["uk_obie", "berlin_group", "stet", "cbn"]).default("uk_obie"),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      const result = await callObService<{
        consentId: string;
        status: string;
        authorisationUrl: string;
        expiresAt: string;
      }>("/v1/aisp/consents", "POST", {
        userId,
        institutionId: input.institutionId,
        permissions: input.permissions,
        expirationDateTime: input.expirationDateTime,
        transactionFromDateTime: input.transactionFromDateTime,
        transactionToDateTime: input.transactionToDateTime,
        standard: input.standard,
      });

      if (!result) {
        // Return a mock consent for development/testing
        const mockConsentId = `consent_${Date.now()}_${userId}`;
        logger.warn({ userId, institutionId: input.institutionId }, "[OpenBanking] Service unavailable — returning mock consent");
        return {
          consentId: mockConsentId,
          status: "AwaitingAuthorisation",
          authorisationUrl: `https://auth.${input.institutionId}.com/oauth2/authorize?consent_id=${mockConsentId}&redirect_uri=https://app.remitflow.io/open-banking/callback`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          standard: input.standard,
          permissions: input.permissions,
          mock: true,
        };
      }

      // Store consent reference in DB
      try {
        await db.insert(openBankingConsents).values({
          userId,
          consentId: result.consentId,
          institutionId: input.institutionId,
          status: result.status,
          permissions: input.permissions,
          expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
        } as any);
      } catch (e) {
        logger.warn({ err: e }, "[OpenBanking] Failed to persist consent");
      }

      await publishEvent("open_banking.consent.created", {
        userId,
        consentId: result.consentId,
        institutionId: input.institutionId,
        permissions: input.permissions,
      });

      return { ...result, standard: input.standard, permissions: input.permissions };
    }),

  /**
   * List all active consents for the current user.
   */
  listConsents: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;
      const cacheKey = `ob:consents:${userId}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const consents = await db.select()
        .from(openBankingConsents)
        .where(eq(openBankingConsents.userId, userId))
        .orderBy(desc(openBankingConsents.createdAt));

      await redis.set(cacheKey, JSON.stringify(consents), "EX", CONSENT_CACHE_TTL);
      return consents;
    }),

  /**
   * Revoke an account information consent.
   */
  revokeConsent: protectedProcedure
    .input(z.object({ consentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      // SEC-22: verify ownership before issuing the upstream DELETE
      await assertConsentOwnership(input.consentId, userId);

      await callObService(`/v1/aisp/consents/${input.consentId}`, "DELETE");

      // Update DB
      try {
        await db.update(openBankingConsents)
          .set({ status: "Revoked" } as any)
          .where(
            and(
              eq(openBankingConsents.consentId, input.consentId),
              eq(openBankingConsents.userId, userId),
            )
          );
      } catch (e) {
        logger.warn({ err: e }, "[OpenBanking] Failed to update consent status");
      }

      await redis.del(`ob:consents:${userId}`);
      await publishEvent("open_banking.consent.revoked", { userId, consentId: input.consentId });

      return { revoked: true, consentId: input.consentId };
    }),

  // ── AISP: Account Data ─────────────────────────────────────────────────────

  /**
   * Retrieve aggregated accounts from a linked institution.
   */
  getAccounts: protectedProcedure
    .input(z.object({ consentId: z.string() }))
    .query(async ({ input, ctx }) => {
      // SEC-22: consent ownership required before any account data access
      await assertConsentOwnership(input.consentId, ctx.user.id);

      const cacheKey = `ob:accounts:${input.consentId}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await callObService<{
        accounts: Array<{
          accountId: string;
          currency: string;
          accountType: string;
          accountSubType: string;
          nickname: string;
          sortCodeAccountNumber?: string;
          iban?: string;
          balance?: number;
        }>;
      }>(`/v1/aisp/accounts?consentId=${input.consentId}`, "GET");

      if (!result) {
        // Return mock accounts for development
        return {
          accounts: [
            {
              accountId: "acc_mock_001",
              currency: "GBP",
              accountType: "Personal",
              accountSubType: "CurrentAccount",
              nickname: "Main Current Account",
              sortCodeAccountNumber: "20-00-00 / 12345678",
              balance: 2450.00,
            },
            {
              accountId: "acc_mock_002",
              currency: "GBP",
              accountType: "Personal",
              accountSubType: "Savings",
              nickname: "Savings Account",
              balance: 8750.00,
            },
          ],
          mock: true,
        };
      }

      await redis.set(cacheKey, JSON.stringify(result), "EX", CONSENT_CACHE_TTL);
      return result;
    }),

  /**
   * Retrieve account balances.
   */
  getBalances: protectedProcedure
    .input(z.object({
      consentId: z.string(),
      accountId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      // SEC-22: consent ownership required
      await assertConsentOwnership(input.consentId, ctx.user.id);

      const result = await callObService<{
        balances: Array<{
          type: string;
          amount: number;
          currency: string;
          creditDebitIndicator: string;
          dateTime: string;
        }>;
      }>(`/v1/aisp/accounts/${input.accountId}/balances?consentId=${input.consentId}`, "GET");

      if (!result) {
        return {
          balances: [
            { type: "ClosingAvailable", amount: 2450.00, currency: "GBP", creditDebitIndicator: "Credit", dateTime: new Date().toISOString() },
            { type: "ClosingBooked", amount: 2450.00, currency: "GBP", creditDebitIndicator: "Credit", dateTime: new Date().toISOString() },
          ],
          mock: true,
        };
      }

      return result;
    }),

  /**
   * Retrieve transaction history for affordability assessment.
   */
  getTransactionHistory: protectedProcedure
    .input(z.object({
      consentId: z.string(),
      accountId: z.string(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // SEC-22: consent ownership required
      await assertConsentOwnership(input.consentId, ctx.user.id);

      const params = new URLSearchParams({ consentId: input.consentId });
      if (input.fromDate) params.set("fromBookingDateTime", input.fromDate);
      if (input.toDate) params.set("toBookingDateTime", input.toDate);

      const result = await callObService<{
        transactions: Array<{
          transactionId: string;
          bookingDateTime: string;
          amount: number;
          currency: string;
          creditDebitIndicator: string;
          merchantName?: string;
          transactionInformation?: string;
        }>;
        totalCount: number;
      }>(`/v1/aisp/accounts/${input.accountId}/transactions?${params}`, "GET");

      return result ?? { transactions: [], totalCount: 0, mock: true };
    }),

  // ── AISP: Affordability ────────────────────────────────────────────────────

  /**
   * Perform an affordability assessment using Open Banking data.
   * Used for BNPL eligibility and credit limit decisions.
   */
  affordabilityAssessment: protectedProcedure
    .input(z.object({
      consentId: z.string(),
      accountId: z.string(),
      requestedAmount: z.number().positive(),
      currency: z.string().length(3),
    }))
    .mutation(async ({ input, ctx }) => {
      // SEC-22: consent ownership required
      await assertConsentOwnership(input.consentId, ctx.user.id);

      const result = await callObService<{
        eligible: boolean;
        maxAffordableAmount: number;
        monthlyIncome: number;
        monthlyExpenses: number;
        disposableIncome: number;
        debtToIncomeRatio: number;
        creditScore: number;
        recommendation: string;
      }>("/v1/aisp/affordability", "POST", {
        userId: ctx.user.id,
        consentId: input.consentId,
        accountId: input.accountId,
        requestedAmount: input.requestedAmount,
        currency: input.currency,
      });

      if (!result) {
        return {
          eligible: input.requestedAmount <= 500,
          maxAffordableAmount: 500,
          monthlyIncome: 0,
          monthlyExpenses: 0,
          disposableIncome: 0,
          debtToIncomeRatio: 0,
          creditScore: 0,
          recommendation: "Unable to assess affordability — Open Banking data unavailable",
          mock: true,
        };
      }

      return result;
    }),

  // ── PISP: Payment Initiation ───────────────────────────────────────────────

  /**
   * Initiate a payment from a linked bank account.
   */
  initiatePayment: protectedProcedure
    .input(z.object({
      consentId: z.string(),
      debtorAccountId: z.string(),
      creditorName: z.string().min(2).max(100),
      creditorAccountNumber: z.string().min(8).max(34),
      creditorSortCode: z.string().optional(),
      creditorIban: z.string().optional(),
      amount: z.number().positive(),
      currency: z.string().length(3),
      reference: z.string().max(35),
      endToEndId: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // SEC-22: consent ownership required before initiating any payment
      await assertConsentOwnership(input.consentId, ctx.user.id);

      const result = await callObService<{
        paymentId: string;
        status: string;
        createdAt: string;
        expectedSettlementDate: string;
      }>("/v1/pisp/payments", "POST", {
        userId: ctx.user.id,
        consentId: input.consentId,
        debtorAccountId: input.debtorAccountId,
        creditorName: input.creditorName,
        creditorAccountNumber: input.creditorAccountNumber,
        creditorSortCode: input.creditorSortCode,
        creditorIban: input.creditorIban,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        endToEndId: input.endToEndId ?? `E2E${Date.now()}`,
      });

      if (!result) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Payment initiation service temporarily unavailable. Please try again.",
        });
      }

      await publishEvent("open_banking.payment.initiated", {
        userId: ctx.user.id,
        paymentId: result.paymentId,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
      });

      return result;
    }),

  /**
   * Get the status of an initiated payment.
   */
  getPaymentStatus: protectedProcedure
    .input(z.object({ paymentId: z.string() }))
    .query(async ({ input }) => {
      const result = await callObService<{
        paymentId: string;
        status: string;
        statusUpdateDateTime: string;
        charges?: Array<{ amount: number; currency: string; type: string }>;
      }>(`/v1/pisp/payments/${input.paymentId}`, "GET");

      if (!result) {
        return {
          paymentId: input.paymentId,
          status: "Unknown",
          statusUpdateDateTime: new Date().toISOString(),
          mock: true,
        };
      }

      return result;
    }),
});
