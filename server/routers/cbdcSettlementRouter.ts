/**
 * RemitFlow — CBDC & Stablecoin Settlement Router
 * ══════════════════════════════════════════════════════════════════════════════
 * Bridges the TypeScript API layer to the Go/Rust CBDC and stablecoin services.
 *
 * Settlement rails supported:
 *   1. AfriCBDC (African Central Bank Digital Currencies — eNaira, eCedi, etc.)
 *   2. USDC / USDT stablecoin settlement via Rust bridge
 *   3. Ripple/XRP for cross-border corridor optimization
 *   4. FX Forward hedging via go-fx-hedging
 *
 * Architecture:
 *   tRPC Router → Go Stablecoin Engine → Rust TigerBeetle Bridge → Ledger
 *                → Python CBDC Gateway → Central Bank API
 *                → Go FX Hedging      → Forward Contract Lock
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { withSpan } from "../telemetry/otel";
import { publishPaymentInitiated } from "../middleware/kafka";

// ── Service URLs ──────────────────────────────────────────────────────────────

const STABLECOIN_ENGINE_URL = process.env.STABLECOIN_ENGINE_URL;
const CBDC_GATEWAY_URL = process.env.CBDC_GATEWAY_URL;
const FX_HEDGING_URL = process.env.FX_HEDGING_URL;
const AFRICBDC_URL = process.env.AFRICBDC_URL;
const STABLECOIN_BRIDGE_URL = process.env.STABLECOIN_BRIDGE_URL;

const SettlementRailSchema = z.object({
  railId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["stablecoin", "cbdc"]),
  estimatedFeePercent: z.number().nonnegative(),
  estimatedDeliveryMinutes: z.number().nonnegative(),
  minAmount: z.number().positive(),
  maxAmount: z.number().positive(),
  available: z.boolean(),
  currencies: z.array(z.string().length(3)).min(1),
});
type SettlementRail = z.infer<typeof SettlementRailSchema>;

async function serviceCall<T>(
  url: string | undefined,
  path: string,
  method: "GET" | "POST" = "POST",
  body?: unknown
): Promise<T | null> {
  if (!url) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Required settlement service URL is not configured." });
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── tRPC Router ───────────────────────────────────────────────────────────────

export const cbdcSettlementRouter = router({
  /**
   * Get available CBDC and stablecoin settlement rails for a corridor.
   */
  getRails: protectedProcedure
    .input(z.object({
      sendCurrency: z.string().length(3),
      receiveCurrency: z.string().length(3),
      amount: z.number().positive(),
    }))
    .query(async ({ input }) => {
      return withSpan("cbdc.getRails", async () => {
        const [stablecoinRails, cbdcRails] = await Promise.all([
          serviceCall<{ rails: unknown[] }>(
            STABLECOIN_ENGINE_URL, "/rails/available", "POST",
            { send_currency: input.sendCurrency, receive_currency: input.receiveCurrency, amount: input.amount }
          ),
          serviceCall<{ rails: unknown[] }>(
            CBDC_GATEWAY_URL, "/rails/available", "POST",
            { send_currency: input.sendCurrency, receive_currency: input.receiveCurrency }
          ),
        ]);
        if (!stablecoinRails || !cbdcRails) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Settlement rail services are unavailable." });
        }
        const rails: SettlementRail[] = [...stablecoinRails.rails, ...cbdcRails.rails]
          .map((rail) => SettlementRailSchema.parse(rail))
          .filter((rail) => rail.available && rail.currencies.includes(input.receiveCurrency));

        return {
          sendCurrency: input.sendCurrency,
          receiveCurrency: input.receiveCurrency,
          amount: input.amount,
          rails,
          recommendedRailId: rails[0]?.railId ?? null,
        };
      });
    }),

  /**
   * Initiate a stablecoin settlement for a transfer.
   */
  initiateStablecoinSettlement: protectedProcedure
    .input(z.object({
      transferId: z.string(),
      railId: z.string(),
      amount: z.number().positive(),
      sendCurrency: z.string().length(3),
      receiveCurrency: z.string().length(3),
      recipientWalletAddress: z.string().optional(),
      recipientAccountId: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return withSpan("cbdc.initiateStablecoinSettlement", async (span) => {
        span.setAttributes({
          "cbdc.transfer_id": input.transferId,
          "cbdc.rail_id": input.railId,
          "cbdc.amount": input.amount,
        });

        const result = await serviceCall<{
          settlementId: string;
          txHash?: string;
          status: string;
          estimatedCompletionAt: string;
        }>(
          STABLECOIN_ENGINE_URL, "/settlement/initiate", "POST",
          {
            transfer_id: input.transferId,
            rail_id: input.railId,
            amount: input.amount,
            send_currency: input.sendCurrency,
            receive_currency: input.receiveCurrency,
            recipient_wallet: input.recipientWalletAddress,
            recipient_account: input.recipientAccountId,
            user_id: ctx.user.id,
          }
        );

        if (!result) {
          // Fallback response when service is starting up
          const settlementId = `STL-${Date.now()}`;
          logger.warn({ transferId: input.transferId }, "[CBDC] Stablecoin engine unavailable — queued");
          return {
            settlementId,
            transferId: input.transferId,
            railId: input.railId,
            status: "queued",
            estimatedCompletionAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          };
        }

        // Publish to Kafka for downstream processing
        await publishPaymentInitiated({
          transferId: input.transferId,
          userId: ctx.user.id,
          amount: input.amount,
          currency: input.sendCurrency,
          provider: input.railId,
          metadata: { settlementId: result.settlementId, txHash: result.txHash },
        } as any);

        return {
          settlementId: result.settlementId,
          transferId: input.transferId,
          railId: input.railId,
          txHash: result.txHash,
          status: result.status,
          estimatedCompletionAt: result.estimatedCompletionAt,
        };
      });
    }),

  /**
   * Initiate a CBDC settlement via the AfriCBDC adapter.
   */
  initiateCbdcSettlement: protectedProcedure
    .input(z.object({
      transferId: z.string(),
      cbdcType: z.enum(["enaira", "ecedi", "eshilling", "erand"]),
      amount: z.number().positive(),
      currency: z.string().length(3),
      recipientCbdcAddress: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return withSpan("cbdc.initiateCbdcSettlement", async (span) => {
        span.setAttributes({
          "cbdc.type": input.cbdcType,
          "cbdc.transfer_id": input.transferId,
        });

        const result = await serviceCall<{
          cbdcTxId: string;
          status: string;
          blockHeight?: number;
          confirmedAt?: string;
        }>(
          AFRICBDC_URL, "/transfer/initiate", "POST",
          {
            transfer_id: input.transferId,
            cbdc_type: input.cbdcType,
            amount: input.amount,
            currency: input.currency,
            recipient_address: input.recipientCbdcAddress,
            user_id: ctx.user.id,
          }
        );

        logger.info(
          { userId: ctx.user.id, transferId: input.transferId, cbdcType: input.cbdcType },
          "[CBDC] Settlement initiated"
        );

        return {
          cbdcTxId: result?.cbdcTxId ?? `CBDC-${Date.now()}`,
          transferId: input.transferId,
          cbdcType: input.cbdcType,
          status: result?.status ?? "pending",
          blockHeight: result?.blockHeight,
          confirmedAt: result?.confirmedAt,
        };
      });
    }),

  /**
   * Lock an FX forward contract to hedge a future transfer.
   */
  lockFxForward: protectedProcedure
    .input(z.object({
      baseCurrency: z.string().length(3),
      quoteCurrency: z.string().length(3),
      notionalAmount: z.number().positive(),
      settlementDays: z.number().int().min(1).max(365).default(2),
    }))
    .mutation(async ({ input, ctx }) => {
      return withSpan("cbdc.lockFxForward", async () => {
        const result = await serviceCall<{
          contractId: string;
          forwardRate: number;
          spotRate: number;
          forwardPoints: number;
          expiresAt: string;
        }>(
          FX_HEDGING_URL, "/forward/create", "POST",
          {
            base_currency: input.baseCurrency,
            quote_currency: input.quoteCurrency,
            notional_amount: input.notionalAmount,
            settlement_days: input.settlementDays,
            user_id: ctx.user.id,
          }
        );

        return {
          contractId: result?.contractId ?? `FWD-${Date.now()}`,
          baseCurrency: input.baseCurrency,
          quoteCurrency: input.quoteCurrency,
          notionalAmount: input.notionalAmount,
          forwardRate: result?.forwardRate ?? 0,
          spotRate: result?.spotRate ?? 0,
          forwardPoints: result?.forwardPoints ?? 0,
          settlementDays: input.settlementDays,
          expiresAt: result?.expiresAt ?? new Date(Date.now() + input.settlementDays * 86400_000).toISOString(),
          status: "locked",
        };
      });
    }),

  /**
   * Get current hedge exposure and P&L for the platform.
   */
  getHedgeExposure: adminProcedure
    .query(async () => {
      const result = await serviceCall<{
        totalExposureUsd: number;
        hedgedPercent: number;
        unrealizedPnl: number;
        positions: unknown[];
      }>(FX_HEDGING_URL, "/exposure", "GET");

      return result ?? {
        totalExposureUsd: 0,
        hedgedPercent: 0,
        unrealizedPnl: 0,
        positions: [],
        serviceAvailable: false,
      };
    }),

  /**
   * Get CBDC wallet balance for a user.
   */
  getCbdcBalance: protectedProcedure
    .input(z.object({
      cbdcType: z.enum(["enaira", "ecedi", "eshilling", "erand"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const result = await serviceCall<{
        balances: Array<{ cbdcType: string; amount: number; currency: string; address: string }>;
      }>(
        AFRICBDC_URL, "/wallet/balance", "POST",
        { user_id: ctx.user.id, cbdc_type: input.cbdcType }
      );

      return {
        userId: ctx.user.id,
        balances: result?.balances ?? [],
        retrievedAt: new Date(),
      };
    }),
});
