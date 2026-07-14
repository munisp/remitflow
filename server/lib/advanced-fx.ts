import { router, publicProcedure } from "../_core/trpc";

export const advancedFxRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
