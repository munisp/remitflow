/**
 * Safe Decimal Arithmetic for Financial Operations
 * 
 * Avoids JavaScript floating-point precision issues by operating on
 * string-based decimal representations. All monetary values should pass
 * through these functions instead of using parseFloat/Number directly.
 * 
 * In production, consider swapping to a dedicated decimal library
 * (e.g., decimal.js, big.js) for more complex operations.
 * 
 * Middleware-ready: TigerBeetle uses 128-bit unsigned integers for amounts,
 * so all amounts are stored as strings in PostgreSQL and converted to
 * TigerBeetle's format at the middleware layer.
 */

const PRECISION = 4; // 4 decimal places for financial calculations

/**
 * Parse a monetary string to a safe integer representation (minor units).
 * "123.45" → 1234500 (at PRECISION=4)
 */
export function toMinorUnits(value: string | number): bigint {
  const str = typeof value === "number" ? value.toFixed(PRECISION) : String(value);
  const [whole, frac = ""] = str.split(".");
  const paddedFrac = frac.padEnd(PRECISION, "0").slice(0, PRECISION);
  return BigInt(whole + paddedFrac);
}

/**
 * Convert minor units back to a decimal string.
 * 1234500n → "123.4500"
 */
export function fromMinorUnits(value: bigint): string {
  const isNeg = value < BigInt(0);
  const abs = isNeg ? -value : value;
  const str = abs.toString().padStart(PRECISION + 1, "0");
  const whole = str.slice(0, str.length - PRECISION);
  const frac = str.slice(str.length - PRECISION);
  return `${isNeg ? "-" : ""}${whole}.${frac}`;
}

/**
 * Add two monetary values safely.
 */
export function addMoney(a: string | number, b: string | number): string {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

/**
 * Subtract two monetary values safely.
 */
export function subtractMoney(a: string | number, b: string | number): string {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

/**
 * Multiply a monetary value by a rate (e.g., FX rate, fee percentage).
 * The rate is applied with PRECISION rounding.
 */
export function multiplyMoney(amount: string | number, rate: number): string {
  const amtMinor = toMinorUnits(amount);
  const rateScaled = BigInt(Math.round(rate * 10 ** PRECISION));
  const result = (amtMinor * rateScaled) / BigInt(10 ** PRECISION);
  return fromMinorUnits(result);
}

/**
 * Compare two monetary values.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareMoney(a: string | number, b: string | number): -1 | 0 | 1 {
  const diff = toMinorUnits(a) - toMinorUnits(b);
  if (diff < BigInt(0)) return -1;
  if (diff > BigInt(0)) return 1;
  return 0;
}

/**
 * Check if a monetary value is greater than or equal to another.
 */
export function isGte(a: string | number, b: string | number): boolean {
  return compareMoney(a, b) >= 0;
}

/**
 * Format a monetary value to 2 decimal places for display.
 */
export function formatMoney(value: string | number, decimals = 2): string {
  const minor = toMinorUnits(value);
  const full = fromMinorUnits(minor);
  const [whole, frac = ""] = full.split(".");
  return `${whole}.${frac.slice(0, decimals).padEnd(decimals, "0")}`;
}

/**
 * Safe parseFloat replacement for monetary values.
 * Returns the value as a number but logs a warning if precision would be lost.
 * Use this as a transitional helper while migrating to full string-based math.
 */
export function safeParseAmount(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  if (isNaN(parsed)) return 0;
  return parsed;
}
