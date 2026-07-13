/**
 * server/trpc.ts — compatibility shim
 *
 * Several routers import from "../trpc" (relative to server/routers/).
 * The canonical tRPC setup lives in server/_core/trpc.ts.
 * This file re-exports everything so both import paths resolve correctly.
 */
export * from "./_core/trpc";

// createTRPCRouter is an alias for `router` used in some newer routers
export { router as createTRPCRouter } from "./_core/trpc";
