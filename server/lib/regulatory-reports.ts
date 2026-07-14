import { router, publicProcedure } from "../_core/trpc";

export const regulatoryReportsRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
