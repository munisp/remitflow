import type { NextFunction, Request, Response } from "express";
import type { User } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";

declare global {
  namespace Express {
    interface Request {
      remitflowUser?: User;
    }
  }
}

/**
 * Resolves a request identity only through the verified session path. It does
 * not reject unauthenticated calls because public tRPC procedures remain
 * supported; callers without a verified principal are rate-limited by IP.
 */
export async function attachTrustedPrincipal(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.remitflowUser = await sdk.authenticateRequest(req);
  } catch {
    req.remitflowUser = undefined;
  }
  next();
}
