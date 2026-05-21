/**
 * Error tracking integration — Sentry SDK wrapper.
 * P0 Security 5.1 / P0 Observability 7.1
 *
 * Provides unified error capture for both server and client.
 * Configure via SENTRY_DSN environment variable.
 */

interface ErrorContext {
  userId?: number | string;
  action?: string;
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
}

interface BreadcrumbData {
  category: string;
  message: string;
  data?: Record<string, unknown>;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
}

const breadcrumbs: BreadcrumbData[] = [];
const MAX_BREADCRUMBS = 100;
const capturedErrors: Array<{ error: Error; context: ErrorContext; timestamp: string }> = [];

let initialized = false;
let dsn: string | undefined;
let environment: string;
let release: string;

export function initErrorTracking(config?: {
  dsn?: string;
  environment?: string;
  release?: string;
  sampleRate?: number;
  tracesSampleRate?: number;
}): void {
  dsn = config?.dsn ?? process.env.SENTRY_DSN;
  environment = config?.environment ?? process.env.NODE_ENV ?? "development";
  release = config?.release ?? process.env.APP_VERSION ?? "unknown";

  if (!dsn) {
    console.warn("[ErrorTracking] SENTRY_DSN not set — errors captured locally only");
  }

  initialized = true;
}

export function captureException(error: Error, context: ErrorContext = {}): string {
  const eventId = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  capturedErrors.push({
    error,
    context: { ...context, tags: { ...context.tags, environment, release } },
    timestamp: new Date().toISOString(),
  });

  if (capturedErrors.length > 1000) {
    capturedErrors.splice(0, capturedErrors.length - 500);
  }

  if (dsn) {
    sendToSentry(error, context, eventId).catch(() => {});
  }

  return eventId;
}

export function captureMessage(message: string, context: ErrorContext = {}): string {
  return captureException(new Error(message), { ...context, level: context.level ?? "info" });
}

export function addBreadcrumb(crumb: BreadcrumbData): void {
  breadcrumbs.push({ ...crumb, level: crumb.level ?? "info" });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

export function setUserContext(user: { id: string | number; email?: string; name?: string }): void {
  addBreadcrumb({ category: "user", message: `Set user: ${user.id}` });
}

export function getRecentErrors(limit = 50): typeof capturedErrors {
  return capturedErrors.slice(-limit);
}

export function getErrorStats(): {
  total: number;
  lastHour: number;
  topErrors: Array<{ message: string; count: number }>;
} {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const lastHour = capturedErrors.filter((e) => e.timestamp > hourAgo).length;

  const counts = new Map<string, number>();
  for (const e of capturedErrors.slice(-500)) {
    const msg = e.error.message.slice(0, 100);
    counts.set(msg, (counts.get(msg) ?? 0) + 1);
  }

  const topErrors = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  return { total: capturedErrors.length, lastHour, topErrors };
}

async function sendToSentry(error: Error, context: ErrorContext, eventId: string): Promise<void> {
  if (!dsn) return;

  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace("/", "");
    const publicKey = url.username;
    const endpoint = `${url.protocol}//${url.host}/api/${projectId}/store/`;

    const payload = {
      event_id: eventId.replace(/[^a-f0-9]/g, "").slice(0, 32).padEnd(32, "0"),
      timestamp: new Date().toISOString(),
      platform: "node",
      level: context.level ?? "error",
      environment,
      release,
      exception: {
        values: [
          {
            type: error.name,
            value: error.message,
            stacktrace: { frames: parseStack(error.stack ?? "") },
          },
        ],
      },
      tags: context.tags ?? {},
      extra: context.extra ?? {},
      user: context.userId ? { id: String(context.userId) } : undefined,
      breadcrumbs: { values: breadcrumbs.slice(-20) },
    };

    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=remitflow/1.0`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Silently fail — don't let error tracking errors crash the app
  }
}

function parseStack(stack: string): Array<{ filename: string; lineno: number; function: string }> {
  return stack
    .split("\n")
    .slice(1, 11)
    .map((line) => {
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
      if (match) {
        return { function: match[1], filename: match[2], lineno: parseInt(match[3], 10) };
      }
      const match2 = line.match(/at\s+(.+?):(\d+):\d+/);
      if (match2) {
        return { function: "<anonymous>", filename: match2[1], lineno: parseInt(match2[2], 10) };
      }
      return { function: "<unknown>", filename: "<unknown>", lineno: 0 };
    });
}

export function createTrpcErrorHandler() {
  return function onError({ error, path, type }: { error: Error & { code?: string }; path?: string; type: string }) {
    if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") return;

    captureException(error, {
      action: `trpc.${type}.${path ?? "unknown"}`,
      tags: { trpc_path: path ?? "unknown", trpc_type: type },
      level: error.code === "BAD_REQUEST" ? "warning" : "error",
    });
  };
}
