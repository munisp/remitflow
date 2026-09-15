import { TRPCError } from "@trpc/server";

export type StablecoinEngineResponse = Record<string, unknown>;

function requiredServiceUrl(variable: string): string {
  const value = process.env[variable]?.trim();
  if (!value) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${variable} must be configured before stablecoin operations can be used.`,
    });
  }
  return value.replace(/\/+$/, "");
}

async function requestJson<T extends Record<string, unknown>>(
  serviceVariable: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const url = `${requiredServiceUrl(serviceVariable)}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `${serviceVariable} is unavailable: ${error instanceof Error ? error.message : "connection failed"}`,
    });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `${serviceVariable} rejected the request (${response.status}): ${body.slice(0, 240)}`,
    });
  }
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${serviceVariable} returned an invalid response contract.`,
    });
  }
  return data as T;
}

// SPEC-wave12 §3.1 — the go-stablecoin-engine is canonical and requires
// `X-API-Key: ${INTERNAL_SERVICE_KEY}` on all POST /stablecoin/* routes.
// Fail closed in production when the key is not configured.
function stablecoinEngineApiKey(): string {
  const key = process.env.INTERNAL_SERVICE_KEY?.trim() ?? "";
  if (!key && process.env.NODE_ENV === "production") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "INTERNAL_SERVICE_KEY must be configured before stablecoin engine operations can be used.",
    });
  }
  return key;
}

function stablecoinEngineHeaders(withBody: boolean): Record<string, string> {
  return {
    ...(withBody ? { "Content-Type": "application/json" } : {}),
    "X-API-Key": stablecoinEngineApiKey(),
  };
}

export async function requestStablecoinEngine(
  path: string,
  body: Record<string, unknown>,
): Promise<StablecoinEngineResponse> {
  return requestJson<StablecoinEngineResponse>("STABLECOIN_ENGINE_URL", path, {
    method: "POST",
    headers: stablecoinEngineHeaders(true),
    body: JSON.stringify(body),
  });
}

// SPEC-wave12 §3.1 — GET routes on the engine (fx-rates, supported, depeg,
// yield, gas). `path` may include a query string.
export async function requestStablecoinEngineGet(
  path: string,
): Promise<StablecoinEngineResponse> {
  return requestJson<StablecoinEngineResponse>("STABLECOIN_ENGINE_URL", path, {
    method: "GET",
    headers: stablecoinEngineHeaders(false),
  });
}

export async function requestStablecoinOracle(
  path: string,
): Promise<StablecoinEngineResponse> {
  return requestJson<StablecoinEngineResponse>("STABLECOIN_ORACLE_URL", path, { method: "GET" });
}

export async function submitTravelRuleReport(payload: Record<string, unknown>): Promise<void> {
  await requestJson<StablecoinEngineResponse>("TRAVEL_RULE_SERVICE_URL", "/travel-rule/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Stablecoin provider response is missing a finite ${field}.` });
  }
  return value;
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Stablecoin provider response is missing ${field}.` });
  }
  return value;
}
