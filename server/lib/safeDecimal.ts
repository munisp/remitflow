/**
 * Deterministic fixed-point utilities for monetary values.
 *
 * Persisted balances are represented as decimal strings. These helpers avoid
 * binary floating-point arithmetic when comparing, adding, subtracting, or
 * multiplying monetary amounts. Results retain the requested decimal scale.
 */
export type DecimalInput = string | number | bigint;

function assertPrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) {
    throw new Error(`Invalid decimal precision: ${precision}`);
  }
}

function normalizeInput(value: DecimalInput): string {
  const input = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(input)) {
    throw new Error(`Invalid decimal amount: ${input}`);
  }
  return input;
}

function toScaled(value: DecimalInput, precision: number): bigint {
  assertPrecision(precision);
  const input = normalizeInput(value);
  const negative = input.startsWith("-");
  const unsigned = input.replace(/^[+-]/, "");
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const factor = 10n ** BigInt(precision);
  const truncated = fractionPart.slice(0, precision).padEnd(precision, "0");
  let scaled = BigInt(wholePart) * factor + BigInt(truncated || "0");

  // Round half up from the first discarded decimal place.
  if (fractionPart.length > precision && fractionPart[precision] >= "5") {
    scaled += 1n;
  }
  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint, precision: number): string {
  assertPrecision(precision);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  if (precision === 0) return `${negative ? "-" : ""}${absolute}`;
  const factor = 10n ** BigInt(precision);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(precision, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Safely parse an external amount for non-persistence display calculations. */
export function safeParseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  try {
    const normalized = normalizeInput(value);
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Add two amounts using fixed-point arithmetic. */
export function safeAdd(a: DecimalInput, b: DecimalInput, precision = 8): string {
  return fromScaled(toScaled(a, precision) + toScaled(b, precision), precision);
}

/** Subtract two amounts using fixed-point arithmetic. */
export function safeSubtract(a: DecimalInput, b: DecimalInput, precision = 8): string {
  return fromScaled(toScaled(a, precision) - toScaled(b, precision), precision);
}

/** Multiply two amounts using fixed-point arithmetic and half-up rounding. */
export function safeMultiply(a: DecimalInput, b: DecimalInput, precision = 8): string {
  assertPrecision(precision);
  const factor = 10n ** BigInt(precision);
  const product = toScaled(a, precision) * toScaled(b, precision);
  const quotient = product / factor;
  const remainder = product % factor;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const rounded = absoluteRemainder * 2n >= factor
    ? quotient + (product < 0n ? -1n : 1n)
    : quotient;
  return fromScaled(rounded, precision);
}

/** Compare two amounts without converting them to JavaScript floating point. */
export function safeCompare(a: DecimalInput, b: DecimalInput, precision = 8): number {
  const left = toScaled(a, precision);
  const right = toScaled(b, precision);
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Compatibility aliases used by active financial routers. */
export const addMoney = safeAdd;
export const subtractMoney = safeSubtract;
export const multiplyMoney = safeMultiply;
export const compareMoney = safeCompare;

export function isPositive(value: DecimalInput | null | undefined, precision = 8): boolean {
  return value !== null && value !== undefined && toScaled(value, precision) > 0n;
}

/** Format a validated monetary input to an exact decimal scale. */
export function formatAmount(value: DecimalInput, precision = 2): string {
  return fromScaled(toScaled(value, precision), precision);
}
