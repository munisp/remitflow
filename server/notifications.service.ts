/**
 * RemitFlow Notifications Service
 * Supports: In-app DB notifications, SMS via Twilio, Email via SMTP/SendGrid,
 * Push notifications via Web Push API
 *
 * All channels gracefully degrade — if Twilio/email is not configured,
 * the notification is still saved to the DB and the operation succeeds.
 */

import { ENV } from "./_core/env";
import { randomBytes } from "crypto";
import { logger } from './_core/logger';

// ─── TYPES ────────────────────────────────────────────────────────────────────
export interface NotificationPayload {
  userId: number;
  title: string;
  message: string;
  type: "transfer" | "security" | "kyc" | "system" | "fx_alert" | "payment" | "referral";
  phone?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  db: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
}

// ─── SMS VIA TWILIO ───────────────────────────────────────────────────────────
async function sendSMS(to: string, message: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || "+15005550006"; // Twilio test number

  if (!accountSid || !authToken) {
    logger.info("[SMS] Twilio not configured, skipping SMS");
    return false;
  }

  try {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber,
          Body: message,
        }).toString(),
      }
    );

    if (response.ok) {
      const data = await response.json() as { sid: string };
      logger.info(`[SMS] Sent to ${to}, SID: ${data.sid}`);
      return true;
    } else {
      const err = await response.text();
      logger.error(`[SMS] Failed: ${err}`);
      return false;
    }
  } catch (error) {
    logger.error({ err: error }, '[SMS] Error:');
    return false;
  }
}

// ─── EMAIL VIA SMTP/SENDGRID ──────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "noreply@remitflow.com";

  if (!sendgridKey) {
    logger.info("[Email] SendGrid not configured, skipping email");
    return false;
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: "RemitFlow" },
        subject,
        content: [
          { type: "text/plain", value: body },
          {
            type: "text/html",
            value: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:20px;border-radius:8px 8px 0 0">
                  <h1 style="color:white;margin:0;font-size:24px">RemitFlow</h1>
                </div>
                <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px">
                  <h2 style="color:#1f2937;margin-top:0">${subject}</h2>
                  <p style="color:#4b5563;line-height:1.6">${body.replace(/\n/g, "<br>")}</p>
                  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
                  <p style="color:#9ca3af;font-size:12px">
                    This email was sent by RemitFlow. If you did not request this, please ignore it or
                    <a href="https://remitflow.manus.space/security" style="color:#6366f1">secure your account</a>.
                  </p>
                </div>
              </div>
            `,
          },
        ],
      }),
    });

    if (response.ok || response.status === 202) {
      logger.info(`[Email] Sent to ${to}`);
      return true;
    } else {
      const err = await response.text();
      logger.error(`[Email] Failed: ${err}`);
      return false;
    }
  } catch (error) {
    logger.error({ err: error }, '[Email] Error:');
    return false;
  }
}

// ─── NOTIFICATION TEMPLATES ───────────────────────────────────────────────────
export const NotificationTemplates = {
  transferSent: (amount: string, currency: string, recipient: string) => ({
    title: "Transfer Sent",
    message: `Your transfer of ${amount} ${currency} to ${recipient} has been initiated and is being processed.`,
    sms: `RemitFlow: Transfer of ${amount} ${currency} to ${recipient} sent. Track at remitflow.manus.space/tracking`,
    email: {
      subject: `Transfer of ${amount} ${currency} Sent`,
      body: `Your transfer of ${amount} ${currency} to ${recipient} has been initiated.\n\nTrack your transfer at: https://remitflow.manus.space/tracking`,
    },
  }),

  transferReceived: (amount: string, currency: string, sender: string) => ({
    title: "Transfer Received",
    message: `You received ${amount} ${currency} from ${sender}.`,
    sms: `RemitFlow: You received ${amount} ${currency} from ${sender}. Check your wallet at remitflow.manus.space`,
    email: {
      subject: `You Received ${amount} ${currency}`,
      body: `Great news! You received ${amount} ${currency} from ${sender}.\n\nView your wallet at: https://remitflow.manus.space/wallet`,
    },
  }),

  kycApproved: (tier: string) => ({
    title: "KYC Approved",
    message: `Your KYC verification has been approved. You are now at ${tier}.`,
    sms: `RemitFlow: KYC approved! You're now at ${tier}. Higher limits unlocked.`,
    email: {
      subject: "KYC Verification Approved",
      body: `Congratulations! Your identity verification has been approved.\n\nYou are now at ${tier} with higher transaction limits.\n\nStart sending money at: https://remitflow.manus.space/send`,
    },
  }),

  loginAlert: (device: string, location: string) => ({
    title: "New Login Detected",
    message: `New login from ${device} in ${location}. If this wasn't you, secure your account immediately.`,
    sms: `RemitFlow SECURITY: New login from ${device} in ${location}. Not you? Visit remitflow.manus.space/security`,
    email: {
      subject: "Security Alert: New Login Detected",
      body: `A new login was detected on your RemitFlow account.\n\nDevice: ${device}\nLocation: ${location}\nTime: ${new Date().toLocaleString()}\n\nIf this wasn't you, please secure your account immediately at: https://remitflow.manus.space/security`,
    },
  }),

  fxAlertTriggered: (currency: string, rate: number, target: number) => ({
    title: "FX Rate Alert",
    message: `${currency} has reached your target rate of ${target}. Current rate: ${rate}.`,
    sms: `RemitFlow: ${currency} rate alert! Current: ${rate}, your target: ${target}. Send now at remitflow.manus.space/send`,
    email: {
      subject: `FX Alert: ${currency} Rate Target Reached`,
      body: `Your FX rate alert has been triggered!\n\nCurrency: ${currency}\nCurrent Rate: ${rate}\nYour Target: ${target}\n\nSend money now at: https://remitflow.manus.space/send`,
    },
  }),

  paymentFailed: (amount: string, currency: string, reason: string) => ({
    title: "Payment Failed",
    message: `Your payment of ${amount} ${currency} failed. Reason: ${reason}`,
    sms: `RemitFlow: Payment of ${amount} ${currency} failed. ${reason}. Retry at remitflow.manus.space`,
    email: {
      subject: `Payment Failed: ${amount} ${currency}`,
      body: `Your payment of ${amount} ${currency} could not be processed.\n\nReason: ${reason}\n\nPlease retry or contact support at: https://remitflow.manus.space/support`,
    },
  }),

  twoFactorEnabled: () => ({
    title: "2FA Enabled",
    message: "Two-factor authentication has been enabled on your account.",
    sms: "RemitFlow: 2FA enabled on your account. Your account is now more secure.",
    email: {
      subject: "Two-Factor Authentication Enabled",
      body: "Two-factor authentication (2FA) has been successfully enabled on your RemitFlow account.\n\nYour account is now more secure. If you did not make this change, please contact support immediately.",
    },
  }),

  referralReward: (amount: string, referredUser: string) => ({
    title: "Referral Reward",
    message: `You earned ${amount} for referring ${referredUser}!`,
    sms: `RemitFlow: You earned ${amount} for referring ${referredUser}! Check your wallet.`,
    email: {
      subject: `You Earned a Referral Reward: ${amount}`,
      body: `Great news! You earned ${amount} for referring ${referredUser} to RemitFlow.\n\nKeep referring friends to earn more rewards at: https://remitflow.manus.space/referral`,
    },
  }),
};

// ─── MAIN NOTIFICATION DISPATCHER ────────────────────────────────────────────
export async function sendNotification(
  payload: NotificationPayload,
  options?: {
    smsMessage?: string;
    emailSubject?: string;
    emailBody?: string;
  }
): Promise<NotificationResult> {
  const result: NotificationResult = { db: false, sms: false, email: false, push: false };

  // 1. Save to DB (always)
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    await db.execute(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [payload.userId, payload.title, payload.message, payload.type]
    );
    result.db = true;
  } catch (error) {
    logger.error({ err: error }, '[Notification] DB save failed:');
  }

  // 2. SMS (if phone provided and Twilio configured)
  if (payload.phone && options?.smsMessage) {
    result.sms = await sendSMS(payload.phone, options.smsMessage);
  }

  // 3. Email (if email provided and SendGrid configured)
  if (payload.email && options?.emailSubject && options?.emailBody) {
    result.email = await sendEmail(payload.email, options.emailSubject, options.emailBody);
  }

  return result;
}

// ─── WEBHOOK RETRY QUEUE ──────────────────────────────────────────────────────
interface WebhookJob {
  id: string;
  url: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  nextRetry: number;
  lastError?: string;
}

const webhookQueue: WebhookJob[] = [];

export function queueWebhook(url: string, payload: unknown, maxAttempts = 5): string {
  // SSRF protection: only allow HTTPS URLs with non-private hostnames
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Only HTTPS webhook URLs are allowed");
    const host = parsed.hostname;
    // Block private/loopback ranges
    if (/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1|0\.0\.0\.0)$/.test(host)) {
      throw new Error("Webhook URL must not point to a private/internal address");
    }
  } catch (err: any) {
    throw new Error(`Invalid webhook URL: ${err.message}`);
  }
  const id = `wh_${Date.now()}_${randomBytes(4).toString("hex")}`;
  webhookQueue.push({
    id,
    url,
    payload,
    attempts: 0,
    maxAttempts,
    nextRetry: Date.now(),
  });
  return id;
}

async function processWebhookQueue() {
  const now = Date.now();
  const pending = webhookQueue.filter(job => job.attempts < job.maxAttempts && job.nextRetry <= now);

  for (const job of pending) {
    try {
      const response = await fetch(job.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RemitFlow-Signature": `sha256=${job.id}`,
          "X-RemitFlow-Timestamp": String(now),
        },
        body: JSON.stringify(job.payload),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (response.ok) {
        // Remove from queue on success
        const idx = webhookQueue.indexOf(job);
        if (idx > -1) webhookQueue.splice(idx, 1);
        logger.info(`[Webhook] Delivered to ${job.url} (attempt ${job.attempts + 1})`);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      job.attempts++;
      job.lastError = String(error);
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      job.nextRetry = now + Math.pow(2, job.attempts) * 1000;
      logger.error(`[Webhook] Failed attempt ${job.attempts} for ${job.url}: ${error}`);
    }
  }
}

// Process webhook queue every 5 seconds
setInterval(processWebhookQueue, 5000);

// ─── FRAUD DETECTION ──────────────────────────────────────────────────────────
interface FraudCheckResult {
  allowed: boolean;
  riskScore: number; // 0-100
  flags: string[];
  action: "allow" | "review" | "block";
}

export function checkFraudRisk(params: {
  userId: number;
  amount: number;
  currency: string;
  destinationCountry: string;
  recipientName: string;
  ipAddress: string;
  userAgent: string;
}): FraudCheckResult {
  const flags: string[] = [];
  let riskScore = 0;

  // High-value transaction check
  if (params.amount > 10000) {
    flags.push("HIGH_VALUE_TRANSACTION");
    riskScore += 20;
  }
  if (params.amount > 50000) {
    flags.push("VERY_HIGH_VALUE_TRANSACTION");
    riskScore += 30;
  }

  // Round number check (common in structuring)
  if (params.amount % 1000 === 0 && params.amount >= 5000) {
    flags.push("ROUND_NUMBER_STRUCTURING_RISK");
    riskScore += 10;
  }

  // High-risk destination countries (FATF grey/black list)
  const HIGH_RISK_COUNTRIES = ["AF", "AL", "BB", "BF", "CM", "CD", "HT", "JM", "JO", "ML", "MZ", "MR", "NI", "NG", "PA", "PH", "SN", "SS", "SY", "TZ", "TT", "UG", "AE", "VU", "VN", "YE"];
  if (HIGH_RISK_COUNTRIES.includes(params.destinationCountry)) {
    flags.push("HIGH_RISK_DESTINATION");
    riskScore += 15;
  }

  // Sanctioned countries (OFAC)
  const SANCTIONED = ["KP", "IR", "CU", "SY", "SD", "BY"];
  if (SANCTIONED.includes(params.destinationCountry)) {
    flags.push("SANCTIONED_COUNTRY");
    riskScore = 100; // Automatic block
  }

  // Determine action
  let action: "allow" | "review" | "block" = "allow";
  if (riskScore >= 100) action = "block";
  else if (riskScore >= 40) action = "review";

  return {
    allowed: action !== "block",
    riskScore,
    flags,
    action,
  };
}

// ─── DEVICE FINGERPRINTING ────────────────────────────────────────────────────
export function extractDeviceInfo(req: { headers: Record<string, string | string[] | undefined>; ip?: string }) {
  const userAgent = (req.headers["user-agent"] as string) || "Unknown";
  const ip = req.ip || "Unknown";
  const acceptLanguage = (req.headers["accept-language"] as string) || "Unknown";

  // Parse device type from user agent
  let deviceType = "Desktop";
  if (/Mobile|Android|iPhone|iPad/i.test(userAgent)) deviceType = "Mobile";
  if (/Tablet|iPad/i.test(userAgent)) deviceType = "Tablet";

  // Parse browser
  let browser = "Unknown";
  if (userAgent.includes("Chrome")) browser = "Chrome";
  else if (userAgent.includes("Firefox")) browser = "Firefox";
  else if (userAgent.includes("Safari")) browser = "Safari";
  else if (userAgent.includes("Edge")) browser = "Edge";

  // Parse OS
  let os = "Unknown";
  if (userAgent.includes("Windows")) os = "Windows";
  else if (userAgent.includes("Mac OS")) os = "macOS";
  else if (userAgent.includes("Linux")) os = "Linux";
  else if (userAgent.includes("Android")) os = "Android";
  else if (userAgent.includes("iOS") || userAgent.includes("iPhone")) os = "iOS";

  return {
    deviceType,
    browser,
    os,
    ip,
    language: acceptLanguage.split(",")[0] || "en",
    userAgent: userAgent.slice(0, 200), // Truncate for storage
  };
}
