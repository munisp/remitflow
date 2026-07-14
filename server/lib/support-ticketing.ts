import { router, publicProcedure } from "../_core/trpc";

export const supportTicketingRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
