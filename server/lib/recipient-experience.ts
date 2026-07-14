import { router, publicProcedure } from "../_core/trpc";

export const recipientExperienceRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
