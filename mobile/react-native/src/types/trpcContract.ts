/**
 * Mobile RN scaffold — tRPC contract for the RemitFlow API.
 *
 * This standalone tree cannot import `server/routers` (separate package, no
 * server deps installed), so — mirroring uis/pwa/src/types/appRouter.ts — we
 * declare the client-side contract for exactly the procedures consumed here:
 *   - server/routers/stablecoinEnhanced.ts:
 *       stablecoinPlatform.{onramp,offramp}
 *       stablecoinExt.{swap,send,stakeForYield,unstake,bridgeChain,payBill}
 *
 * W19-F: swap/send/stakeForYield/unstake/bridgeChain/payBill were moved from
 * stablecoinPlatform (where they DO NOT exist — audit w19-alignment §2) to
 * stablecoinExt (stablecoinExtendedRouter, stablecoinEnhanced.ts:674+), their
 * real home. All stablecoinExt money ops require idempotencyKey (min 8) and
 * accept an optional TOTP step-up code; requireTotpStepUp is enforced
 * server-side for enrolled users.
 *
 * Procedure NAMES and kinds are verified 1:1 against the server router.
 * Inputs are typed as `unknown` on purpose: StablecoinScreen sends payloads
 * with `as any` casts, so a strict schema mirror would drift. Wire-level
 * validation is enforced server-side by the zod schemas in
 * stablecoinEnhanced.ts; this contract only fixes the client type graph.
 *
 * The resolvers are never executed: only `typeof mobileTrpcContract` is
 * exported (type-only import), so this module is elided from any bundle.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

// Transformer matches the server (superjson) so client link typing aligns.
const t = initTRPC.create({ transformer: superjson });

const neverRuns = (): never => {
  throw new Error("Mobile tRPC contract is type-only and must never be invoked");
};

export const mobileTrpcContract = t.router({
  stablecoinPlatform: t.router({
    onramp: t.procedure.input(z.unknown()).mutation(neverRuns),
    offramp: t.procedure.input(z.unknown()).mutation(neverRuns),
  }),
  stablecoinExt: t.router({
    swap: t.procedure.input(z.unknown()).mutation(neverRuns),
    send: t.procedure.input(z.unknown()).mutation(neverRuns),
    stakeForYield: t.procedure.input(z.unknown()).mutation(neverRuns),
    unstake: t.procedure.input(z.unknown()).mutation(neverRuns),
    bridgeChain: t.procedure.input(z.unknown()).mutation(neverRuns),
    payBill: t.procedure.input(z.unknown()).mutation(neverRuns),
  }),
});

export type MobileAppRouter = typeof mobileTrpcContract;
