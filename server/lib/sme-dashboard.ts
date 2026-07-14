import { router, publicProcedure } from "../_core/trpc";

export const smeDashboardRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
