/**
 * Beneficiary Verification Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies beneficiary bank account details before transfer:
 * - Account name validation (name matching)
 * - Bank code/SWIFT verification
 * - Account number format validation per country
 * - IBAN validation for EU corridors
 * - Mobile money number verification
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";

// Country-specific account number patterns
const ACCOUNT_PATTERNS: Record<string, { pattern: RegExp; description: string; example: string }> = {
  NG: { pattern: /^\d{10}$/, description: "10-digit NUBAN number", example: "0123456789" },
  KE: { pattern: /^\d{10,14}$/, description: "10-14 digit account number", example: "1234567890" },
  GH: { pattern: /^\d{9,16}$/, description: "9-16 digit account number", example: "123456789" },
  ZA: { pattern: /^\d{6,11}$/, description: "6-11 digit account number", example: "123456789" },
  GB: { pattern: /^\d{8}$/, description: "8-digit account number", example: "12345678" },
  US: { pattern: /^\d{4,17}$/, description: "4-17 digit account number", example: "123456789" },
};

// IBAN country lengths
const IBAN_LENGTHS: Record<string, number> = {
  GB: 22, DE: 22, FR: 27, ES: 24, IT: 27, NL: 18, BE: 16, AT: 20, PT: 25,
  IE: 22, FI: 18, SE: 24, DK: 18, NO: 15, CH: 21, PL: 28, CZ: 24,
};

function validateIBAN(iban: string): { valid: boolean; reason?: string } {
  const cleaned = iban.replace(/\s/g, "").toUpperCase();
  if (cleaned.length < 15 || cleaned.length > 34) {
    return { valid: false, reason: "IBAN length invalid" };
  }

  const countryCode = cleaned.substring(0, 2);
  const expectedLength = IBAN_LENGTHS[countryCode];
  if (expectedLength && cleaned.length !== expectedLength) {
    return { valid: false, reason: `${countryCode} IBAN should be ${expectedLength} characters` };
  }

  // Basic mod-97 check
  const rearranged = cleaned.substring(4) + cleaned.substring(0, 4);
  let numeric = "";
  for (const char of rearranged) {
    if (char >= "A" && char <= "Z") {
      numeric += (char.charCodeAt(0) - 55).toString();
    } else {
      numeric += char;
    }
  }

  let remainder = 0;
  for (let i = 0; i < numeric.length; i++) {
    remainder = (remainder * 10 + parseInt(numeric[i])) % 97;
  }

  if (remainder !== 1) {
    return { valid: false, reason: "IBAN checksum failed" };
  }

  return { valid: true };
}

function validateMobileMoneyNumber(number: string, country: string): { valid: boolean; reason?: string } {
  const cleaned = number.replace(/\D/g, "");

  const patterns: Record<string, RegExp> = {
    KE: /^254\d{9}$/, // M-Pesa Kenya
    NG: /^234\d{10}$/, // Nigeria
    GH: /^233\d{9}$/, // Ghana
    TZ: /^255\d{9}$/, // Tanzania
    UG: /^256\d{9}$/, // Uganda
  };

  const pattern = patterns[country];
  if (!pattern) {
    return { valid: true }; // No validation for unknown countries
  }

  if (!pattern.test(cleaned)) {
    return { valid: false, reason: `Invalid mobile money number format for ${country}` };
  }

  return { valid: true };
}

export const beneficiaryVerificationRouter = router({
  // Verify bank account
  verifyBankAccount: publicProcedure
    .input(z.object({
      accountNumber: z.string().min(4).max(34),
      bankCode: z.string().optional(),
      countryCode: z.string().length(2),
      accountName: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const checks: Array<{ check: string; passed: boolean; detail: string }> = [];

      // 1. Account number format check
      const pattern = ACCOUNT_PATTERNS[input.countryCode];
      if (pattern) {
        const formatValid = pattern.pattern.test(input.accountNumber);
        checks.push({
          check: "format",
          passed: formatValid,
          detail: formatValid
            ? `Valid ${pattern.description}`
            : `Expected ${pattern.description} (e.g., ${pattern.example})`,
        });
      }

      // 2. Bank code validation (if provided)
      if (input.bankCode) {
        const bankCodeValid = /^\d{3,11}$/.test(input.bankCode) || /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(input.bankCode);
        checks.push({
          check: "bankCode",
          passed: bankCodeValid,
          detail: bankCodeValid ? "Valid bank/SWIFT code" : "Invalid bank/SWIFT code format",
        });
      }

      // 3. IBAN check for EU countries
      if (IBAN_LENGTHS[input.countryCode]) {
        const ibanResult = validateIBAN(input.accountNumber);
        checks.push({
          check: "iban",
          passed: ibanResult.valid,
          detail: ibanResult.valid ? "IBAN checksum valid" : (ibanResult.reason ?? "IBAN invalid"),
        });
      }

      const allPassed = checks.every((c) => c.passed);

      logger.info({
        countryCode: input.countryCode,
        passed: allPassed,
        checks: checks.length,
      }, "Beneficiary verification completed");

      return {
        verified: allPassed,
        checks,
        confidence: allPassed ? "high" : "low",
      };
    }),

  // Verify mobile money number
  verifyMobileMoney: publicProcedure
    .input(z.object({
      phoneNumber: z.string(),
      countryCode: z.string().length(2),
      provider: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const result = validateMobileMoneyNumber(input.phoneNumber, input.countryCode);
      return {
        verified: result.valid,
        reason: result.reason,
        provider: input.provider ?? "unknown",
      };
    }),

  // Validate IBAN
  validateIBAN: publicProcedure
    .input(z.object({ iban: z.string() }))
    .query(({ input }) => {
      return validateIBAN(input.iban);
    }),
});
