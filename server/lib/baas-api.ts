import { router, publicProcedure } from "../_core/trpc";

export const baasApiRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
