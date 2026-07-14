import { router, publicProcedure } from "../_core/trpc";

export const quickWinsRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
