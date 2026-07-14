import { router, publicProcedure } from "../_core/trpc";

export const businessKpiRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
