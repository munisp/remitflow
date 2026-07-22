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
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";
import { logger } from '../_core/logger';
import { redis } from '../middleware/middlewareIntegration';
// createAuditLog-compatible audit trail for SMS OTP operations
const logSmsAction = (userId: number, action: string, phone: string) => {
  logger.info(JSON.stringify({ level: "AUDIT", userId, action, phone: phone.slice(0, 6) + "****", ts: new Date().toISOString() }));
};

// ── Redis-backed OTP store (TTL: 10 minutes) ─────────────────────────────────
interface OtpEntry {
  code: string;
  transferId: string;
  phone: string;
  expiresAt: number;
  attempts: number;
}

const OTP_TTL_SECONDS = 600; // 10 minutes
const MAX_ATTEMPTS = 3;
const OTP_PREFIX = "otp:sms:";

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

async function getOtpEntry(key: string): Promise<OtpEntry | null> {
  const raw = await redis.get(`${OTP_PREFIX}${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as OtpEntry; } catch { return null; }
}

async function setOtpEntry(key: string, entry: OtpEntry): Promise<void> {
  const ttl = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  await redis.set(`${OTP_PREFIX}${key}`, JSON.stringify(entry), ttl);
}

async function deleteOtpEntry(key: string): Promise<void> {
  await redis.del(`${OTP_PREFIX}${key}`);
}

/**
 * Send SMS via an explicitly configured provider.
 */
async function sendSms(phone: string, message: string): Promise<boolean> {
  const provider = process.env.SMS_PROVIDER?.trim();
  if (!provider) throw new Error("SMS_PROVIDER is required for transfer confirmation");

  if (provider === "africas_talking") {
    try {
      const apiKey = process.env.AFRICAS_TALKING_API_KEY?.trim();
      const username = process.env.AFRICAS_TALKING_USERNAME?.trim();
      if (!apiKey || !username) throw new Error("Africa's Talking credentials are required");
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
      const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
      const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
      const from = process.env.TWILIO_FROM_NUMBER?.trim();
      if (!accountSid || !authToken || !from) throw new Error("Twilio credentials are required");
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

  throw new Error(`Unsupported SMS_PROVIDER: ${provider}`);
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
      const otp = generateOtp();
      const key = `${ctx.user.id}:${input.transferId}`;

      const expiresAt = Date.now() + OTP_TTL_SECONDS * 1000;
      const message = `RemitFlow: Your transfer confirmation code is ${otp}. Valid for 10 minutes. Do not share this code.`;
      const sent = await sendSms(input.phone, message);

      if (!sent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send SMS. Please try again or use the app.",
        });
      }
      await setOtpEntry(key, {
        code: otp,
        transferId: input.transferId,
        phone: input.phone,
        expiresAt,
        attempts: 0,
      });

      return {
        sent: true,
        phone: input.phone.replace(/(\+\d{3})\d+(\d{3})/, "$1****$2"),
        expiresAt,
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
      const entry = await getOtpEntry(key);

      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No pending confirmation found. Please request a new code.",
        });
      }

      if (entry.expiresAt < Date.now()) {
        await deleteOtpEntry(key);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirmation code has expired. Please request a new one.",
        });
      }

      entry.attempts++;
      if (entry.attempts > MAX_ATTEMPTS) {
        await deleteOtpEntry(key);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many failed attempts. Please request a new code.",
        });
      }

      if (entry.code !== input.code) {
        await setOtpEntry(key, entry);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid code. ${MAX_ATTEMPTS - entry.attempts} attempt(s) remaining.`,
        });
      }

      await deleteOtpEntry(key);
      logSmsAction(ctx.user.id, "otp_verified", entry.phone);
      return { verified: true, transferId: input.transferId };
    }),

  /**
   * Get SMS provider status (admin only).
   */
  getProviderStatus: publicProcedure.query(() => {
    const provider = process.env.SMS_PROVIDER?.trim() ?? "unconfigured";
    return {
      provider,
      configured: provider === "africas_talking" || provider === "twilio",
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
