/**
 * RemitFlow — Structured Logger (Pino)
 * Provides structured JSON logging with request ID tracing.
 *
 * The exported `logger` is a thin wrapper around Pino that accepts both:
 *   logger.error("message:", value)          ← legacy pattern (string, any)
 *   logger.error({ key: value }, "message")  ← Pino canonical pattern
 * This avoids TS2769 overload errors across the codebase.
 */
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

// ─── Internal Pino instance ───────────────────────────────────────────────────
const _pino = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: "remitflow-api",
    version: process.env.npm_package_version || "1.0.0",
    env: process.env.NODE_ENV || "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
    redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.p256dhKey",
      "*.authKey",
      // PII fields
      "*.email",
      "*.phone",
      "*.phoneNumber",
      "*.phone_number",
      "*.accountNumber",
      "*.account_number",
      "*.routingNumber",
      "*.routing_number",
      "*.cardNumber",
      "*.card_number",
      "*.cvv",
      "*.ssn",
      "*.dateOfBirth",
      "*.date_of_birth",
      "res.headers['set-cookie']",
    ],
    censor: "[REDACTED]",
  },
});

// ─── Flexible logger wrapper ──────────────────────────────────────────────────
// Accepts both (string, ...any[]) and (object, string, ...any[]) signatures.
type LogFn = (msgOrObj: string | Record<string, unknown>, ...args: unknown[]) => void;

function makeLogFn(pinoFn: (obj: Record<string, unknown>, msg: string, ...args: unknown[]) => void): LogFn {
  return (msgOrObj, ...args) => {
    if (typeof msgOrObj === "string") {
      // Legacy: logger.error("message:", value) → wrap extra args into obj
      const extra = args.length > 0 ? { err: args[0], args: args.slice(1) } : {};
      pinoFn(extra, msgOrObj);
    } else {
      // Canonical: logger.error({ key: val }, "message")
      const msg = typeof args[0] === "string" ? (args.shift() as string) : "";
      pinoFn(msgOrObj, msg, ...args);
    }
  };
}

export const logger = {
  fatal: makeLogFn(_pino.fatal.bind(_pino) as any),
  error: makeLogFn(_pino.error.bind(_pino) as any),
  warn:  makeLogFn(_pino.warn.bind(_pino) as any),
  info:  makeLogFn(_pino.info.bind(_pino) as any),
  debug: makeLogFn(_pino.debug.bind(_pino) as any),
  trace: makeLogFn(_pino.trace.bind(_pino) as any),
  child: (bindings: Record<string, unknown>) => {
    const child = _pino.child(bindings);
    return {
      fatal: makeLogFn(child.fatal.bind(child) as any),
      error: makeLogFn(child.error.bind(child) as any),
      warn:  makeLogFn(child.warn.bind(child) as any),
      info:  makeLogFn(child.info.bind(child) as any),
      debug: makeLogFn(child.debug.bind(child) as any),
      trace: makeLogFn(child.trace.bind(child) as any),
      child: (b: Record<string, unknown>) => child.child(b),
    };
  },
};

/** Child logger with request context */
export function requestLogger(requestId: string, userId?: number | string) {
  return logger.child({ requestId, userId });
}

/** Log security events */
export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>,
  severity: "low" | "medium" | "high" | "critical" = "medium"
) {
  logger.warn({ event, severity, ...details }, `[SECURITY] ${event}`);
}

/** Log audit events */
export function logAuditEvent(
  action: string,
  userId: number | string,
  details: Record<string, unknown>
) {
  logger.info({ action, userId, ...details }, `[AUDIT] ${action}`);
}

/** Log performance metrics */
export function logPerformance(
  operation: string,
  durationMs: number,
  details?: Record<string, unknown>
) {
  const level = durationMs > 1000 ? "warn" : "debug";
  logger[level]({ operation, durationMs, ...details }, `[PERF] ${operation} took ${durationMs}ms`);
}

export default logger;

// ─── Domain-specific child loggers ───────────────────────────────────────────
export const dbLogger = logger.child({ component: "database" });
export const authLogger = logger.child({ component: "auth" });
export const amlLogger = logger.child({ component: "aml" });
export const tbLogger = logger.child({ component: "tigerbeetle" });
export const temporalLogger = logger.child({ component: "temporal" });
export const fluvioLogger = logger.child({ component: "fluvio" });
export const daprLogger = logger.child({ component: "dapr" });
export const permifyLogger = logger.child({ component: "permify" });
export const redisLogger = logger.child({ component: "redis" });
export const httpLogger = logger.child({ component: "http" });

// ─── Request Context (AsyncLocalStorage) ─────────────────────────────────────
import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  requestId: string;
  userId?: number;
  sessionId?: string;
}

const _requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return _requestContextStorage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return _requestContextStorage.getStore();
}

export function getContextLogger(extra?: Record<string, unknown>) {
  const ctx = _requestContextStorage.getStore();
  return logger.child({ ...ctx, ...extra });
}
