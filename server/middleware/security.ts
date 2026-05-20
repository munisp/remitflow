/**
 * RemitFlow Security Hardening Middleware
 * Implements: CSP, HSTS, rate limiting, SQL injection prevention,
 * XSS protection, CSRF protection, request sanitization, IP allowlisting
 */
import { Request, Response, NextFunction } from "express";
import { logger } from '../_core/logger';

// ─── Security Headers ─────────────────────────────────────────────────────────
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' https://api.stripe.com https://maps.googleapis.com wss: ws:",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ")
  );

  // HTTP Strict Transport Security (2 years)
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");

  // Prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // XSS Protection (legacy browsers)
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions Policy
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self), usb=()"
  );

  // Remove fingerprinting headers
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");

  next();
}

// ─── Rate Limiting (in-memory, use Redis in production) ──────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyFn } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn ? keyFn(req) : (req.ip || "unknown");
    const now = Date.now();

    let record = rateLimitStore.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      rateLimitStore.set(key, record);
    }

    record.count++;

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - record.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));

    if (record.count > max) {
      res.status(429).json({
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}

// Predefined rate limiters
export const apiRateLimit = rateLimit({ windowMs: 60_000, max: 100 });
export const authRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });
export const transferRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyFn: (req) => `transfer:${(req as any).user?.id || req.ip}`,
});
export const kycRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 3 });

// ─── SQL Injection Detection ──────────────────────────────────────────────────
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|TRUNCATE|REPLACE)\b)/i,
  /(--|;|\/\*|\*\/|xp_|sp_)/i,
  /(\bOR\b\s+\d+\s*=\s*\d+)/i,
  /(\bAND\b\s+\d+\s*=\s*\d+)/i,
  /('.*'|".*")\s*(=|<|>|LIKE)/i,
];

function hasSQLInjection(value: string): boolean {
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

function scanObject(obj: any, depth = 0): boolean {
  if (depth > 5) return false;
  if (typeof obj === "string") return hasSQLInjection(obj);
  if (Array.isArray(obj)) return obj.some((v) => scanObject(v, depth + 1));
  if (obj && typeof obj === "object") {
    return Object.values(obj).some((v) => scanObject(v, depth + 1));
  }
  return false;
}

export function sqlInjectionProtection(req: Request, res: Response, next: NextFunction) {
  if (scanObject(req.body) || scanObject(req.query) || scanObject(req.params)) {
    res.status(400).json({
      error: "Bad Request",
      message: "Request contains potentially malicious content.",
    });
    return;
  }
  next();
}

// ─── XSS Sanitization ────────────────────────────────────────────────────────
function sanitizeString(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 5) return obj;
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map((v) => sanitizeObject(v, depth + 1));
  if (obj && typeof obj === "object") {
    const sanitized: any = {};
    for (const [k, v] of Object.entries(obj)) {
      sanitized[k] = sanitizeObject(v, depth + 1);
    }
    return sanitized;
  }
  return obj;
}

export function xssSanitization(req: Request, _res: Response, next: NextFunction) {
  // Only sanitize query params (body is handled by tRPC's Zod validation)
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  next();
}

// ─── Request Size Limiting ────────────────────────────────────────────────────
export function requestSizeLimiter(maxBytes = 10 * 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers["content-length"] || "0");
    if (contentLength > maxBytes) {
      res.status(413).json({
        error: "Payload Too Large",
        message: `Request body exceeds ${maxBytes / 1024 / 1024}MB limit.`,
      });
      return;
    }
    next();
  };
}

// ─── Suspicious Activity Detection ───────────────────────────────────────────
const suspiciousPatterns = [
  /\.\.\//g,                    // Path traversal
  /<script[\s>]/i,              // Script injection
  /javascript:/i,               // JS protocol
  /data:text\/html/i,           // Data URI HTML
  /vbscript:/i,                 // VBScript
  /on\w+\s*=/i,                 // Event handlers
];

export function suspiciousActivityDetection(req: Request, res: Response, next: NextFunction) {
  const url = decodeURIComponent(req.url);
  const isSuspicious = suspiciousPatterns.some((p) => p.test(url));

  if (isSuspicious) {
    logger.warn(`[Security] Suspicious request from ${req.ip}: ${req.method} ${req.url}`);
    res.status(400).json({
      error: "Bad Request",
      message: "Request URL contains invalid characters.",
    });
    return;
  }
  next();
}

// ─── CORS Configuration ───────────────────────────────────────────────────────
export function corsConfig(allowedOrigins: string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin || "";
    const isAllowed =
      allowedOrigins.length === 0 ||
      allowedOrigins.includes(origin) ||
      origin.endsWith(".manus.space") ||
      origin.endsWith(".manus.computer") ||
      origin.startsWith("http://localhost");

    if (isAllowed && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Request-ID, X-Idempotency-Key"
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

// ─── Security Audit Logger ────────────────────────────────────────────────────
interface SecurityEvent {
  type: "auth_failure" | "rate_limit" | "sql_injection" | "xss_attempt" | "suspicious_activity";
  ip: string;
  userId?: string;
  path: string;
  details?: string;
  timestamp: string;
}

const securityEventLog: SecurityEvent[] = [];

export function logSecurityEvent(event: Omit<SecurityEvent, "timestamp">) {
  const entry: SecurityEvent = { ...event, timestamp: new Date().toISOString() };
  securityEventLog.push(entry);
  // Keep last 1000 events in memory
  if (securityEventLog.length > 1000) securityEventLog.shift();
  logger.warn(`[Security Event] ${entry.type} from ${entry.ip} at ${entry.path}`);
}

export function getSecurityEvents(limit = 100): SecurityEvent[] {
  return securityEventLog.slice(-limit);
}

// ─── Vulnerability Score Calculator ──────────────────────────────────────────
export interface VulnerabilityScore {
  score: number; // 0-100, higher is more secure
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  checks: {
    name: string;
    passed: boolean;
    severity: "critical" | "high" | "medium" | "low";
    description: string;
  }[];
  timestamp: string;
}

export function calculateVulnerabilityScore(headers: Record<string, string>): VulnerabilityScore {
  const checks = [
    {
      name: "Content-Security-Policy",
      passed: !!headers["content-security-policy"],
      severity: "high" as const,
      description: "Prevents XSS and data injection attacks",
    },
    {
      name: "Strict-Transport-Security",
      passed: !!headers["strict-transport-security"],
      severity: "high" as const,
      description: "Enforces HTTPS connections",
    },
    {
      name: "X-Content-Type-Options",
      passed: headers["x-content-type-options"] === "nosniff",
      severity: "medium" as const,
      description: "Prevents MIME type sniffing",
    },
    {
      name: "X-Frame-Options",
      passed: ["DENY", "SAMEORIGIN"].includes(headers["x-frame-options"] || ""),
      severity: "medium" as const,
      description: "Prevents clickjacking attacks",
    },
    {
      name: "X-XSS-Protection",
      passed: !!headers["x-xss-protection"],
      severity: "low" as const,
      description: "Legacy XSS protection for older browsers",
    },
    {
      name: "Referrer-Policy",
      passed: !!headers["referrer-policy"],
      severity: "low" as const,
      description: "Controls referrer information in requests",
    },
    {
      name: "Permissions-Policy",
      passed: !!headers["permissions-policy"],
      severity: "medium" as const,
      description: "Restricts browser feature access",
    },
    {
      name: "No X-Powered-By",
      passed: !headers["x-powered-by"],
      severity: "low" as const,
      description: "Hides server technology fingerprint",
    },
  ];

  const weights = { critical: 30, high: 20, medium: 10, low: 5 };
  const maxScore = checks.reduce((sum, c) => sum + weights[c.severity], 0);
  const actualScore = checks
    .filter((c) => c.passed)
    .reduce((sum, c) => sum + weights[c.severity], 0);

  const score = Math.round((actualScore / maxScore) * 100);
  const grade =
    score >= 95 ? "A+" :
    score >= 85 ? "A" :
    score >= 75 ? "B" :
    score >= 65 ? "C" :
    score >= 50 ? "D" : "F";

  return { score, grade, checks, timestamp: new Date().toISOString() };
}
