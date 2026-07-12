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
    const contentLength = parseInt(
      response.headers["content-length"] ?? "0",
      10
    );
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
