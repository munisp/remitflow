import { router, publicProcedure } from "../_core/trpc";

export const agentIntelligenceRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
