import type { Express, Request, Response } from "express";
import { logger } from "./logger";

const FORWARDED_HEADERS = [
  "authorization",
  "content-type",
  "idempotency-key",
  "x-request-id",
  "x-tenant-id",
  "x-ledger-id",
] as const;

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function configuredUpstream(): URL | null {
  const raw = process.env.CORE_BANKING_UPSTREAM_URL?.trim();
  if (!raw) return null;
  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    throw new Error("CORE_BANKING_UPSTREAM_URL must be an absolute HTTP(S) URL");
  }
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("CORE_BANKING_UPSTREAM_URL must use HTTP or HTTPS");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(upstream.hostname)) {
    throw new Error("CORE_BANKING_UPSTREAM_URL cannot target the API process itself");
  }
  return upstream;
}

function upstreamPath(req: Request): string {
  const original = req.originalUrl || req.url;
  const path = original.replace(/^\/api(?=\/|$)/, "");
  return path || "/";
}

function headersFor(req: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.header(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type") && BODY_METHODS.has(req.method)) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

function responseHeaders(upstream: globalThis.Response, res: Response): void {
  for (const name of ["content-type", "cache-control", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
}

/**
 * Forwards legacy PWA REST calls to the real core-banking backend. The native
 * Express and tRPC routes are registered first; only otherwise-unhandled `/api`
 * requests reach this proxy. It deliberately returns a JSON 503 or 502 instead
 * of emitting a simulated business result.
 */
export function registerRestCompatibilityProxy(app: Express): void {
  app.all("/api/*", async (req, res) => {
    let upstream: URL | null;
    try {
      upstream = configuredUpstream();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid core-banking upstream configuration";
      logger.error({ message }, "[REST compatibility] Invalid upstream configuration");
      return res.status(503).json({ error: "core_banking_unavailable", message });
    }

    if (!upstream) {
      return res.status(503).json({
        error: "core_banking_unavailable",
        message: "CORE_BANKING_UPSTREAM_URL is required for legacy REST service requests",
      });
    }

    const target = new URL(upstreamPath(req), upstream);
    try {
      const init: RequestInit = {
        method: req.method,
        headers: headersFor(req),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      };
      if (BODY_METHODS.has(req.method) && req.body !== undefined) {
        init.body = JSON.stringify(req.body);
      }

      const response = await fetch(target, init);
      responseHeaders(response, res);
      const payload = Buffer.from(await response.arrayBuffer());
      return res.status(response.status).send(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Core-banking upstream request failed";
      logger.error({ method: req.method, path: upstreamPath(req), message }, "[REST compatibility] Upstream request failed");
      return res.status(502).json({ error: "core_banking_upstream_error", message: "The configured core-banking service did not respond" });
    }
  });
}
