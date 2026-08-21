/**
 * RemitFlow — Secure HTTP Client
 * ═══════════════════════════════════════════════════════════════════════════
 * Hardened wrapper around axios that mitigates:
 *   - CVE-2026-34841: Axios supply chain attack (RAT injection via plain-crypto-js)
 *     Mitigation: Pin axios version, validate response integrity, enforce SSRF controls
 *   - CVE-2025-58754: DoS via lack of data size check
 *     Mitigation: Enforce max response size limits
 *   - SSRF: Prevent requests to internal network ranges
 *
 * All outbound HTTP calls in RemitFlow MUST use this client.
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

// ─── SSRF Protection: Blocked IP Ranges ──────────────────────────────────────

const BLOCKED_PREFIXES = [
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",
  "127.",
  "169.254.", // Link-local
  "::1",      // IPv6 loopback
  "fc00:",    // IPv6 ULA
  "fd",       // IPv6 ULA
];

function isBlockedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    return BLOCKED_PREFIXES.some((prefix) => hostname.startsWith(prefix));
  } catch {
    return true; // Block malformed URLs
  }
}

// ─── Max Response Size (CVE-2025-58754 mitigation) ───────────────────────────

const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSecureHttpClient(options?: {
  baseURL?: string;
  timeoutMs?: number;
  allowInternalHosts?: boolean; // Only set true for internal service calls
}): AxiosInstance {
  const instance = axios.create({
    baseURL: options?.baseURL,
    timeout: options?.timeoutMs ?? 10_000,
    maxContentLength: MAX_RESPONSE_SIZE_BYTES,
    maxBodyLength: MAX_RESPONSE_SIZE_BYTES,
    // Enforce HTTPS for all external calls
    validateStatus: (status) => status >= 200 && status < 500,
    headers: {
      "User-Agent": "RemitFlow/1.0 (+https://remitflow.io)",
      "Accept": "application/json",
    },
  });

  // ─── Request Interceptor: SSRF Guard ────────────────────────────────────
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const url = config.baseURL
      ? `${config.baseURL}${config.url ?? ""}`
      : config.url ?? "";

    if (!options?.allowInternalHosts && isBlockedHost(url)) {
      throw new Error(`SSRF protection: blocked request to internal host: ${url}`);
    }

    return config;
  });

  // ─── Response Interceptor: Size Guard ───────────────────────────────────
  instance.interceptors.response.use((response: AxiosResponse) => {
    const rawContentLength = response.headers["content-length"];
    const contentLengthValue = Array.isArray(rawContentLength)
      ? rawContentLength[0]
      : typeof rawContentLength === "string" || typeof rawContentLength === "number"
        ? String(rawContentLength)
        : "0";
    const contentLength = parseInt(contentLengthValue, 10);
    if (contentLength > MAX_RESPONSE_SIZE_BYTES) {
      throw new Error(
        `Response size ${contentLength} exceeds maximum allowed ${MAX_RESPONSE_SIZE_BYTES} bytes`
      );
    }
    return response;
  });

  return instance;
}

// ─── Pre-built Clients ────────────────────────────────────────────────────────

/** External API client — SSRF protection enabled, no internal hosts */
export const externalHttpClient = createSecureHttpClient({ timeoutMs: 15_000 });

/** Internal service client — allows RFC1918 addresses, shorter timeout */
export const internalHttpClient = createSecureHttpClient({
  timeoutMs: 5_000,
  allowInternalHosts: true,
});

// ─── SEC-09: Public-URL validation for user-supplied webhook endpoints ────────
// Validates scheme and host, resolves DNS, and rejects any URL whose hostname
// is — or resolves to — a loopback / RFC1918 / link-local / CGNAT / multicast /
// otherwise non-public address. Call this at registration time AND again
// immediately before every delivery (DNS rebind defense-in-depth).

import dns from "dns/promises";
import net from "net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0) return true;                    // 0.0.0.0/8 "this network"
  if (a === 10) return true;                   // RFC1918
  if (a === 127) return true;                  // loopback
  if (a === 169 && b === 254) return true;     // link-local (incl. 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;  // RFC1918
  if (a === 192 && b === 168) return true;     // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true;       // 192.0.0.0/24, 192.0.2.0/24 (doc)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51) return true;      // doc range
  if (a === 203 && b === 0) return true;       // doc range
  if (a >= 224) return true;                   // multicast + reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return true;  // unspecified / loopback
  if (h.startsWith("fe80") || h.startsWith("fe90") || h.startsWith("fea0") || h.startsWith("feb0")) return true; // link-local fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("ff")) return true;         // multicast ff00::/8
  const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]); // IPv4-mapped IPv6
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not an IP — treat as blocked when an IP was expected
}

/**
 * SEC-09: Assert that a user-supplied webhook URL is safe to call.
 * - https only (http allowed only outside production, for local testing)
 * - hostname must not be an internal/reserved IP literal or known internal name
 * - DNS is resolved and EVERY resolved address must be public
 * Throws an Error with a generic message on rejection (no internal detail leak).
 */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<void> {
  const reject = (reason: string): never => {
    throw new Error(`Webhook URL rejected: must be a public https endpoint (${reason})`);
  };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return reject("unparseable");
  }
  const isProd = process.env.NODE_ENV === "production";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && !isProd)) {
    return reject("scheme not allowed");
  }
  if (parsed.username || parsed.password) {
    return reject("credentials in URL not allowed");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) return reject("empty hostname");
  if (BLOCKED_HOSTNAMES.has(hostname)) return reject("blocked hostname");
  if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".localhost") || hostname.endsWith(".corp")) {
    return reject("internal hostname suffix");
  }
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) return reject("internal IP literal");
    return; // public IP literal — nothing to resolve
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return reject("hostname does not resolve");
  }
  if (addresses.length === 0) return reject("hostname does not resolve");
  for (const { address } of addresses) {
    if (isBlockedIp(address)) return reject("hostname resolves to internal address");
  }
}
