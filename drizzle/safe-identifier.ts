/**
 * RemitFlow — Safe SQL Identifier Utilities
 * ═══════════════════════════════════════════════════════════════════════════
 * Patches CVE-2026-39356: SQL Injection via improperly escaped SQL identifiers
 * in Drizzle ORM's sql.identifier() and .as() APIs.
 *
 * CVE-2026-39356 (CVSS 8.8 — High):
 *   Drizzle ORM prior to 0.45.2 did not escape embedded delimiter characters
 *   inside quoted identifiers. An attacker supplying a malicious identifier
 *   (e.g., `foo" OR 1=1--`) could break out of the quoted context and inject
 *   arbitrary SQL.
 *
 * Mitigation (defense-in-depth, even on patched 0.45.2):
 *   1. Validate all identifiers against a strict allowlist regex BEFORE
 *      passing them to Drizzle's sql.identifier() or .as().
 *   2. Reject any identifier containing quote characters, semicolons, or
 *      comment sequences.
 *   3. Enforce a maximum identifier length (PostgreSQL max is 63 bytes).
 *
 * Usage:
 *   import { safeIdentifier, safeAlias } from "@/drizzle/safe-identifier";
 *   const col = safeIdentifier(userInput);  // throws if unsafe
 *   const q = db.select().from(table).as(safeAlias(userInput));
 */

// ─── Allowlist Pattern ────────────────────────────────────────────────────────

/**
 * PostgreSQL identifier allowlist:
 * - Must start with a letter or underscore
 * - Can contain letters, digits, underscores, and dollar signs
 * - Maximum 63 characters (PostgreSQL NAMEDATALEN - 1)
 * - No quotes, semicolons, dashes, spaces, or comment sequences
 */
const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/;

/** Dangerous patterns that should never appear in identifiers */
const DANGEROUS_PATTERNS = [
  '"',   // Double quote — can break out of quoted identifier
  "'",   // Single quote — SQL string delimiter
  ";",   // Statement terminator
  "--",  // SQL comment
  "/*",  // Block comment start
  "*/",  // Block comment end
  "\0",  // Null byte
  "\n",  // Newline
  "\r",  // Carriage return
  "\\",  // Backslash
];

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate and return a safe SQL identifier string.
 * Throws a TypeError if the identifier is unsafe.
 *
 * @param identifier - The raw identifier string (e.g., column name, table alias)
 * @returns The validated identifier string
 * @throws TypeError if the identifier contains dangerous characters or patterns
 */
export function safeIdentifier(identifier: unknown): string {
  if (typeof identifier !== "string") {
    throw new TypeError(
      `SQL identifier must be a string, got: ${typeof identifier}`
    );
  }

  if (identifier.length === 0) {
    throw new TypeError("SQL identifier cannot be empty");
  }

  if (identifier.length > 63) {
    throw new TypeError(
      `SQL identifier exceeds maximum length of 63 characters: "${identifier.slice(0, 20)}..."`
    );
  }

  // Check for dangerous patterns first (fast path)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (identifier.includes(pattern)) {
      throw new TypeError(
        `SQL identifier contains dangerous pattern "${pattern}": "${identifier}"`
      );
    }
  }

  // Enforce allowlist regex
  if (!SAFE_IDENTIFIER_REGEX.test(identifier)) {
    throw new TypeError(
      `SQL identifier contains invalid characters. ` +
      `Only letters, digits, underscores, and dollar signs are allowed. ` +
      `Got: "${identifier}"`
    );
  }

  return identifier;
}

/**
 * Validate and return a safe SQL alias.
 * Aliases follow the same rules as identifiers.
 */
export function safeAlias(alias: unknown): string {
  return safeIdentifier(alias);
}

/**
 * Validate a list of identifiers (e.g., for dynamic column selection).
 * Returns the validated array or throws on the first invalid identifier.
 */
export function safeIdentifiers(identifiers: unknown[]): string[] {
  return identifiers.map((id, i) => {
    try {
      return safeIdentifier(id);
    } catch (err) {
      throw new TypeError(
        `Invalid SQL identifier at index ${i}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

/**
 * Check if an identifier is safe without throwing.
 * Useful for conditional validation.
 */
export function isIdentifierSafe(identifier: unknown): identifier is string {
  try {
    safeIdentifier(identifier);
    return true;
  } catch {
    return false;
  }
}
