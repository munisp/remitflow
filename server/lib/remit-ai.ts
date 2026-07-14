import { router, publicProcedure } from "../_core/trpc";

export const remitAiRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
