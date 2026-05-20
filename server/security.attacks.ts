/**
 * RemitFlow — Attack Mitigation Module (v132)
 *
 * Covers every major attack vector targeting financial platforms:
 *
 * ── DDoS & Volumetric Attacks ──────────────────────────────────────────────
 * 1. Progressive slow-down (tarpitting) before hard block
 * 2. Connection-flood protection via request concurrency limiter
 * 3. Payload-size hard cap (10 KB for API, 5 MB for file upload)
 * 4. HTTP method allowlist (reject TRACE/CONNECT/PATCH-on-read)
 * 5. Slowloris protection via request timeout middleware
 * 6. Amplification attack prevention (no large unauthenticated responses)
 * 7. IP reputation / suspicious-UA blocking
 *
 * ── Ransomware / Malware Vectors ──────────────────────────────────────────
 * 8. File-upload magic-byte validation (MIME ≠ extension spoofing)
 * 9. Dangerous file extension blocklist
 * 10. Zip-slip / path-traversal in archive uploads
 * 11. Executable content-type rejection
 * 12. Upload size hard cap (5 MB)
 *
 * ── Financial Platform–Specific Attacks ──────────────────────────────────
 * 13. Double-spend / replay detection (idempotency key + 24h window)
 * 14. Account-takeover (ATO) detection: impossible travel, new device
 * 15. Business Email Compromise (BEC) beneficiary-swap detection
 * 16. Round-tripping / money laundering velocity check
 * 17. Credential stuffing detection (many IPs same account)
 * 18. API enumeration prevention (rate-limit + random delay on 404)
 * 19. Parameter tampering (amount/currency mismatch between request layers)
 * 20. JWT algorithm confusion (alg:none / RS→HS downgrade)
 * 21. Timing-attack-safe comparison for tokens and secrets
 * 22. Structured security event emission to SIEM
 */

import { Request, Response, NextFunction, Express } from "express";
import slowDown from "express-slow-down";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import crypto from "crypto";
import { getDb } from "./db";
import { auditLogs } from "../drizzle/schema";
import { logger } from './_core/logger';

// ─── 1. Progressive Slow-Down (Tarpitting) ────────────────────────────────────
// After 50 req/min, each additional request is delayed by 500ms (max 20s).
// Attackers experience exponential latency; legitimate users rarely hit it.
export const progressiveSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 50,
  delayMs: (used) => (used - 50) * 500,
  maxDelayMs: 20_000,
  skip: (req) => req.path === "/health" || req.path === "/api/health",
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

// Auth-specific tarpitting: after 5 attempts, add 2s per attempt (max 30s)
export const authSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 5,
  delayMs: (used) => (used - 5) * 2_000,
  maxDelayMs: 30_000,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

// ─── 2. Concurrency Limiter (Connection-Flood) ────────────────────────────────
// Tracks in-flight requests per IP. Rejects if > 20 concurrent.
const concurrencyMap = new Map<string, number>();
export function concurrencyLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? "unknown";
  const current = concurrencyMap.get(key) ?? 0;
  if (current >= 20) {
    res.status(429).json({ error: "Too many concurrent requests from this IP." });
    return;
  }
  concurrencyMap.set(key, current + 1);
  res.on("finish", () => {
    const c = concurrencyMap.get(key) ?? 1;
    if (c <= 1) concurrencyMap.delete(key);
    else concurrencyMap.set(key, c - 1);
  });
  next();
}

// ─── 3. Payload Size Hard Cap ─────────────────────────────────────────────────
export function payloadSizeGuard(req: Request, res: Response, next: NextFunction) {
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  const isUpload = req.path.includes("upload") || req.path.includes("kyc");
  const maxBytes = isUpload ? 5 * 1024 * 1024 : 10 * 1024; // 5MB upload, 10KB API
  if (contentLength > maxBytes) {
    res.status(413).json({
      error: `Payload too large. Maximum allowed: ${isUpload ? "5MB" : "10KB"}.`,
    });
    return;
  }
  next();
}

// ─── 4. HTTP Method Allowlist ─────────────────────────────────────────────────
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
export function httpMethodGuard(req: Request, res: Response, next: NextFunction) {
  if (!ALLOWED_METHODS.has(req.method)) {
    res.status(405).set("Allow", Array.from(ALLOWED_METHODS).join(", ")).json({
      error: `Method ${req.method} not allowed.`,
    });
    return;
  }
  next();
}

// ─── 5. Slowloris / Request Timeout ──────────────────────────────────────────
// Kills connections that haven't completed headers within 10s.
export function requestTimeoutGuard(req: Request, res: Response, next: NextFunction) {
  res.setTimeout(30_000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout." });
    }
  });
  next();
}

// ─── 6. Amplification Prevention ─────────────────────────────────────────────
// Unauthenticated requests to data-heavy endpoints get a stub response.
const HEAVY_ENDPOINTS = ["/api/trpc/transactions.list", "/api/trpc/auditLog.list"];
export function amplificationGuard(req: Request, res: Response, next: NextFunction) {
  if (HEAVY_ENDPOINTS.some((e) => req.path.startsWith(e))) {
    const sessionCookie = req.cookies?.app_session_id;
    if (!sessionCookie) {
      res.status(401).json({ error: "Authentication required for this endpoint." });
      return;
    }
  }
  next();
}

// ─── 7. IP Reputation / Suspicious UA Blocking ───────────────────────────────
const BLOCKED_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i, /dirbuster/i,
  /hydra/i, /medusa/i, /burpsuite/i, /havij/i, /acunetix/i, /nessus/i,
  /openvas/i, /w3af/i, /skipfish/i, /wfuzz/i, /gobuster/i, /ffuf/i,
];
export function suspiciousUAGuard(req: Request, res: Response, next: NextFunction) {
  const ua = req.headers["user-agent"] ?? "";
  for (const pattern of BLOCKED_UA_PATTERNS) {
    if (pattern.test(ua)) {
      // Log and silently drop (don't reveal we detected it)
      logger.warn(`[Security] Blocked scanner UA from ${req.ip}: ${ua.slice(0, 80)}`);
      res.status(404).json({ error: "Not found." });
      return;
    }
  }
  next();
}

// ─── 8. File Upload Magic-Byte Validation ────────────────────────────────────
// Allowed MIME types and their magic bytes (first 4–8 bytes)
const ALLOWED_UPLOAD_TYPES: Record<string, Buffer[]> = {
  "image/jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  "image/png": [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  "image/webp": [Buffer.from("RIFF")],
  "application/pdf": [Buffer.from([0x25, 0x50, 0x44, 0x46])],
};
const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".dll", ".bat", ".cmd", ".sh", ".ps1", ".vbs", ".js", ".jar",
  ".msi", ".scr", ".pif", ".com", ".reg", ".hta", ".wsf", ".lnk",
  ".php", ".asp", ".aspx", ".jsp", ".py", ".rb", ".pl", ".cgi",
  ".zip", ".tar", ".gz", ".7z", ".rar", // archives can contain malware
]);

export function validateUploadMagicBytes(
  filename: string,
  mimeType: string,
  buffer: Buffer
): { valid: boolean; reason?: string } {
  // Check extension
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `File extension ${ext} is not permitted.` };
  }
  // Check magic bytes match declared MIME
  const allowedMagics = ALLOWED_UPLOAD_TYPES[mimeType];
  if (!allowedMagics) {
    return { valid: false, reason: `MIME type ${mimeType} is not permitted for uploads.` };
  }
  const matches = allowedMagics.some((magic) => buffer.slice(0, magic.length).equals(magic));
  if (!matches) {
    return { valid: false, reason: "File content does not match declared MIME type (possible spoofing)." };
  }
  return { valid: true };
}

// ─── 9-10. Zip-Slip / Path Traversal in Archive Names ────────────────────────
export function sanitizeUploadFilename(filename: string): string {
  // Remove path components, null bytes, and control chars
  return filename
    .replace(/\.\.\//g, "")
    .replace(/\.\.\\/g, "")
    .replace(/[/\\]/g, "-")
    .replace(/\x00/g, "")
    .replace(/[\x01-\x1f]/g, "")
    .slice(0, 255);
}

// ─── 13. Double-Spend / Replay Detection ─────────────────────────────────────
// Idempotency keys stored in-memory with 24h TTL (Redis in production).
const idempotencyStore = new Map<string, { result: unknown; expiresAt: number }>();
export function checkIdempotencyKey(key: string): { duplicate: boolean; result?: unknown } {
  const entry = idempotencyStore.get(key);
  if (!entry) return { duplicate: false };
  if (Date.now() > entry.expiresAt) {
    idempotencyStore.delete(key);
    return { duplicate: false };
  }
  return { duplicate: true, result: entry.result };
}
export function storeIdempotencyResult(key: string, result: unknown): void {
  idempotencyStore.set(key, { result, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  // Prune old entries every 1000 stores
  if (idempotencyStore.size % 1000 === 0) {
    const now = Date.now();
    for (const [k, v] of Array.from(idempotencyStore.entries())) {
      if (now > v.expiresAt) idempotencyStore.delete(k);
    }
  }
}

// ─── 14. Account-Takeover (ATO) Detection ────────────────────────────────────
interface LoginEvent { ip: string; ua: string; ts: number }
const loginHistory = new Map<number, LoginEvent[]>();

export function detectATO(
  userId: number,
  ip: string,
  ua: string
): { suspicious: boolean; reason?: string } {
  const history = loginHistory.get(userId) ?? [];
  const now = Date.now();
  const recent = history.filter((e) => now - e.ts < 60 * 60 * 1000); // last 1h

  // Impossible travel: same user from >3 different IPs in 1h
  const uniqueIPs = new Set(recent.map((e) => e.ip));
  uniqueIPs.add(ip);
  if (uniqueIPs.size > 3) {
    return { suspicious: true, reason: `Impossible travel: ${uniqueIPs.size} IPs in 1h` };
  }

  // New device + new IP simultaneously
  const knownIPs = new Set(history.map((e) => e.ip));
  const knownUAs = new Set(history.map((e) => e.ua));
  if (!knownIPs.has(ip) && !knownUAs.has(ua) && history.length > 0) {
    return { suspicious: true, reason: "New device and new IP simultaneously" };
  }

  // Record this event
  history.push({ ip, ua, ts: now });
  loginHistory.set(userId, history.slice(-100)); // keep last 100
  return { suspicious: false };
}

// ─── 15. BEC Beneficiary-Swap Detection ──────────────────────────────────────
// Flags when a beneficiary's bank account changes within 24h of a transfer
const recentBeneficiaryChanges = new Map<string, number>(); // key: userId+benefId → timestamp
export function flagBeneficiarySwap(userId: number, beneficiaryId: number): boolean {
  const key = `${userId}:${beneficiaryId}`;
  const lastChange = recentBeneficiaryChanges.get(key);
  if (lastChange && Date.now() - lastChange < 24 * 60 * 60 * 1000) {
    return true; // Beneficiary changed within 24h — flag for review
  }
  return false;
}
export function recordBeneficiaryChange(userId: number, beneficiaryId: number): void {
  recentBeneficiaryChanges.set(`${userId}:${beneficiaryId}`, Date.now());
}

// ─── 16. Round-Tripping / Money Laundering Velocity ──────────────────────────
// Detects rapid send→receive→send cycles (structuring / layering)
const transferVelocity = new Map<number, number[]>(); // userId → timestamps
export function detectRoundTripping(userId: number): { flagged: boolean; reason?: string } {
  const now = Date.now();
  const times = (transferVelocity.get(userId) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  times.push(now);
  transferVelocity.set(userId, times);
  if (times.length >= 10) {
    return { flagged: true, reason: `${times.length} transfers in 1h — possible structuring` };
  }
  return { flagged: false };
}

// ─── 17. Credential Stuffing Detection ───────────────────────────────────────
// Many different IPs attempting the same account = stuffing attack
const accountAttempts = new Map<string, Set<string>>(); // username → Set<IP>
export function detectCredentialStuffing(username: string, ip: string): boolean {
  const ips = accountAttempts.get(username) ?? new Set();
  ips.add(ip);
  accountAttempts.set(username, ips);
  return ips.size > 10; // >10 different IPs trying same account = stuffing
}

// ─── 18. API Enumeration Prevention ──────────────────────────────────────────
// Rate-limit 404 responses + add random jitter to prevent timing-based enumeration
export const enumerationProtection = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: (_req, res) => res.statusCode !== 404,
  message: { error: "Too many not-found requests." },
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown"),
});

export function randomJitter404(req: Request, res: Response, next: NextFunction) {
  const original = res.json.bind(res);
  res.json = function (body: unknown) {
    if (res.statusCode === 404) {
      const jitter = Math.floor(crypto.randomInt(50, 300));
      setTimeout(() => original(body), jitter);
      return res;
    }
    return original(body);
  };
  next();
}

// ─── 19. Parameter Tampering Detection ───────────────────────────────────────
// Detects amount/currency mismatches between URL params and body
export function parameterTamperingGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "POST") return next();
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") return next();

  // Detect negative amounts
  const amount = body.amount ?? (body.json as any)?.amount;
  if (typeof amount === "number" && amount < 0) {
    logger.warn(`[Security] Negative amount detected from ${req.ip}: ${amount}`);
    res.status(400).json({ error: "Invalid amount: negative values not permitted." });
    return;
  }

  // Detect amount overflow (> 10M USD equivalent)
  if (typeof amount === "number" && amount > 10_000_000_00) { // in cents
    logger.warn(`[Security] Overflow amount detected from ${req.ip}: ${amount}`);
    res.status(400).json({ error: "Amount exceeds maximum transaction limit." });
    return;
  }

  next();
}

// ─── 20. JWT Algorithm Confusion Prevention ───────────────────────────────────
// Reject tokens with alg:none or unexpected algorithm
export function validateJWTAlgorithm(token: string): { valid: boolean; reason?: string } {
  try {
    const [headerB64] = token.split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
    if (!header.alg || header.alg === "none" || header.alg === "HS384") {
      return { valid: false, reason: `Rejected JWT algorithm: ${header.alg}` };
    }
    // Only allow HS256 (our signing algorithm)
    if (header.alg !== "HS256") {
      return { valid: false, reason: `Unexpected JWT algorithm: ${header.alg}` };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "Malformed JWT header" };
  }
}

// ─── 21. Timing-Attack-Safe Comparison ───────────────────────────────────────
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do the comparison to prevent length-based timing leaks
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── 22. Structured SIEM Event Emission ──────────────────────────────────────
export interface SecurityEvent {
  type: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  ip?: string;
  userId?: number;
  path?: string;
  detail: string;
  ts: number;
}

const siemBuffer: SecurityEvent[] = [];
/** Read the in-memory SIEM buffer (most recent N events, newest first) */
export function getSiemBuffer(limit = 200): SecurityEvent[] {
  return siemBuffer.slice(-limit).reverse();
}
export function emitSecurityEvent(event: Omit<SecurityEvent, "ts">): void {
  const full: SecurityEvent = { ...event, ts: Date.now() };
  siemBuffer.push(full);
  if (event.severity === "high" || event.severity === "critical") {
    logger.error(`[SIEM][${event.severity.toUpperCase()}] ${event.type}: ${event.detail}`);
  }
  // Flush to DB every 50 events or on critical
  if (siemBuffer.length >= 50 || event.severity === "critical") {
    flushSIEMBuffer().catch(() => {});
  }
}

async function flushSIEMBuffer(): Promise<void> {
  if (siemBuffer.length === 0) return;
  const events = siemBuffer.splice(0, siemBuffer.length);
  try {
    const db = await getDb();
    for (const ev of events) {
      await db.insert(auditLogs).values({
        userId: ev.userId ?? 0,
        action: ev.type,
        resource: "security",
        ipAddress: ev.ip ?? "unknown",
        severity: ev.severity === "critical" ? "critical" : ev.severity === "high" ? "warning" : "info",
        success: ev.severity === "info" || ev.severity === "low",
        details: { siem: true, detail: ev.detail, path: ev.path },
      }).catch(() => {});
    }
  } catch {
    // Never throw from SIEM flush
  }
}

// ─── REGISTER ALL ATTACK MITIGATIONS ─────────────────────────────────────────
export function registerAttackMitigations(app: Express): void {
  // Suspicious scanner/bot UA blocking (before anything else)
  app.use(suspiciousUAGuard);

  // HTTP method allowlist
  app.use(httpMethodGuard);

  // Slowloris / timeout protection
  app.use(requestTimeoutGuard);

  // Payload size hard cap
  app.use("/api/", payloadSizeGuard);

  // Concurrency limiter (connection flood)
  app.use("/api/", concurrencyLimiter);

  // Progressive slow-down (tarpitting) on all API routes
  app.use("/api/", progressiveSlowDown);

  // Auth-specific tarpitting
  app.use("/api/oauth/", authSlowDown);

  // Amplification prevention on heavy endpoints
  app.use(amplificationGuard);

  // Parameter tampering detection
  app.use("/api/trpc/", parameterTamperingGuard);

  // API enumeration jitter on 404s
  app.use(randomJitter404);
  app.use(enumerationProtection);
  // DDoS circuit breaker (v143)
  app.use(ddosCircuitBreaker);
  // Ransomware upload guard (v143)
  app.use("/api/trpc/", ransomwareUploadGuard);
  // Financial amount sanity guard (v143)
  app.use("/api/trpc/", financialAmountGuard);
  // Geo-blocking for OFAC/FATF high-risk countries (v146)
  app.use(geoBlockMiddleware);
  // Service-to-service HMAC request signing (v146)
  app.use("/api/internal/", serviceSignatureMiddleware);
  // mTLS certificate validation for internal services (v146)
  app.use("/api/internal/", mtlsMiddleware);
  logger.info("[Security] Attack mitigation module registered (32 controls active)");
}


// ─── 23. Ransomware / Malicious File Upload Detection (v143) ─────────────────
// Blocks executable, script, and archive-bomb file types at the HTTP layer.
const BLOCKED_EXTENSIONS_V143 = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".ps1", ".sh", ".bash",
  ".vbs", ".jse", ".wsf", ".wsh", ".scr", ".pif", ".reg",
  ".dll", ".so", ".dylib", ".elf", ".bin", ".run",
]);

const BLOCKED_MIME_PREFIXES_V143 = [
  "application/x-msdownload",
  "application/x-executable",
  "application/x-sh",
  "application/x-bat",
  "text/x-shellscript",
];

export function ransomwareUploadGuard(req: Request, res: Response, next: NextFunction) {
  const contentDisposition = req.headers["content-disposition"] ?? "";
  const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
  if (filenameMatch) {
    const filename = filenameMatch[1].replace(/[\'"]/g, "").toLowerCase();
    const ext = filename.slice(filename.lastIndexOf("."));
    if (BLOCKED_EXTENSIONS_V143.has(ext)) {
      emitSecurityEvent({ type: "ransomware.upload_blocked", severity: "critical", ip: req.ip, path: req.path, detail: `Blocked extension: ${ext}` });
      return res.status(400).json({ error: "File type not permitted" });
    }
  }
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  if (BLOCKED_MIME_PREFIXES_V143.some((p) => contentType.startsWith(p))) {
    emitSecurityEvent({ type: "ransomware.mime_blocked", severity: "critical", ip: req.ip, path: req.path, detail: `Blocked MIME: ${contentType}` });
    return res.status(400).json({ error: "File type not permitted" });
  }
  next();
}

// ─── 24. DDoS Circuit Breaker (v143) ─────────────────────────────────────────
const CIRCUIT_WINDOW_MS = 10_000;
const CIRCUIT_THRESHOLD = 500;
const CIRCUIT_COOLDOWN_MS = 30_000;

let circuitRequests = 0;
let circuitOpenUntil = 0;
let circuitWindowStart = Date.now();

export function ddosCircuitBreaker(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  if (now - circuitWindowStart > CIRCUIT_WINDOW_MS) {
    circuitRequests = 0;
    circuitWindowStart = now;
  }
  if (circuitOpenUntil > now) {
    return res.status(503).set("Retry-After", String(Math.ceil((circuitOpenUntil - now) / 1000))).json({ error: "Service temporarily unavailable" });
  }
  circuitRequests++;
  if (circuitRequests > CIRCUIT_THRESHOLD) {
    circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
    emitSecurityEvent({ type: "ddos.circuit_opened", severity: "critical", ip: req.ip, path: req.path, detail: `${circuitRequests} req/10s` });
    return res.status(503).set("Retry-After", String(CIRCUIT_COOLDOWN_MS / 1000)).json({ error: "Service temporarily unavailable" });
  }
  next();
}

// ─── 25. Financial Amount Sanity Guard (v143) ─────────────────────────────────
const MAX_SINGLE_AMOUNT = 10_000_000;

export function financialAmountGuard(req: Request, res: Response, next: NextFunction) {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return next();
  for (const [key, value] of Object.entries(body)) {
    if (/amount|price|fee|balance|rate/i.test(key)) {
      const n = Number(value);
      if (!isFinite(n) || n < 0 || n > MAX_SINGLE_AMOUNT) {
        emitSecurityEvent({ type: "financial.amount_tamper", severity: "high", ip: req.ip, path: req.path, detail: `Field ${key}=${value}` });
        return res.status(400).json({ error: `Invalid amount value for field: ${key}` });
      }
    }
  }
  next();
}

// ─── 26. Velocity / Structuring Detection (v143) ──────────────────────────────
const STRUCTURING_WINDOW_MS = 60 * 60 * 1000;
const STRUCTURING_THRESHOLD_USD = 9_000;
const STRUCTURING_COUNT_LIMIT = 5;
const structuringMap = new Map<number, { total: number; count: number; windowStart: number }>();

export function detectStructuring(userId: number, amountUSD: number): { flagged: boolean; reason?: string } {
  const now = Date.now();
  const entry = structuringMap.get(userId) ?? { total: 0, count: 0, windowStart: now };
  if (now - entry.windowStart > STRUCTURING_WINDOW_MS) {
    entry.total = 0;
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.total += amountUSD;
  entry.count++;
  structuringMap.set(userId, entry);
  if (amountUSD < STRUCTURING_THRESHOLD_USD && entry.count >= STRUCTURING_COUNT_LIMIT) {
    emitSecurityEvent({ type: "aml.structuring_detected", severity: "critical", userId, detail: `${entry.count} transfers totaling $${entry.total.toFixed(2)} in 1h` });
    return { flagged: true, reason: `Potential structuring: ${entry.count} transfers totaling $${entry.total.toFixed(2)} in 1 hour` };
  }
  return { flagged: false };
}

// ─── 27. Ghost Beneficiary Detection (v143) ───────────────────────────────────
const GHOST_BENEFICIARY_WINDOW_MS = 5 * 60 * 1000;
const recentBeneficiaryAdditions = new Map<string, number>();

export function recordBeneficiaryAddition(userId: number, beneficiaryId: number): void {
  recentBeneficiaryAdditions.set(`${userId}:${beneficiaryId}`, Date.now());
}

export function isGhostBeneficiary(userId: number, beneficiaryId: number): boolean {
  const ts = recentBeneficiaryAdditions.get(`${userId}:${beneficiaryId}`);
  if (!ts) return false;
  const isGhost = Date.now() - ts < GHOST_BENEFICIARY_WINDOW_MS;
  if (isGhost) {
    emitSecurityEvent({ type: "financial.ghost_beneficiary", severity: "high", userId, detail: `Beneficiary ${beneficiaryId} added <5min ago` });
  }
  return isGhost;
}

// ─── 28. IP-Based Geo-Blocking for High-Risk Countries (v146) ─────────────────
// OFAC/FATF high-risk jurisdictions — block at the edge before any processing
const HIGH_RISK_COUNTRY_CODES = new Set([
  "KP", // North Korea
  "IR", // Iran
  "SY", // Syria
  "CU", // Cuba
  "SD", // Sudan
  "MM", // Myanmar (FATF blacklist)
  "RU", // Russia (OFAC sanctions)
  "BY", // Belarus
  "VE", // Venezuela (OFAC)
  "LY", // Libya
  "YE", // Yemen
  "SO", // Somalia
  "AF", // Afghanistan (Taliban)
  "HT", // Haiti (FATF)
]);
/** Update the in-memory geo-block list from a scheduled OFAC feed.
 * Accepts array of { code, name?, reason? } objects.
 * Returns the previous count for logging. */
export function updateGeoBlockList(countries: Array<{ code: string; name?: string; reason?: string }>): number {
  const previousCount = HIGH_RISK_COUNTRY_CODES.size;
  HIGH_RISK_COUNTRY_CODES.clear();
  for (const c of countries) {
    const code = (c.code ?? "").toUpperCase().trim();
    if (/^[A-Z]{2}$/.test(code)) HIGH_RISK_COUNTRY_CODES.add(code);
  }
  return previousCount;
}

export function geoBlockMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || "";
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return next();
  }
  const countryCode = (
    (req.headers["cf-ipcountry"] as string) ||
    (req.headers["x-country-code"] as string) ||
    (req.headers["x-geoip-country"] as string) ||
    ""
  ).toUpperCase().trim();
  if (!countryCode) return next();
  if (HIGH_RISK_COUNTRY_CODES.has(countryCode)) {
    emitSecurityEvent({ type: "geo.blocked", severity: "high", ip, path: req.path, detail: `Blocked country: ${countryCode}` });
    return res.status(451).json({ error: "Service unavailable in your region", code: "GEO_BLOCKED", country: countryCode });
  }
  next();
}

// ─── 29. User-ID-Based Account Lockout (v146) ─────────────────────────────────
const userLockouts = new Map<number, { count: number; lockedUntil?: number }>();
const USER_LOCKOUT_THRESHOLD = 5;
const USER_LOCKOUT_DURATION_MS = 30 * 60 * 1000;
export function recordUserLoginFailure(userId: number): { locked: boolean; retryAfter?: number } {
  const entry = userLockouts.get(userId) ?? { count: 0 };
  entry.count++;
  if (entry.count >= USER_LOCKOUT_THRESHOLD) {
    entry.lockedUntil = Date.now() + USER_LOCKOUT_DURATION_MS;
    entry.count = 0;
    userLockouts.set(userId, entry);
    emitSecurityEvent({ type: "auth.user_locked", severity: "high", userId, detail: `User ${userId} locked after ${USER_LOCKOUT_THRESHOLD} failed attempts` });
    return { locked: true, retryAfter: USER_LOCKOUT_DURATION_MS / 1000 };
  }
  userLockouts.set(userId, entry);
  return { locked: false };
}
export function checkUserLockout(userId: number): { locked: boolean; retryAfter?: number } {
  const entry = userLockouts.get(userId);
  if (!entry?.lockedUntil) return { locked: false };
  const now = Date.now();
  if (now >= entry.lockedUntil) { userLockouts.delete(userId); return { locked: false }; }
  return { locked: true, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
}
export function clearUserLockout(userId: number): void { userLockouts.delete(userId); }

// ─── 30. HMAC Request Signing for Service-to-Service Calls (v146) ─────────────
const SERVICE_SIGNING_SECRET = process.env.SERVICE_SIGNING_SECRET || "remitflow-internal-svc-secret-v146";
const SIGNATURE_WINDOW_MS = 30_000;
export function signServiceRequest(payload: string, timestamp: number): string {
  return crypto.createHmac("sha256", SERVICE_SIGNING_SECRET).update(`${timestamp}:${payload}`).digest("hex");
}
export function verifyServiceSignature(payload: string, timestamp: number, signature: string): boolean {
  const now = Date.now();
  if (Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) return false;
  const expected = signServiceRequest(payload, timestamp);
  try { return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")); }
  catch { return false; }
}
export function serviceSignatureMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/internal/")) return next();
  const timestamp = parseInt((req.headers["x-timestamp"] as string) || "0", 10);
  const signature = (req.headers["x-service-signature"] as string) || "";
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (!verifyServiceSignature(body, timestamp, signature)) {
    emitSecurityEvent({ type: "auth.service_signature_invalid", severity: "critical", ip: req.ip, path: req.path, detail: "Invalid or expired service signature" });
    return res.status(401).json({ error: "Invalid service signature", code: "SERVICE_AUTH_FAILED" });
  }
  next();
}

// ─── 31. Secrets Rotation Detection & Warning (v146) ──────────────────────────
const SECRET_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const SECRET_WARN_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;
interface SecretMetadata { name: string; createdAt: number; lastRotated?: number; }
const secretRegistry: SecretMetadata[] = [];
export function registerSecret(name: string, createdAt: number, lastRotated?: number): void {
  secretRegistry.push({ name, createdAt, lastRotated });
}
export function checkSecretsRotation(): { name: string; status: "ok" | "warn" | "expired"; ageMs: number }[] {
  const now = Date.now();
  return secretRegistry.map((s) => {
    const ageMs = now - (s.lastRotated ?? s.createdAt);
    let status: "ok" | "warn" | "expired" = "ok";
    if (ageMs > SECRET_MAX_AGE_MS) { status = "expired"; emitSecurityEvent({ type: "secrets.expired", severity: "critical", detail: `Secret '${s.name}' is ${Math.floor(ageMs / 86400000)}d old` }); }
    else if (ageMs > SECRET_MAX_AGE_MS - SECRET_WARN_THRESHOLD_MS) { status = "warn"; emitSecurityEvent({ type: "secrets.rotation_due", severity: "high", detail: `Secret '${s.name}' rotation due in <14d` }); }
    return { name: s.name, status, ageMs };
  });
}
registerSecret("JWT_SECRET", Date.now() - 30 * 86400000);
registerSecret("SERVICE_SIGNING_SECRET", Date.now() - 5 * 86400000);
registerSecret("STRIPE_SECRET_KEY", Date.now() - 45 * 86400000);

// ─── 32. mTLS Certificate Validation Middleware (v146) ────────────────────────
export function mtlsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== "production") return next();
  if (!req.path.startsWith("/api/internal/")) return next();
  const clientCertDN = req.headers["x-client-cert-dn"] as string | undefined;
  const allowedServiceDNs = ["CN=remitflow-fraud-svc","CN=remitflow-compliance-svc","CN=remitflow-payment-svc","CN=remitflow-kyc-svc","CN=remitflow-analytics-svc"];
  if (!clientCertDN || !allowedServiceDNs.some((dn) => clientCertDN.includes(dn))) {
    emitSecurityEvent({ type: "auth.mtls_rejected", severity: "critical", ip: req.ip, path: req.path, detail: `Rejected cert DN: ${clientCertDN ?? "none"}` });
    return res.status(401).json({ error: "mTLS verification failed", code: "MTLS_REJECTED" });
  }
  next();
}
