/**
 * Content Security Policy and security headers middleware.
 * P0 Security 5.3 — strict CSP, security headers.
 */
import type { Request, Response, NextFunction } from "express";

const NONCE_BYTES = 16;

function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

interface CspConfig {
  reportUri?: string;
  reportOnly?: boolean;
  enableUnsafeInline?: boolean;
}

export function cspMiddleware(config: CspConfig = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const nonce = generateNonce();
    (res as Response & { locals: { cspNonce: string } }).locals.cspNonce = nonce;

    const scriptSrc = config.enableUnsafeInline
      ? `'self' 'nonce-${nonce}' 'unsafe-inline'`
      : `'self' 'nonce-${nonce}'`;

    const directives = [
      `default-src 'self'`,
      `script-src ${scriptSrc}`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' https://fonts.gstatic.com`,
      `img-src 'self' data: blob: https:`,
      `connect-src 'self' https: wss:`,
      `frame-src 'none'`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `frame-ancestors 'none'`,
      `upgrade-insecure-requests`,
    ];

    if (config.reportUri) {
      directives.push(`report-uri ${config.reportUri}`);
    }

    const headerName = config.reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy";
    res.setHeader(headerName, directives.join("; "));

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Download-Options", "noopen");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");

    next();
  };
}

export function corsConfig(allowedOrigins: string[]) {
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Request-ID", "X-Correlation-ID"],
    exposedHeaders: ["X-Request-ID", "X-Correlation-ID", "X-RateLimit-Remaining"],
    maxAge: 86400,
  };
}
