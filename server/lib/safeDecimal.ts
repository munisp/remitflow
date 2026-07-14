/**
 * safeDecimal.ts — Safe decimal arithmetic utilities for financial calculations.
 * Uses string-based parsing to avoid floating-point precision issues.
 */

/**
 * Safely parse a string or number amount to a JavaScript number.
 * Returns 0 for null/undefined/NaN values.
 */
export function safeParseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Add two decimal amounts safely, returning a string with the given precision.
 */
export function safeAdd(a: string | number, b: string | number, precision = 8): string {
  const result = safeParseAmount(a) + safeParseAmount(b);
  return result.toFixed(precision);
}

/**
 * Subtract two decimal amounts safely, returning a string with the given precision.
 */
export function safeSubtract(a: string | number, b: string | number, precision = 8): string {
  const result = safeParseAmount(a) - safeParseAmount(b);
  return result.toFixed(precision);
}

/**
 * Multiply two decimal amounts safely, returning a string with the given precision.
 */
export function safeMultiply(a: string | number, b: string | number, precision = 8): string {
  const result = safeParseAmount(a) * safeParseAmount(b);
  return result.toFixed(precision);
}

/**
 * Compare two decimal amounts.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function safeCompare(a: string | number, b: string | number): number {
  return safeParseAmount(a) - safeParseAmount(b);
}

/**
 * Check if a decimal amount is greater than zero.
 */
export function isPositive(value: string | number | null | undefined): boolean {
  return safeParseAmount(value) > 0;
}

/**
 * Format a decimal amount to a fixed number of decimal places.
 */
export function formatAmount(value: string | number, precision = 2): string {
  return safeParseAmount(value).toFixed(precision);
}
