/**
 * errorTracking.ts — Sentry SDK initialization for PWA + error boundaries
 *
 * Features:
 * - Sentry SDK for crash reporting and performance monitoring
 * - Custom breadcrumbs for financial transactions
 * - Session replay for debugging complex flows
 * - Source maps upload for readable stack traces
 * - User context attachment (anonymized)
 * - Performance tracing with custom spans
 */

// Sentry initialization
export interface ErrorTrackingConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
}

const DEFAULT_CONFIG: ErrorTrackingConfig = {
  dsn: process.env.REACT_APP_SENTRY_DSN || "",
  environment: process.env.NODE_ENV || "development",
  release: process.env.REACT_APP_VERSION || "0.0.0",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,
};

let sentryInitialized = false;
let Sentry: any = null;

export async function initErrorTracking(config: Partial<ErrorTrackingConfig> = {}): Promise<void> {
  if (sentryInitialized) return;

  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  if (!finalConfig.dsn) {
    console.warn("[ErrorTracking] No Sentry DSN configured — error tracking disabled");
    return;
  }

  try {
    Sentry = await import("@sentry/react");
    const { BrowserTracing } = await import("@sentry/tracing");

    Sentry.init({
      dsn: finalConfig.dsn,
      environment: finalConfig.environment,
      release: finalConfig.release,
      integrations: [
        new BrowserTracing({
          tracePropagationTargets: [
            "localhost",
            /^https:\/\/api\.remitflow\.com/,
            /^https:\/\/app\.remitflow\.com/,
          ],
          routingInstrumentation: Sentry.reactRouterV6Instrumentation,
        }),
        new Sentry.Replay({
          maskAllText: true, // PII protection
          blockAllMedia: false,
          networkDetailAllowUrls: [/\/api\/trpc\//],
        }),
      ],
      tracesSampleRate: finalConfig.tracesSampleRate,
      replaysSessionSampleRate: finalConfig.replaysSessionSampleRate,
      replaysOnErrorSampleRate: finalConfig.replaysOnErrorSampleRate,

      // Don't send PII
      beforeSend(event: any) {
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
        }
        return event;
      },

      // Custom breadcrumb filtering
      beforeBreadcrumb(breadcrumb: any) {
        // Filter out noisy console.log breadcrumbs
        if (breadcrumb.category === "console" && breadcrumb.level === "log") {
          return null;
        }
        return breadcrumb;
      },

      // Ignore known non-actionable errors
      ignoreErrors: [
        "ResizeObserver loop",
        "Network request failed",
        "AbortError",
        "cancelled",
        "user denied",
      ],
    });

    sentryInitialized = true;
  } catch (err) {
    console.error("[ErrorTracking] Failed to initialize Sentry:", err);
  }
}

// Set user context (anonymized)
export function setUser(userId: string, kycTier?: string): void {
  if (!Sentry) return;
  Sentry.setUser({
    id: userId, // Use internal ID, not PII
    segment: kycTier || "unknown",
  });
}

// Clear user on logout
export function clearUser(): void {
  if (!Sentry) return;
  Sentry.setUser(null);
}

// Custom breadcrumb for financial operations
export function addTransactionBreadcrumb(
  action: "initiate" | "confirm" | "complete" | "fail",
  data: { transferId?: string; corridor?: string; amount?: number; currency?: string }
): void {
  if (!Sentry) return;
  Sentry.addBreadcrumb({
    category: "transaction",
    message: `Transfer ${action}`,
    level: action === "fail" ? "error" : "info",
    data: {
      transferId: data.transferId,
      corridor: data.corridor,
      amountRange: data.amount ? getAmountRange(data.amount) : undefined, // Don't log exact amounts
      currency: data.currency,
    },
  });
}

// Performance span for custom operations
export function startSpan(name: string, op: string): any {
  if (!Sentry) return { finish: () => {} };
  const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
  if (transaction) {
    return transaction.startChild({ op, description: name });
  }
  return { finish: () => {} };
}

// Capture exception with context
export function captureException(error: Error, context?: Record<string, any>): void {
  if (!Sentry) {
    console.error("[ErrorTracking]", error, context);
    return;
  }
  Sentry.withScope((scope: any) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    Sentry.captureException(error);
  });
}

// Capture message
export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (!Sentry) return;
  Sentry.captureMessage(message, level);
}

// Helper: bucket amounts into ranges for privacy
function getAmountRange(amount: number): string {
  if (amount < 10) return "<10";
  if (amount < 100) return "10-100";
  if (amount < 1000) return "100-1K";
  if (amount < 10000) return "1K-10K";
  return "10K+";
}

// Web Vitals reporting
export function reportWebVitals(): void {
  if (typeof window === "undefined") return;

  try {
    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const metric = entry as any;
        if (Sentry) {
          Sentry.addBreadcrumb({
            category: "web-vitals",
            message: `${entry.name}: ${metric.value?.toFixed(2) || entry.duration?.toFixed(2)}`,
            level: "info",
            data: {
              name: entry.name,
              value: metric.value || entry.duration,
              rating: metric.rating,
            },
          });
        }
      }
    });

    observer.observe({ type: "largest-contentful-paint", buffered: true });
    observer.observe({ type: "first-input", buffered: true });
    observer.observe({ type: "layout-shift", buffered: true });
  } catch {
    // PerformanceObserver not supported
  }
}
