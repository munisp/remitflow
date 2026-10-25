/**
 * kinexysClient.ts — Kinexys by J.P. Morgan (formerly Onyx) connector shell
 *
 * HONESTY NOTICE — READ BEFORE "INTEGRATING":
 *   Kinexys has NO public API, NO public sandbox, and NO public endpoint
 *   documentation. Access requires a J.P. Morgan institutional banking
 *   relationship, commercial onboarding to Kinexys Digital Payments, and
 *   participant whitelisting. JPMD (the JPM deposit token) is restricted to
 *   institutional participants on a whitelist basis and explicitly excludes
 *   retail users. The J.P. Morgan Payments developer portal
 *   (developer.payments.jpmorgan.com) documents ACH/wires/RTP/FX APIs for
 *   enterprise clients — it is NOT Kinexys and cannot be used here.
 *
 *   See docs/integrations/kinexys.md for the full access model and the
 *   prerequisites RemitFlow must complete before this shell can carry real
 *   traffic.
 *
 * WHAT THIS FILE IS:
 *   A fail-closed, config-gated connector shell. When (and only when) all of
 *     KINEXYS_API_BASE_URL      — partner-provided base URL (mutual TLS)
 *     KINEXYS_MTLS_CERT_FILE    — client certificate issued by J.P. Morgan
 *     KINEXYS_MTLS_KEY_FILE     — matching private key
 *     KINEXYS_MTLS_CA_FILE      — optional CA bundle override
 *     KINEXYS_ENDPOINTS_JSON    — JSON object mapping endpoint name →
 *                                 { "path": "...", "method": "GET"|"POST" }
 *                                 supplied by J.P. Morgan under NDA
 *   are set, generic mTLS HTTPS GET/POST passthrough helpers become active.
 *   Because no public spec exists, we NEVER invent endpoint paths, request
 *   shapes, or response shapes: every call goes through `callKinexys(name)`
 *   and resolves its path/method exclusively from KINEXYS_ENDPOINTS_JSON.
 *   Unknown endpoint names fail loudly.
 *
 * WHAT THIS FILE IS NOT:
 *   Not a fake integration. Not a mock. Not a stub that returns fabricated
 *   Kinexys responses. Anything unconfigured throws — there is no dev mock.
 */

import https from "https";
import fs from "fs";
import { logger } from "./logger";

// ── Config ──────────────────────────────────────────────────────────────────

const KINEXYS_API_BASE_URL = process.env.KINEXYS_API_BASE_URL || "";
const KINEXYS_MTLS_CERT_FILE = process.env.KINEXYS_MTLS_CERT_FILE || "";
const KINEXYS_MTLS_KEY_FILE = process.env.KINEXYS_MTLS_KEY_FILE || "";
const KINEXYS_MTLS_CA_FILE = process.env.KINEXYS_MTLS_CA_FILE || "";
const KINEXYS_ENDPOINTS_JSON = process.env.KINEXYS_ENDPOINTS_JSON || "";

const REQUEST_TIMEOUT_MS = Number(process.env.KINEXYS_TIMEOUT_MS || 15000);

export const KINEXYS_UNCONFIGURED_NOTE =
  "Kinexys requires a J.P. Morgan institutional partnership; see docs/integrations/kinexys.md";

// ── Types ───────────────────────────────────────────────────────────────────

export type KinexysMode = "partner-mtls" | "unconfigured";

export interface KinexysStatus {
  configured: boolean;
  mode: KinexysMode;
  note: string;
}

interface KinexysEndpointDef {
  path: string;
  method: "GET" | "POST";
}

// ── Status ──────────────────────────────────────────────────────────────────

export function getKinexysStatus(): KinexysStatus {
  const configured = Boolean(
    KINEXYS_API_BASE_URL && KINEXYS_MTLS_CERT_FILE && KINEXYS_MTLS_KEY_FILE,
  );
  return {
    configured,
    mode: configured ? "partner-mtls" : "unconfigured",
    note: configured
      ? "Kinexys shell active: mTLS configured; endpoint map loaded from KINEXYS_ENDPOINTS_JSON (partner-supplied under NDA). Paths and shapes are generic passthrough only — see docs/integrations/kinexys.md."
      : KINEXYS_UNCONFIGURED_NOTE,
  };
}

// ── Fail-closed helpers ─────────────────────────────────────────────────────

function assertKinexysConfigured(): void {
  if (!KINEXYS_API_BASE_URL || !KINEXYS_MTLS_CERT_FILE || !KINEXYS_MTLS_KEY_FILE) {
    throw new Error(`[Kinexys] FAIL-CLOSED: ${KINEXYS_UNCONFIGURED_NOTE}`);
  }
}

function loadEndpoints(): Record<string, KinexysEndpointDef> {
  if (!KINEXYS_ENDPOINTS_JSON) {
    throw new Error(
      `[Kinexys] FAIL-CLOSED: KINEXYS_ENDPOINTS_JSON not set. ` +
        `Endpoint paths are supplied by J.P. Morgan under NDA and are never hardcoded. ${KINEXYS_UNCONFIGURED_NOTE}`,
    );
  }
  try {
    const parsed = JSON.parse(KINEXYS_ENDPOINTS_JSON) as Record<string, KinexysEndpointDef>;
    for (const [name, def] of Object.entries(parsed)) {
      if (!def || typeof def.path !== "string" || !["GET", "POST"].includes(def.method)) {
        throw new Error(`invalid endpoint definition for "${name}"`);
      }
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `[Kinexys] FAIL-CLOSED: KINEXYS_ENDPOINTS_JSON is not a valid endpoint map: ${(err as Error).message}`,
    );
  }
}

// ── Generic mTLS passthrough (real HTTPS, no fabricated responses) ─────────

export async function callKinexys<T = unknown>(
  endpointName: string,
  body?: unknown,
): Promise<T> {
  assertKinexysConfigured();
  const endpoints = loadEndpoints();
  const def = endpoints[endpointName];
  if (!def) {
    throw new Error(
      `[Kinexys] FAIL-CLOSED: endpoint "${endpointName}" not present in KINEXYS_ENDPOINTS_JSON. ` +
        `We do not invent Kinexys paths — add the partner-supplied definition. ${KINEXYS_UNCONFIGURED_NOTE}`,
    );
  }

  let cert: Buffer;
  let key: Buffer;
  let ca: Buffer | undefined;
  try {
    cert = fs.readFileSync(KINEXYS_MTLS_CERT_FILE);
    key = fs.readFileSync(KINEXYS_MTLS_KEY_FILE);
    ca = KINEXYS_MTLS_CA_FILE ? fs.readFileSync(KINEXYS_MTLS_CA_FILE) : undefined;
  } catch (err) {
    throw new Error(
      `[Kinexys] FAIL-CLOSED: unable to read mTLS certificate/key material: ${(err as Error).message}`,
    );
  }

  const url = new URL(def.path, KINEXYS_API_BASE_URL);
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;

  logger.info({ endpointName, method: def.method, path: def.path }, "Kinexys mTLS request");

  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: def.method,
        cert,
        key,
        ca,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": String(payload.length) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            reject(
              new Error(`[Kinexys] Partner endpoint "${endpointName}" returned HTTP ${status}: ${text.slice(0, 500)}`),
            );
            return;
          }
          try {
            resolve(text ? (JSON.parse(text) as T) : ({} as T));
          } catch {
            reject(new Error(`[Kinexys] Endpoint "${endpointName}" returned non-JSON response (status ${status})`));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`[Kinexys] Request to "${endpointName}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", (err) => {
      reject(new Error(`[Kinexys] mTLS request to "${endpointName}" failed: ${err.message}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** Convenience wrappers over the generic passthrough. */
export async function kinexysGet<T = unknown>(endpointName: string): Promise<T> {
  const endpoints = loadEndpoints();
  const def = endpoints[endpointName];
  if (def && def.method !== "GET") {
    throw new Error(`[Kinexys] Endpoint "${endpointName}" is defined as ${def.method}, not GET`);
  }
  return callKinexys<T>(endpointName);
}

export async function kinexysPost<T = unknown>(endpointName: string, body: unknown): Promise<T> {
  const endpoints = loadEndpoints();
  const def = endpoints[endpointName];
  if (def && def.method !== "POST") {
    throw new Error(`[Kinexys] Endpoint "${endpointName}" is defined as ${def.method}, not POST`);
  }
  return callKinexys<T>(endpointName, body);
}
