/**
 * RemitFlow React Native — Platform Health Service
 * ─────────────────────────────────────────────────
 * Mirrors the PWA health contracts against the same real endpoints:
 *
 *   GET /api/health              → API liveness { status, version }
 *   GET /api/health/detailed     → { checks: { db, fx } } with latency
 *   GET /api/middleware/health   → { systems: { kafka, redis, postgres,
 *                                  temporal, tigerbeetle, permify,
 *                                  opensearch, dapr: boolean } }
 *   GET /api/auth/keycloak/login → Keycloak reachability probe (SSO)
 *
 * Components without a signal are reported as "unreachable" — never faked.
 */
import { apiUrl, isApiConfigured } from "./apiConfig";

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
  source: string;
}

export interface PlatformHealthSnapshot {
  overall: ComponentStatus;
  components: PlatformComponent[];
  api: { reachable: boolean; version?: string; latencyMs?: number };
  checkedAt: string;
  notes: string[];
}

interface DetailedHealthResponse {
  status: string;
  version?: string;
  checks?: Record<string, { status: string; latencyMs?: number; error?: string }>;
}

interface MiddlewareHealthResponse {
  status: string;
  version?: string;
  systems?: Record<string, boolean>;
}

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
    const response = await fetch(apiUrl(path), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    clearTimeout(timeoutId);
    if (!response.ok && response.status !== 207) {
      return { ok: false, latencyMs, error: `HTTP ${response.status}` };
    }
    return { ok: true, latencyMs, data: (await response.json()) as T };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/** Probe Keycloak reachability via the PKCE login initiation endpoint. */
async function probeKeycloak(): Promise<boolean> {
  if (!isApiConfigured()) return false;
  const outcome = await fetchJson<{ authorizationUrl?: string; state?: string }>(
    "/auth/keycloak/login",
    4000,
  );
  return Boolean(
    outcome.ok && outcome.data?.authorizationUrl && outcome.data?.state,
  );
}

interface ComponentDef {
  id: string;
  name: string;
  description: string;
  critical: boolean;
  middlewareKey?: string;
}

/** The 13 hardened platform components, plus Temporal (reported by the probe). */
const COMPONENT_DEFS: ComponentDef[] = [
  { id: "postgres", name: "PostgreSQL", description: "Primary relational store", critical: true, middlewareKey: "postgres" },
  { id: "tigerbeetle", name: "TigerBeetle", description: "Double-entry ledger", critical: true, middlewareKey: "tigerbeetle" },
  { id: "redis", name: "Redis", description: "Cache, rate limiting & sessions", critical: false, middlewareKey: "redis" },
  { id: "kafka", name: "Kafka", description: "Event streaming backbone", critical: false, middlewareKey: "kafka" },
  { id: "mojaloop", name: "Mojaloop", description: "Interoperable payment switch", critical: true },
  { id: "apisix", name: "APISIX", description: "API gateway", critical: true },
  { id: "keycloak", name: "Keycloak", description: "Identity & access management", critical: true },
  { id: "openappsec", name: "open-appsec WAF", description: "Web application firewall", critical: false },
  { id: "permify", name: "Permify", description: "Authorization (ReBAC)", critical: true, middlewareKey: "permify" },
  { id: "opensearch", name: "OpenSearch", description: "Search & log analytics", critical: false, middlewareKey: "opensearch" },
  { id: "fluvio", name: "Fluvio", description: "Streaming data platform", critical: false },
  { id: "dapr", name: "Dapr", description: "Distributed application runtime", critical: false, middlewareKey: "dapr" },
  { id: "lakehouse", name: "Lakehouse", description: "Analytics data platform", critical: false },
  { id: "temporal", name: "Temporal", description: "Workflow orchestration", critical: false, middlewareKey: "temporal" },
];

/** Build the full snapshot. Never throws; failures fold into component states. */
export async function getPlatformHealthSnapshot(): Promise<PlatformHealthSnapshot> {
  const notes: string[] = [];

  if (!isApiConfigured()) {
    return {
      overall: "unreachable",
      components: COMPONENT_DEFS.map((def) => ({
        id: def.id,
        name: def.name,
        description: def.description,
        critical: def.critical,
        status: "unreachable" as ComponentStatus,
        detail: "API URL not configured",
        source: "none",
      })),
      api: { reachable: false },
      checkedAt: new Date().toISOString(),
      notes: [
        "RemitFlow API URL is not configured for this build (EXPO_PUBLIC_API_URL).",
      ],
    };
  }

  const [liveness, detailed, middleware, keycloakReachable] = await Promise.all([
    fetchJson<{ status: string; version?: string }>("/health"),
    fetchJson<DetailedHealthResponse>("/health/detailed"),
    fetchJson<MiddlewareHealthResponse>("/middleware/health"),
    probeKeycloak(),
  ]);

  const systems = middleware.ok ? middleware.data?.systems : undefined;
  if (!middleware.ok) {
    notes.push(
      `Middleware health probe unavailable${middleware.error ? ` (${middleware.error})` : ""}.`,
    );
  }
  const checks = detailed.ok ? detailed.data?.checks : undefined;

  const components: PlatformComponent[] = COMPONENT_DEFS.map((def) => {
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

    const boolValue = def.middlewareKey ? systems?.[def.middlewareKey] : undefined;
    if (boolValue !== undefined && boolValue !== null) {
      const latencyMs =
        def.id === "postgres" && checks?.db?.status === "ok"
          ? checks.db.latencyMs
          : undefined;
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        critical: def.critical,
        status: boolValue ? ("healthy" as ComponentStatus) : ("down" as ComponentStatus),
        latencyMs,
        detail: def.id === "postgres" && checks?.db?.error ? checks.db.error : undefined,
        source: "middleware probe",
      };
    }

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
