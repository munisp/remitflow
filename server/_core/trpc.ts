import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { resolveTenantContext, type TenantContext } from "../tenantMiddleware";
import { runWithTenantContext, getRequestTenantContext } from "./tenantGuc";
import { setTenantSpanAttributes, recordTenantRequest } from "../telemetry/tenantContext";
import { logger } from "./logger";

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

// ── Tenant enrichment middleware (W11-C2: per-tenant OTel) ────────────────────
// Stamps tenant.id + enduser.id onto the ACTIVE span (the trpc.* span opened
// by tracingMiddleware above) and records remitflow_requests_total /
// remitflow_request_duration_ms with a tenant.id attribute.
//
// HOT-PATH SAFETY — the tenant is resolved AT MOST ONCE per request:
//   1. If tenantGucMiddleware already ran (protected/admin chains), the tenant
//      id is read for free from the request AsyncLocalStorage (tenantGuc.ts).
//   2. Otherwise it is cached on the request-scoped ctx object under
//      OTEL_TENANT_CTX_KEY so repeated middleware/procedure access never
//      re-queries; resolveTenantContext itself is also LRU-cached (60s TTL)
//      in tenantMiddleware.ts, so even a cold ctx costs at most one lookup.
// Fail-soft: telemetry errors never abort the request. No user (public
// routes) → tenant resolution skipped silently, attributes omitted (honest).
const OTEL_TENANT_CTX_KEY = "__otelTenantContext" as const;

type OtelTenantCarrier = { [OTEL_TENANT_CTX_KEY]?: TenantContext | null };

const tenantEnrichmentMiddleware = t.middleware(async opts => {
  const { ctx, next, path, type } = opts;
  const start = Date.now();
  let tenantId: string | null = null;

  try {
    if (ctx.user) {
      // (1) Free path: tenantGucMiddleware already resolved the tenant this request.
      const fromGuc = getRequestTenantContext();
      if (fromGuc) {
        tenantId = fromGuc.tenantId;
      } else {
        // (2) Per-request cache on ctx; resolve once, then reuse.
        const carrier = ctx as unknown as OtelTenantCarrier;
        let tenant = carrier[OTEL_TENANT_CTX_KEY];
        if (tenant === undefined) {
          try {
            tenant = await resolveTenantContext(ctx.user.id);
          } catch {
            tenant = null; // fail-soft: enrichment must never break the request
          }
          carrier[OTEL_TENANT_CTX_KEY] = tenant;
        }
        tenantId = tenant?.tenantId != null ? String(tenant.tenantId) : null;
      }
      setTenantSpanAttributes(tenantId, ctx.user.id);
    }
    // No user → public route: skip silently, no tenant attribute emitted.
  } catch (err) {
    // Belt-and-braces: enrichment must never throw into the procedure chain.
    logger.debug({ err }, "[telemetry] tenantEnrichmentMiddleware failed — skipped");
  }

  let ok = true;
  try {
    return await next();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    recordTenantRequest({ path, type, durationMs: Date.now() - start, ok, tenantId });
  }
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(tracingMiddleware).use(tenantEnrichmentMiddleware);

// ── Auth middleware ───────────────────────────────────────────────────────────

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ── Tenant GUC middleware (RLS, audit PG4) ────────────────────────────────────
// Resolves the caller's tenant once per request and binds it to the
// AsyncLocalStorage request context (server/_core/tenantGuc.ts). Every
// request-scoped DB transaction picks the context up via applyTenantGuc() and
// sets app.current_tenant_id / app.current_user_id so RLS policies apply.
// FAILS CLOSED: a tenant-resolution error aborts the request — we never run
// queries with unknown tenant isolation.
const tenantGucMiddleware = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) return next();
  let tenantId: number | null;
  try {
    const tenant = await resolveTenantContext(ctx.user.id);
    tenantId = tenant.tenantId;
  } catch (err) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Tenant context resolution failed — request refused (fail-closed)",
      cause: err,
    });
  }
  return runWithTenantContext(
    { tenantId: tenantId == null ? null : String(tenantId), userId: String(ctx.user.id) },
    () => next(),
  );
});

// W11-FIX-TS: tracingMiddleware is FIRST so the whole chain (auth → tenant GUC
// → enrichment → procedure) executes inside the trpc.* span — tenant enrichment
// previously no-opped here because no active span existed. This WRAPS the chain
// only: requireUser/admin-check → tenantGucMiddleware ordering and auth
// semantics are unchanged (tenantGucMiddleware still runs exactly where it ran).
export const protectedProcedure = t.procedure
  .use(tracingMiddleware)
  .use(requireUser)
  .use(tenantGucMiddleware)
  .use(tenantEnrichmentMiddleware);

export const adminProcedure = t.procedure
  .use(tracingMiddleware)
  .use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user || ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }
      return next({ ctx: { ...ctx, user: ctx.user } });
    }),
  )
  .use(tenantGucMiddleware)
  .use(tenantEnrichmentMiddleware);

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

// W12-F: audited/rate-limited chains previously omitted tracingMiddleware +
// tenantEnrichmentMiddleware, so these procedures ran with NO trpc.* span and
// NO tenant.id telemetry. Both are now composed in with the same ordering as
// protectedProcedure (:150-154): tracing FIRST (wraps the whole chain),
// tenant enrichment BEFORE the audit/rate-limit middlewares so their sidecar
// calls also inherit span + tenant context. Auth → tenantGuc ordering and
// audit/rate-limit semantics are unchanged.
/** Protected procedure + automatic Rust audit log on every call */
export const auditedProcedure = t.procedure
  .use(tracingMiddleware)
  .use(requireUser)
  .use(tenantGucMiddleware)
  .use(tenantEnrichmentMiddleware)
  .use(auditMiddleware);

/** Admin procedure + automatic Rust audit log on every call */
export const auditedAdminProcedure = t.procedure
  .use(tracingMiddleware)
  .use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user || ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }
      return next({ ctx: { ...ctx, user: ctx.user } });
    }),
  )
  .use(tenantGucMiddleware)
  .use(tenantEnrichmentMiddleware)
  .use(auditMiddleware);

// ── Rate-limit middleware ─────────────────────────────────────────────────────
// Uses the Go sidecar for sliding-window rate limiting.
// SEC (MEDIUM): previously failed OPEN when the sidecar was unreachable —
// exactly when TOTP brute force / beneficiary-swap abuse become viable.
// Now fails CLOSED into a low in-process sliding-window limit.

const _inProcessRateBuckets = new Map<string, number[]>();

function inProcessRateLimit(key: string, limit: number, windowSecs: number): boolean {
  const now = Date.now();
  const windowMs = windowSecs * 1000;
  const hits = (_inProcessRateBuckets.get(key) ?? []).filter(t => now - t < windowMs);
  if (hits.length >= limit) {
    _inProcessRateBuckets.set(key, hits);
    return false;
  }
  hits.push(now);
  _inProcessRateBuckets.set(key, hits);
  if (_inProcessRateBuckets.size > 10_000) {
    for (const [k, v] of _inProcessRateBuckets) {
      if (v.every(t => now - t >= windowMs)) _inProcessRateBuckets.delete(k);
    }
  }
  return true;
}

function makeRateLimitMiddleware(limit: number, windowSecs: number) {
  return t.middleware(async opts => {
    const { ctx, next, path } = opts;
    if (ctx.user) {
      const key = `trpc:${path}:user:${ctx.user.id}`;
      const result = await import("./polyglotClient")
        .then(({ checkRateLimit }) => checkRateLimit(key, limit, windowSecs))
        .catch(() => null);
      if (result === null) {
        // Sidecar unavailable — fail closed into an in-process sliding window
        // capped at 5 req/min for strict endpoints (configured limit otherwise).
        const fallbackLimit = Math.min(limit, 5);
        if (!inProcessRateLimit(key, fallbackLimit, windowSecs)) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Rate limit exceeded for ${path} (degraded mode). Retry in ${windowSecs}s.`,
          });
        }
        return next();
      }
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
  .use(tracingMiddleware)
  .use(requireUser)
  .use(tenantGucMiddleware)
  .use(tenantEnrichmentMiddleware)
  .use(auditMiddleware)
  .use(makeRateLimitMiddleware(60, 60));

/** Protected + audited + strict rate-limited (10 req/min — for sensitive ops) */
export const strictRateLimitedProcedure = t.procedure
  .use(tracingMiddleware)
  .use(requireUser)
  .use(tenantGucMiddleware)
  .use(tenantEnrichmentMiddleware)
  .use(auditMiddleware)
  .use(makeRateLimitMiddleware(10, 60));
