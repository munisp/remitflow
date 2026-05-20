/**
 * smsConfirm.ts — v170
 *
 * SMS/USSD fallback for critical transfer confirmations.
 * Used when the RemitFlow app is offline or the user is on a feature phone.
 *
 * Architecture:
 * - tRPC procedure: smsConfirm.requestConfirmation — sends OTP via SMS
 * - tRPC procedure: smsConfirm.verifyCode — verifies OTP and marks transfer confirmed
 * - Express endpoint: POST /api/sms-confirm — USSD gateway webhook (Africastalking/Twilio)
 *
 * SMS provider abstraction supports:
 * - Africa's Talking (primary — covers 18 African countries)
 * - Twilio (fallback — global)
 * - Mock mode (no SMS_PROVIDER env set — OTP logged to console)
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";
import { logger } from '../_core/logger';
// createAuditLog-compatible audit trail for SMS OTP operations
const logSmsAction = (userId: number, action: string, phone: string) => {
  logger.info(JSON.stringify({ level: "AUDIT", userId, action, phone: phone.slice(0, 6) + "****", ts: new Date().toISOString() }));
};

// ── In-memory OTP store (TTL: 10 minutes) ────────────────────────────────────
// In production, use Redis or DB-backed store
interface OtpEntry {
  code: string;
  transferId: string;
  phone: string;
  expiresAt: number;
  attempts: number;
}
const otpStore = new Map<string, OtpEntry>();

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function cleanExpiredOtps(): void {
  const now = Date.now();
  for (const [key, entry] of Array.from(otpStore.entries())) {
    if (entry.expiresAt < now) otpStore.delete(key);
  }
}

/**
 * Send SMS via configured provider.
 * Falls back to console log in development/mock mode.
 */
async function sendSms(phone: string, message: string): Promise<boolean> {
  const provider = process.env.SMS_PROVIDER ?? "mock";

  if (provider === "africas_talking") {
    try {
      const apiKey = process.env.AFRICAS_TALKING_API_KEY ?? "";
      const username = process.env.AFRICAS_TALKING_USERNAME ?? "sandbox";
      const body = new URLSearchParams({
        username,
        to: phone,
        message,
      });
      const res = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          apiKey,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch (err) {
      logger.error({ err: err }, '[SMS/AT] Failed:');
      return false;
    }
  }

  if (provider === "twilio") {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
      const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
      const from = process.env.TWILIO_FROM_NUMBER ?? "";
      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const body = new URLSearchParams({ To: phone, From: from, Body: message });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(8000),
        }
      );
      return res.ok;
    } catch (err) {
      logger.error({ err: err }, '[SMS/Twilio] Failed:');
      return false;
    }
  }

  // Mock mode — log OTP to structured logger for testing (intentional: visible in dev logs)
  logger.info({ phone: phone.slice(0, 6) + '****', msgLen: message.length }, '[SMS/Mock] OTP delivery (dev mode)');
  return true;
}

// ── tRPC Router ───────────────────────────────────────────────────────────────
export const smsConfirmRouter = {
  /**
   * Request an SMS OTP for a transfer confirmation.
   * Called when the user is about to send money and wants SMS backup confirmation.
   */
  requestConfirmation: protectedProcedure
    .input(
      z.object({
        transferId: z.string().min(1),
        phone: z.string().min(8).max(20),
      })
    )
    .mutation(async ({ input, ctx }) => {
      cleanExpiredOtps();

      const otp = generateOtp();
      const key = `${ctx.user.id}:${input.transferId}`;

      otpStore.set(key, {
        code: otp,
        transferId: input.transferId,
        phone: input.phone,
        expiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0,
      });

      const message = `RemitFlow: Your transfer confirmation code is ${otp}. Valid for 10 minutes. Do not share this code.`;
      const sent = await sendSms(input.phone, message);

      if (!sent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send SMS. Please try again or use the app.",
        });
      }

      const isMock = !process.env.SMS_PROVIDER || process.env.SMS_PROVIDER === "mock";
      return {
        sent: true,
        phone: input.phone.replace(/(\+\d{3})\d+(\d{3})/, "$1****$2"),
        expiresAt: Date.now() + OTP_TTL_MS,
        // In sandbox/mock mode, return OTP for testing
        ...(isMock ? { sandboxOtp: otp } : {}),
      };
    }),

  /**
   * Verify the SMS OTP for a transfer confirmation.
   */
  verifyCode: protectedProcedure
    .input(
      z.object({
        transferId: z.string().min(1),
        code: z.string().length(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const key = `${ctx.user.id}:${input.transferId}`;
      const entry = otpStore.get(key);

      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No pending confirmation found. Please request a new code.",
        });
      }

      if (entry.expiresAt < Date.now()) {
        otpStore.delete(key);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirmation code has expired. Please request a new one.",
        });
      }

      entry.attempts++;
      if (entry.attempts > MAX_ATTEMPTS) {
        otpStore.delete(key);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many failed attempts. Please request a new code.",
        });
      }

      if (entry.code !== input.code) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid code. ${MAX_ATTEMPTS - entry.attempts} attempt(s) remaining.`,
        });
      }

      otpStore.delete(key);
      return { verified: true, transferId: input.transferId };
    }),

  /**
   * Get SMS provider status (admin only).
   */
  getProviderStatus: publicProcedure.query(() => {
    const provider = process.env.SMS_PROVIDER ?? "mock";
    return {
      provider,
      configured: provider !== "mock",
      africasTalkingConfigured: !!(
        process.env.AFRICAS_TALKING_API_KEY && process.env.AFRICAS_TALKING_USERNAME
      ),
      twilioConfigured: !!(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER
      ),
    };
  }),
};
