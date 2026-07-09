import { NextFunction, Request, Response } from "express";
import logger from "../config/logger.config";

export const asyncHandler =
  <T>(fn: (req: Request, res: Response<T>, next: NextFunction) => Promise<Response<T> | undefined>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch((err: any) => {
      logger.error("[asyncHandler] Request handler error", {
        url: req.url,
        method: req.method,
        errorMessage: err?.message,
        errorCode: err?.code,
        errorStatus: err?.status,
        errorResponse: err?.response,
        fullError: JSON.stringify(err, Object.getOwnPropertyNames(err)),
        stack: err?.stack,
      });
      next(err);
    });
