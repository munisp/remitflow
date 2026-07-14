import { router, publicProcedure } from "../_core/trpc";

export const ROUTER_NAME = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
});
