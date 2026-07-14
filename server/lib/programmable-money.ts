import { router, publicProcedure } from "../_core/trpc";

export const programmableMoneyRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
