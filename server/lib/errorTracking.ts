/**
 * Sentry Error Tracking Integration — P0
 *
 * Provides runtime bug visibility:
 *   - Unhandled exceptions + promise rejections
 *   - tRPC error capture with context
 *   - Express middleware for request context
 *   - Performance monitoring (transactions/spans)
 *   - User context enrichment
 *   - Environment-aware sampling
 *
 * Setup: Set SENTRY_DSN environment variable.
 * Docs: https://docs.sentry.io/platforms/node/
 */
import { logger } from "../_core/logger";

// ── Sentry-compatible error reporting interface ───────────────────────────────
// This works with or without @sentry/node installed. When SENTRY_DSN is set
// and the SDK is available, errors go to Sentry. Otherwise, they're logged locally.

interface ErrorContext {
  userId?: string | number;
  tenantId?: string | number;
  endpoint?: string;
  traceId?: string;
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  level?: "fatal" | "error" | "warning" | "info";
}

interface BreadcrumbData {
  category: string;
  message: string;
  level?: "info" | "warning" | "error";
  data?: Record<string, unknown>;
}

let _sentry: any = null;
let _initialized = false;

// Local error buffer for getRecentErrors / getErrorStats
interface TrackedError {
  id: string;
  message: string;
  timestamp: number;
  context?: ErrorContext;
}
const recentErrors: TrackedError[] = [];
const MAX_RECENT_ERRORS = 100;
let errorIdCounter = 0;

function generateEventId(): string {
  errorIdCounter++;
  return `evt_${Date.now().toString(36)}_${errorIdCounter}`;
}

/**
 * Initialize error tracking. Call once at server startup.
 */
export async function initErrorTracking(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("[ErrorTracking] No SENTRY_DSN set — using local logging only");
    _initialized = true;
    return;
  }

  try {
    // Dynamic import so @sentry/node is optional
    // @ts-ignore — optional dependency, may not be installed
    _sentry = await import("@sentry/node").catch(() => null);
    if (!_sentry) {
      logger.warn("[ErrorTracking] @sentry/node not installed — using local logging");
      _initialized = true;
      return;
    }

    _sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      release: process.env.APP_VERSION || "unknown",
      sampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0.1,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
      integrations: [
        // Auto-instrument HTTP, DB, etc.
      ],
      beforeSend(event: any) {
        // Scrub PII from events
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        return event;
      },
    });

    _initialized = true;
    logger.info("[ErrorTracking] Sentry initialized");
  } catch (err) {
    logger.warn("[ErrorTracking] Sentry init failed:", (err as Error).message);
    _initialized = true;
  }
}

/**
 * Capture an error with optional context.
 */
export function captureError(error: Error | string, context?: ErrorContext): void {
  const err = typeof error === "string" ? new Error(error) : error;

  // Always log locally
  logger.error({
    err,
    userId: context?.userId,
    tenantId: context?.tenantId,
    endpoint: context?.endpoint,
  }, `[ErrorTracking] ${err.message}`);

  if (_sentry && _initialized) {
    _sentry.withScope((scope: any) => {
      if (context?.userId) scope.setUser({ id: String(context.userId) });
      if (context?.tenantId) scope.setTag("tenantId", String(context.tenantId));
      if (context?.endpoint) scope.setTag("endpoint", context.endpoint);
      if (context?.traceId) scope.setTag("traceId", context.traceId);
      if (context?.tags) {
        Object.entries(context.tags).forEach(([k, v]) => scope.setTag(k, v));
      }
      if (context?.extra) scope.setExtras(context.extra);
      if (context?.level) scope.setLevel(context.level);
      _sentry.captureException(err);
    });
  }
}

/**
 * Capture a warning-level message.
 */
export function captureWarning(message: string, context?: ErrorContext): void {
  logger.warn({ ...context }, `[ErrorTracking] ${message}`);

  if (_sentry && _initialized) {
    _sentry.withScope((scope: any) => {
      scope.setLevel("warning");
      if (context?.userId) scope.setUser({ id: String(context.userId) });
      if (context?.tags) {
        Object.entries(context.tags).forEach(([k, v]) => scope.setTag(k, v));
      }
      _sentry.captureMessage(message);
    });
  }
}

/**
 * Add a breadcrumb for debugging context.
 */
export function addBreadcrumb(data: BreadcrumbData): void {
  if (_sentry && _initialized) {
    _sentry.addBreadcrumb({
      category: data.category,
      message: data.message,
      level: data.level || "info",
      data: data.data,
      timestamp: Date.now() / 1000,
    });
  }
}

/**
 * Express middleware: capture unhandled errors with request context.
 */
export function errorTrackingMiddleware() {
  return (err: Error, req: any, res: any, next: any) => {
    captureError(err, {
      userId: req.user?.id,
      tenantId: req.user?.tenantId,
      endpoint: `${req.method} ${req.path}`,
      traceId: req.headers["x-trace-id"] || req.headers["x-request-id"],
      extra: {
        query: req.query,
        params: req.params,
        statusCode: res.statusCode,
      },
    });
    next(err);
  };
}

/**
 * tRPC error handler: capture procedure errors with context.
 */
export function captureTRPCError(error: Error, opts: {
  path?: string;
  type?: string;
  userId?: number;
  input?: unknown;
}): void {
  captureError(error, {
    endpoint: opts.path ? `tRPC:${opts.path}` : undefined,
    userId: opts.userId,
    tags: { type: opts.type || "unknown" },
    extra: { input: opts.input },
  });
}

/**
 * Global unhandled rejection/exception handlers.
 */
export function installGlobalHandlers(): void {
  process.on("uncaughtException", (err) => {
    captureError(err, { level: "fatal", tags: { handler: "uncaughtException" } });
    logger.fatal({ err }, "[FATAL] Uncaught exception");
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureError(err, { level: "error", tags: { handler: "unhandledRejection" } });
    logger.error({ err }, "[ERROR] Unhandled rejection");
  });
}

/**
 * Flush pending events before shutdown.
 */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (_sentry && _initialized) {
    try {
      await _sentry.close(timeoutMs);
    } catch { /* best effort */ }
  }
}

// ─── Compatibility exports for test suite ─────────────────────────────────────

/**
 * Capture an exception with optional context. Returns event ID.
 */
export function captureException(error: Error, context?: Record<string, unknown>): string {
  const eventId = generateEventId();
  const tracked: TrackedError = {
    id: eventId,
    message: error.message,
    timestamp: Date.now(),
    context: context as ErrorContext,
  };
  recentErrors.unshift(tracked);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.pop();
  captureError(error, context as ErrorContext);
  return eventId;
}

/**
 * Capture a message-level event. Returns event ID.
 */
export function captureMessage(message: string, context?: Record<string, unknown>): string {
  const eventId = generateEventId();
  const tracked: TrackedError = {
    id: eventId,
    message,
    timestamp: Date.now(),
    context: context as ErrorContext,
  };
  recentErrors.unshift(tracked);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.pop();
  captureWarning(message, context as ErrorContext);
  return eventId;
}

/**
 * Get recent captured errors.
 */
export function getRecentErrors(limit = 10): TrackedError[] {
  return recentErrors.slice(0, limit);
}

/**
 * Get error statistics.
 */
export function getErrorStats(): { total: number; lastHour: number; topErrors: Array<{ message: string; count: number }> } {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const lastHour = recentErrors.filter((e) => e.timestamp > hourAgo).length;

  const counts = new Map<string, number>();
  for (const e of recentErrors) {
    counts.set(e.message, (counts.get(e.message) || 0) + 1);
  }
  const topErrors = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));

  return { total: recentErrors.length, lastHour, topErrors };
}

/**
 * Create a tRPC-compatible error handler function.
 */
export function createTrpcErrorHandler(): (opts: { error: Error; path?: string; type?: string; ctx?: any }) => void {
  return (opts) => {
    captureTRPCError(opts.error, {
      path: opts.path,
      type: opts.type,
      userId: opts.ctx?.user?.id,
    });
  };
}
