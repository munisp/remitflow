/**
 * PWA-local tRPC contract for the RemitFlow API.
 *
 * The PWA is a standalone npm package (own package-lock.json); importing
 * `type { AppRouter } from "../../../../server/routers"` pulls the entire
 * server source tree (workers, telemetry, temporal, drizzle, ...) into the
 * PWA compile, which cannot resolve server-only dependencies.
 *
 * This module declares the client-side contract for exactly the procedures
 * the PWA consumes. It is a structural mirror of the server routers:
 *   - server/routers/kycOrchestration.ts (submit, createChallenge)
 *   - server/routers/operationsMap.ts   (overview)
 * Input schemas are copied 1:1 from the server zod schemas so client-side
 * validation matches the wire contract. Outputs are the downstream service
 * JSON payloads (`unknown` at the type level; pages cast to their own
 * interfaces, e.g. OperationsMapData).
 *
 * DRIFT RISK: when a consumed procedure's input changes on the server,
 * update this contract in the same change.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

// Transformer matches the server (superjson) so client link typing aligns.
const t = initTRPC.create({ transformer: superjson });

// ── kycOrchestration (mirror of server/routers/kycOrchestration.ts) ───────────

const DocTypeEnum = z.enum([
  "passport",
  "national_id",
  "drivers_license",
  "bvn",
  "nin",
  "utility_bill",
]);

const KYCSubmitInput = z.object({
  docType:        DocTypeEnum,
  docNumber:      z.string().optional(),
  docImageBase64: z.string().optional(),
  docBackBase64:  z.string().optional(),
  selfieBase64:   z.string().optional(),
  firstName:      z.string().min(1).max(100),
  lastName:       z.string().min(1).max(100),
  dateOfBirth:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  nationality:    z.string().length(2, "ISO 3166-1 alpha-2 country code"),
  address:        z.string().optional(),
  runLiveness:    z.boolean().default(true),
  runVLM:         z.boolean().default(true),
  runBiometric:   z.boolean().default(true),
  runAML:         z.boolean().default(true),
  transferAmount: z.number().optional(),
});

const ChallengeCreateInput = z.object({
  numChallenges: z.number().int().min(1).max(4).default(2),
});

// ── operationsMap (mirror of server/routers/operationsMap.ts) ─────────────────

const locationStatusSchema = z.enum(["active", "degraded", "inactive", "investigating"]);

const OverviewInput = z.object({
  includeIncidents: z.boolean().default(false),
  statuses: z.array(locationStatusSchema).max(4).optional(),
}).optional();

// ── Contract router ───────────────────────────────────────────────────────────
// The resolvers below are never executed: only `typeof appRouterContract` is
// exported (type-only import), so the entire module is elided from the bundle.

const neverRuns = (): never => {
  throw new Error("PWA tRPC contract is type-only and must never be invoked");
};

export const appRouterContract = t.router({
  kycOrchestration: t.router({
    submit: t.procedure.input(KYCSubmitInput).mutation(neverRuns),
    createChallenge: t.procedure.input(ChallengeCreateInput).mutation(neverRuns),
  }),
  operationsMap: t.router({
    overview: t.procedure.input(OverviewInput).query(neverRuns),
  }),
});

export type AppRouter = typeof appRouterContract;
