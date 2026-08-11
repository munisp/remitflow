import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
// Type-only edge: pulls in the Express.Request `remitflowUser` augmentation
// declared by the trusted-principal middleware so this file type-checks in
// program scopes (e.g. the PWA tsconfig) that never compile the middleware.
import type {} from "../middleware/trustedPrincipal";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = (opts.req as Express.Request).remitflowUser ?? null;

  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
