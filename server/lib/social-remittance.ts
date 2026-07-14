import { router, publicProcedure } from "../_core/trpc";

export const socialRemittanceRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
