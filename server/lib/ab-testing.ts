import { router, publicProcedure } from "../_core/trpc";

export const abTestingRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
