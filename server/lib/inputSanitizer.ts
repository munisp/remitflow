/**
 * Input sanitization utilities for XSS, SQL injection, and SSRF protection.
 * P0 Security 5.2 — sanitize all user-facing string inputs.
 */
import { z } from "zod";

const HTML_ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#96;",
};

const HTML_RE = /[&<>"'`/]/g;

export function escapeHtml(str: string): string {
  return str.replace(HTML_RE, (ch) => HTML_ENTITY_MAP[ch] ?? ch);
}

const SCRIPT_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /data:\s*text\/html/i,
  /expression\s*\(/i,
  /vbscript:/i,
];

export function containsXss(input: string): boolean {
  return SCRIPT_PATTERNS.some((p) => p.test(input));
}

export function sanitizeString(input: string): string {
  let clean = input.trim();
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (containsXss(clean)) {
    clean = escapeHtml(clean);
  }
  return clean;
}

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd/i,
  /^localhost$/i,
];

export function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return PRIVATE_IP_RANGES.some((re) => re.test(parsed.hostname));
  } catch {
    return true;
  }
}

export function validateWebhookUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (!["https:"].includes(parsed.protocol)) {
      return { valid: false, reason: "Only HTTPS URLs allowed" };
    }
    if (isPrivateUrl(url)) {
      return { valid: false, reason: "Private/internal URLs not allowed" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }
}

export const sanitizedString = (maxLen = 500) =>
  z
    .string()
    .max(maxLen)
    .transform((s) => sanitizeString(s));

export const sanitizedEmail = () =>
  z
    .string()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase().trim());

export const amountSchema = z.number().positive().finite().max(1_000_000_000);

export const currencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Must be ISO 4217 currency code");

export const phoneSchema = z
  .string()
  .min(7)
  .max(20)
  .regex(/^\+?[\d\s\-()]+$/, "Invalid phone number format");

export const paginationSchema = z.object({
  page: z.number().int().min(1).max(10000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
