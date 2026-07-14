import { router, publicProcedure } from "../_core/trpc";

export const nudgeEngineRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
