/**
 * dtccClient.ts — DTCC connector shell (explicitly out of scope for remittance)
 *
 * HONESTY NOTICE — READ BEFORE "INTEGRATING":
 *   The Depository Trust & Clearing Corporation (DTCC) is a securities
 *   POST-TRADE utility: clearing, settlement, custody, and asset servicing.
 *   It is NOT a payments rail and has NO role in retail remittance flows.
 *
 *   Access model (ground truth):
 *     - DTCC services are member-only (broker-dealers, banks, clearing
 *       agencies). Connectivity is FIX, SWIFT, and file-based batch.
 *     - The DTCC API Marketplace (developer.dtcc.com) is client-only:
 *       access is provisioned through a DTCC relationship manager to
 *       existing member firms. There is no public signup or sandbox for
 *       arbitrary developers.
 *     - DTCC's digital-asset initiatives (e.g. tokenized collateral,
 *       ComposerX) are relevant to RemitFlow ONLY if we ever launch
 *       tokenized securities — and then only through a custodian or
 *       clearing-broker sponsor, never directly.
 *
 *   See docs/integrations/dtcc.md for the full analysis and the
 *   custodian-sponsorship path.
 *
 * WHAT THIS FILE IS:
 *   A fail-closed, config-gated shell providing generic mTLS HTTPS and SFTP
 *   passthrough helpers for a FUTURE custodian-mediated use case, gated on:
 *     DTCC_API_BASE_URL     — sponsor-provided API base URL (mTLS)
 *     DTCC_MTLS_CERT_FILE   — client certificate
 *     DTCC_MTLS_KEY_FILE    — matching private key
 *     DTCC_MTLS_CA_FILE     — optional CA bundle override
 *     DTCC_ENDPOINTS_JSON   — JSON map name → { path, method } supplied by
 *                             the sponsoring member firm / DTCC
 *     DTCC_SFTP_HOST / DTCC_SFTP_PORT / DTCC_SFTP_USER / DTCC_SFTP_KEY_FILE
 *                           — file-based batch channel config (member-only)
 *   Until a custodian sponsor exists, every helper throws. There are no
 *   mocks, no fabricated responses, and no hardcoded DTCC endpoint paths.
 */

import https from "https";
import fs from "fs";
import { logger } from "./logger";

// ── Config ──────────────────────────────────────────────────────────────────

const DTCC_API_BASE_URL = process.env.DTCC_API_BASE_URL || "";
const DTCC_MTLS_CERT_FILE = process.env.DTCC_MTLS_CERT_FILE || "";
const DTCC_MTLS_KEY_FILE = process.env.DTCC_MTLS_KEY_FILE || "";
const DTCC_MTLS_CA_FILE = process.env.DTCC_MTLS_CA_FILE || "";
const DTCC_ENDPOINTS_JSON = process.env.DTCC_ENDPOINTS_JSON || "";

const DTCC_SFTP_HOST = process.env.DTCC_SFTP_HOST || "";
const DTCC_SFTP_PORT = Number(process.env.DTCC_SFTP_PORT || 22);
const DTCC_SFTP_USER = process.env.DTCC_SFTP_USER || "";
const DTCC_SFTP_KEY_FILE = process.env.DTCC_SFTP_KEY_FILE || "";

const REQUEST_TIMEOUT_MS = Number(process.env.DTCC_TIMEOUT_MS || 15000);

export const DTCC_UNCONFIGURED_NOTE =
  "DTCC is securities post-trade infrastructure (membership/FIX/file-based; API Marketplace is client-only). " +
  "It is out of scope for RemitFlow's remittance rails and would only be reached via a custodian/clearing-broker " +
  "sponsor for tokenized securities. See docs/integrations/dtcc.md";

// ── Types ───────────────────────────────────────────────────────────────────

export type DtccMode = "custodian-sponsored" | "unconfigured";

export interface DtccStatus {
  configured: boolean;
  mode: DtccMode;
  inScopeForRemittance: false;
  note: string;
}

interface DtccEndpointDef {
  path: string;
  method: "GET" | "POST";
}

// ── Status ──────────────────────────────────────────────────────────────────

export function getDtccStatus(): DtccStatus {
  const configured = Boolean(
    DTCC_API_BASE_URL && DTCC_MTLS_CERT_FILE && DTCC_MTLS_KEY_FILE,
  );
  return {
    configured,
    mode: configured ? "custodian-sponsored" : "unconfigured",
    inScopeForRemittance: false,
    note: configured
      ? "DTCC shell active under a custodian/clearing-broker sponsorship config. " +
        "This is generic passthrough for a future tokenized-securities use only — " +
        "DTCC remains out of scope for remittance. See docs/integrations/dtcc.md."
      : DTCC_UNCONFIGURED_NOTE,
  };
}

// ── Fail-closed helpers ─────────────────────────────────────────────────────

function assertDtccConfigured(): void {
  if (!DTCC_API_BASE_URL || !DTCC_MTLS_CERT_FILE || !DTCC_MTLS_KEY_FILE) {
    throw new Error(`[DTCC] FAIL-CLOSED: ${DTCC_UNCONFIGURED_NOTE}`);
  }
}

function loadEndpoints(): Record<string, DtccEndpointDef> {
  if (!DTCC_ENDPOINTS_JSON) {
    throw new Error(
      `[DTCC] FAIL-CLOSED: DTCC_ENDPOINTS_JSON not set. ` +
        `Endpoint definitions come from the sponsoring member firm and are never hardcoded. ${DTCC_UNCONFIGURED_NOTE}`,
    );
  }
  try {
    const parsed = JSON.parse(DTCC_ENDPOINTS_JSON) as Record<string, DtccEndpointDef>;
    for (const [name, def] of Object.entries(parsed)) {
      if (!def || typeof def.path !== "string" || !["GET", "POST"].includes(def.method)) {
        throw new Error(`invalid endpoint definition for "${name}"`);
      }
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `[DTCC] FAIL-CLOSED: DTCC_ENDPOINTS_JSON is not a valid endpoint map: ${(err as Error).message}`,
    );
  }
}

// ── Generic mTLS HTTPS passthrough (real HTTPS, no fabricated responses) ────

export async function callDtccApi<T = unknown>(
  endpointName: string,
  body?: unknown,
): Promise<T> {
  assertDtccConfigured();
  const endpoints = loadEndpoints();
  const def = endpoints[endpointName];
  if (!def) {
    throw new Error(
      `[DTCC] FAIL-CLOSED: endpoint "${endpointName}" not present in DTCC_ENDPOINTS_JSON. ` +
        `We do not invent DTCC paths — add the sponsor-supplied definition. ${DTCC_UNCONFIGURED_NOTE}`,
    );
  }

  let cert: Buffer;
  let key: Buffer;
  let ca: Buffer | undefined;
  try {
    cert = fs.readFileSync(DTCC_MTLS_CERT_FILE);
    key = fs.readFileSync(DTCC_MTLS_KEY_FILE);
    ca = DTCC_MTLS_CA_FILE ? fs.readFileSync(DTCC_MTLS_CA_FILE) : undefined;
  } catch (err) {
    throw new Error(
      `[DTCC] FAIL-CLOSED: unable to read mTLS certificate/key material: ${(err as Error).message}`,
    );
  }

  const url = new URL(def.path, DTCC_API_BASE_URL);
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;

  logger.info({ endpointName, method: def.method, path: def.path }, "DTCC sponsor-mediated mTLS request");

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
              new Error(`[DTCC] Sponsor endpoint "${endpointName}" returned HTTP ${status}: ${text.slice(0, 500)}`),
            );
            return;
          }
          try {
            resolve(text ? (JSON.parse(text) as T) : ({} as T));
          } catch {
            reject(new Error(`[DTCC] Endpoint "${endpointName}" returned non-JSON response (status ${status})`));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`[DTCC] Request to "${endpointName}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", (err) => {
      reject(new Error(`[DTCC] mTLS request to "${endpointName}" failed: ${err.message}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Generic SFTP passthrough (member file-based channel) ────────────────────

/**
 * Returns the validated SFTP connection parameters for the DTCC member
 * file-drop channel. This is intentionally just a config validator + params
 * provider: the actual SFTP transfer is performed by an operational batch
 * job (not built) once a custodian sponsor exists. Fail-closed if unset.
 */
export function getDtccSftpConfig(): {
  host: string;
  port: number;
  username: string;
  privateKeyFile: string;
} {
  if (!DTCC_SFTP_HOST || !DTCC_SFTP_USER || !DTCC_SFTP_KEY_FILE) {
    throw new Error(
      `[DTCC] FAIL-CLOSED: SFTP file channel not configured ` +
        `(DTCC_SFTP_HOST / DTCC_SFTP_USER / DTCC_SFTP_KEY_FILE). ${DTCC_UNCONFIGURED_NOTE}`,
    );
  }
  if (!fs.existsSync(DTCC_SFTP_KEY_FILE)) {
    throw new Error(`[DTCC] FAIL-CLOSED: SFTP key file not found: ${DTCC_SFTP_KEY_FILE}`);
  }
  return {
    host: DTCC_SFTP_HOST,
    port: DTCC_SFTP_PORT,
    username: DTCC_SFTP_USER,
    privateKeyFile: DTCC_SFTP_KEY_FILE,
  };
}
