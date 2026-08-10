/**
 * Platform Health Service
 * ───────────────────────
 * Aggregates the real, already-deployed health endpoints of the RemitFlow
 * platform into a single snapshot for the Infrastructure Status dashboard:
 *
 *   GET /api/health              → liveness of the API server itself
 *   GET /api/health/detailed     → { checks: { db, fx } } with latency
 *   GET /api/middleware/health   → { systems: { kafka, redis, postgres,
 *                                  temporal, tigerbeetle, permify,
 *                                  opensearch, dapr: boolean } }
 *   GET /api/trpc/health.platform → rich per-integration report (admin
 *                                  session required; attempted only for
 *                                  admin users, merged when available)
 *   GET /api/auth/keycloak/login  → Keycloak reachability probe (SSO)
 *
 * Every component degrades independently: when a signal is absent the
 * component is reported as "unreachable" / "not reported" — never faked.
 */
import { authService } from "./authService";

export type ComponentStatus =
  | "healthy"
  | "degraded"
  | "down"
  | "unreachable";

export interface PlatformComponent {
  id: string;
  name: string;
  description: string;
  critical: boolean;
  status: ComponentStatus;
  latencyMs?: number;
  detail?: string;
  /** Which data source produced this status. */
  source: string;
}

export interface PlatformHealthSnapshot {
  overall: ComponentStatus;
  components: PlatformComponent[];
  api: {
    reachable: boolean;
    version?: string;
    latencyMs?: number;
  };
  checkedAt: string;
  /** Human-readable notes about signals that were unavailable. */
  notes: string[];
}

// ─── Contracts mirrored from the server ─────────────────────────────────────

interface DetailedHealthResponse {
  status: string;
  version?: string;
  timestamp?: string;
  checks?: Record<string, { status: string; latencyMs?: number; error?: string }>;
}

interface MiddlewareHealthResponse {
  status: string;
  timestamp?: string;
  version?: string;
  systems?: Record<string, boolean>;
}

interface PlatformIntegration {
  name: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  latencyMs?: number;
  error?: string;
  critical?: boolean;
}

// ─── Internals ──────────────────────────────────────────────────────────────

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" ? `${window.location.origin}/api` : "/api")
).replace(/\/$/, "");

interface FetchOutcome<T> {
  ok: boolean;
  latencyMs: number;
  data?: T;
  error?: string;
}

async function fetchJson<T>(path: string, timeoutMs = 5000): Promise<FetchOutcome<T>> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
      credentials: "include",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    clearTimeout(timeoutId);
    if (!response.ok && response.status !== 207) {
      return { ok: false, latencyMs, error: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as T;
    return { ok: true, latencyMs, data };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/** Attempt the admin-only tRPC health.platform query via raw HTTP. */
async function fetchPlatformIntegrations(): Promise<PlatformIntegration[] | null> {
  const input = encodeURIComponent(JSON.stringify({ json: null }));
  const outcome = await fetchJson<{
    result?: { data?: { json?: { integrations?: PlatformIntegration[] } } };
  }>(`/trpc/health.platform?input=${input}`, 8000);
  if (!outcome.ok || !outcome.data) return null;
  const integrations = outcome.data.result?.data?.json?.integrations;
  return Array.isArray(integrations) ? integrations : null;
}

function boolToStatus(value: boolean | undefined): ComponentStatus | null {
  if (value === undefined || value === null) return null;
  return value ? "healthy" : "down";
}

function integrationStatusToComponent(
  status: PlatformIntegration["status"],
): ComponentStatus {
  switch (status) {
    case "healthy":
      return "healthy";
    case "degraded":
      return "degraded";
    case "unhealthy":
      return "down";
    default:
      return "unreachable";
  }
}

interface ComponentDef {
  id: string;
  name: string;
  description: string;
  critical: boolean;
  /** Key in the /api/middleware/health `systems` map, when covered. */
  middlewareKey?: string;
  /** Name in the admin health.platform integrations list, when covered. */
  platformName?: string;
}

/**
 * The 13 platform infrastructure components hardened in the backend
 * program, plus Temporal which the middleware probe also reports.
 */
const COMPONENT_DEFS: ComponentDef[] = [
  { id: "postgres", name: "PostgreSQL", description: "Primary relational store", critical: true, middlewareKey: "postgres", platformName: "PostgreSQL" },
  { id: "tigerbeetle", name: "TigerBeetle", description: "Double-entry ledger", critical: true, middlewareKey: "tigerbeetle", platformName: "TigerBeetle" },
  { id: "redis", name: "Redis", description: "Cache, rate limiting & sessions", critical: false, middlewareKey: "redis", platformName: "Redis" },
  { id: "kafka", name: "Kafka", description: "Event streaming backbone", critical: false, middlewareKey: "kafka" },
  { id: "mojaloop", name: "Mojaloop", description: "Interoperable payment switch", critical: true },
  { id: "apisix", name: "APISIX", description: "API gateway", critical: true, platformName: "APISIX" },
  { id: "keycloak", name: "Keycloak", description: "Identity & access management", critical: true, platformName: "Keycloak" },
  { id: "openappsec", name: "open-appsec WAF", description: "Web application firewall", critical: false, platformName: "OpenAppSec" },
  { id: "permify", name: "Permify", description: "Authorization (ReBAC)", critical: true, middlewareKey: "permify", platformName: "Permify" },
  { id: "opensearch", name: "OpenSearch", description: "Search & log analytics", critical: false, middlewareKey: "opensearch" },
  { id: "fluvio", name: "Fluvio", description: "Streaming data platform", critical: false, platformName: "Fluvio" },
  { id: "dapr", name: "Dapr", description: "Distributed application runtime", critical: false, middlewareKey: "dapr", platformName: "Dapr" },
  { id: "lakehouse", name: "Lakehouse", description: "Analytics data platform", critical: false, platformName: "Lakehouse" },
  { id: "temporal", name: "Temporal", description: "Workflow orchestration", critical: false, middlewareKey: "temporal", platformName: "Temporal" },
];

/**
 * Build a full platform health snapshot. Never throws — individual
 * failures are folded into per-component "unreachable" states and notes.
 */
export async function getPlatformHealthSnapshot(options?: {
  /** Pass true for admin users to merge the rich tRPC platform report. */
  includeAdminPlatform?: boolean;
}): Promise<PlatformHealthSnapshot> {
  const notes: string[] = [];

  const [liveness, detailed, middleware, platformIntegrations, keycloakReachable] =
    await Promise.all([
      fetchJson<{ status: string; version?: string; timestamp?: string }>("/health"),
      fetchJson<DetailedHealthResponse>("/health/detailed"),
      fetchJson<MiddlewareHealthResponse>("/middleware/health"),
      options?.includeAdminPlatform
        ? fetchPlatformIntegrations()
        : Promise.resolve(null),
      // Keycloak reachability probe: a successful PKCE initiation handshake
      // proves the identity layer is serving authorization requests.
      authService.probeKeycloakSso().catch(() => false),
    ]);

  if (options?.includeAdminPlatform && platformIntegrations === null) {
    notes.push("Detailed integration report requires an admin platform session.");
  }

  const systems = middleware.ok ? middleware.data?.systems : undefined;
  if (!middleware.ok) {
    notes.push(
      `Middleware health probe unavailable${middleware.error ? ` (${middleware.error})` : ""}.`,
    );
  }
  const checks = detailed.ok ? detailed.data?.checks : undefined;

  const components: PlatformComponent[] = COMPONENT_DEFS.map((def) => {
    // 1. Rich admin platform report takes precedence when present.
    const integration = platformIntegrations?.find((i) => i.name === def.platformName);
    if (integration) {
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        critical: def.critical,
        status: integrationStatusToComponent(integration.status),
        latencyMs: integration.latencyMs,
        detail: integration.error,
        source: "platform report",
      };
    }

    // 2. Keycloak SSO handshake probe.
    if (def.id === "keycloak" && keycloakReachable) {
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        critical: def.critical,
        status: "healthy" as ComponentStatus,
        detail: "SSO initiation handshake succeeded",
        source: "sso probe",
      };
    }

    // 3. Middleware boolean probe.
    const fromMiddleware = boolToStatus(def.middlewareKey ? systems?.[def.middlewareKey] : undefined);
    if (fromMiddleware) {
      // PostgreSQL additionally has latency from the detailed probe.
      const latencyMs =
        def.id === "postgres" && checks?.db?.status === "ok"
          ? checks.db.latencyMs
          : undefined;
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        critical: def.critical,
        status: fromMiddleware,
        latencyMs,
        detail:
          def.id === "postgres" && checks?.db?.error ? checks.db.error : undefined,
        source: "middleware probe",
      };
    }

    // 4. No signal anywhere — report honestly.
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      critical: def.critical,
      status: "unreachable" as ComponentStatus,
      detail: "No public health signal",
      source: "none",
    };
  });

  // Overall: any critical component down → down; any degraded or
  // non-critical down → degraded; unreachable-only components do not
  // drag the platform down.
  let overall: ComponentStatus = "healthy";
  if (components.some((c) => c.critical && c.status === "down")) {
    overall = "down";
  } else if (
    components.some((c) => c.status === "down" || c.status === "degraded")
  ) {
    overall = "degraded";
  }
  if (!liveness.ok) {
    overall = "down";
    notes.push(
      `Platform API unreachable${liveness.error ? ` (${liveness.error})` : ""}.`,
    );
  }

  return {
    overall,
    components,
    api: {
      reachable: liveness.ok,
      version: liveness.data?.version ?? detailed.data?.version ?? middleware.data?.version,
      latencyMs: liveness.ok ? liveness.latencyMs : undefined,
    },
    checkedAt: new Date().toISOString(),
    notes,
  };
}
