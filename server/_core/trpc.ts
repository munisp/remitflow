import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const trpcTracer = trace.getTracer("remitflow-trpc", "2.0.0");

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

// ── OpenTelemetry tracing middleware ──────────────────────────────────────────
const tracingMiddleware = t.middleware(async (opts) => {
  const { path, type, next, ctx } = opts;
  return trpcTracer.startActiveSpan(`trpc.${type}.${path}`, async (span) => {
    span.setAttribute("rpc.system", "trpc");
    span.setAttribute("rpc.method", path);
    span.setAttribute("rpc.type", type);
    if (ctx.user) {
      span.setAttribute("user.id", ctx.user.id);
      span.setAttribute("user.role", String(ctx.user.role ?? "unknown"));
    }
    try {
      const result = await next();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
});

export const router = t.router;
export const publicProcedure = t.procedure.use(tracingMiddleware);

// ── Auth middleware ───────────────────────────────────────────────────────────

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);

// ── Audit middleware ──────────────────────────────────────────────────────────
// Wraps a protected procedure and automatically sends a fire-and-forget
// audit event to the Rust audit-log service after every mutation/query.

const auditMiddleware = t.middleware(async opts => {
  const { ctx, next, path, type } = opts;
  const start = Date.now();
  let success = true;
  let errorMessage: string | undefined;

  try {
    const result = await next();
    return result;
  } catch (err: any) {
    success = false;
    errorMessage = err?.message ?? "Unknown error";
    throw err;
  } finally {
    // Fire-and-forget — never block the response
    if (ctx.user) {
      import("./polyglotClient")
        .then(({ sendAuditLog }) =>
          sendAuditLog({
            userId: ctx.user!.id,
            action: `${type.toUpperCase()}:${path}`,
            resource: path.split(".")[0],
            resourceId: undefined,
            ipAddress: (ctx.req as any)?.ip ?? undefined,
            severity: success ? "info" : "warning",
            success,
            errorMessage,
            details: { durationMs: Date.now() - start },
          })
        )
        .catch(() => {});
    }
  }
});

/** Protected procedure + automatic Rust audit log on every call */
export const auditedProcedure = t.procedure.use(requireUser).use(auditMiddleware);

/** Admin procedure + automatic Rust audit log on every call */
export const auditedAdminProcedure = t.procedure
  .use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user || ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }
      return next({ ctx: { ...ctx, user: ctx.user } });
    }),
  )
  .use(auditMiddleware);

// ── Rate-limit middleware ─────────────────────────────────────────────────────
// Uses the Go sidecar for sliding-window rate limiting.
// Falls back gracefully if the sidecar is unavailable.

function makeRateLimitMiddleware(limit: number, windowSecs: number) {
  return t.middleware(async opts => {
    const { ctx, next, path } = opts;
    if (ctx.user) {
      const key = `trpc:${path}:user:${ctx.user.id}`;
      const result = await import("./polyglotClient")
        .then(({ checkRateLimit }) => checkRateLimit(key, limit, windowSecs))
        .catch(() => ({ allowed: true, remaining: limit, resetAt: "", retryAfterMs: 0 }));
      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded for ${path}. Retry in ${Math.ceil(result.retryAfterMs / 1000)}s.`,
        });
      }
    }
    return next();
  });
}

/** Protected + audited + rate-limited (60 req/min default) */
export const rateLimitedProcedure = t.procedure
  .use(requireUser)
  .use(auditMiddleware)
  .use(makeRateLimitMiddleware(60, 60));

/** Protected + audited + strict rate-limited (10 req/min — for sensitive ops) */
export const strictRateLimitedProcedure = t.procedure
  .use(requireUser)
  .use(auditMiddleware)
  .use(makeRateLimitMiddleware(10, 60));
