import { router, publicProcedure } from "../_core/trpc";

export const microInsuranceRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
