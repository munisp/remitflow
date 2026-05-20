/**
 * RemitFlow Email Service
 *
 * Sends transactional emails via Resend. Requires RESEND_API_KEY env var.
 * Falls back gracefully (logs warning) when the key is not configured so
 * the app still works in environments without email set up.
 */
import { ENV } from "./_core/env.js";
import { logger } from './_core/logger';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send a transactional email using Resend.
 * Returns true on success, false on failure (non-throwing).
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (!ENV.resendApiKey) {
    logger.warn("[Email] RESEND_API_KEY not configured — skipping email send");
    return false;
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(ENV.resendApiKey);
    const fromAddress = ENV.resendFromEmail.includes("@")
      ? ENV.resendFromEmail
      : `RemitFlow <${ENV.resendFromEmail}>`;
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    if (error) {
      logger.warn({ data: error.message }, '[Email] Resend error:');
      return false;
    }
    logger.info(`[Email] Sent "${payload.subject}" to ${payload.to}`);
    return true;
  } catch (err) {
    logger.warn({ data: err }, '[Email] Failed to send email:');
    return false;
  }
}

// ─── Shared HTML wrapper ──────────────────────────────────────────────────────
function emailWrapper(content: string, footer = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 32px;"><div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);"><div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 28px 32px 20px;"><h1 style="color: #fff; margin: 0; font-size: 20px; font-weight: 700;">RemitFlow</h1></div><div style="padding: 32px;">${content}</div><div style="padding: 16px 32px; background: #f9fafb; border-top: 1px solid #f3f4f6;"><p style="margin: 0; color: #9ca3af; font-size: 12px;">${footer || "RemitFlow — Cross-Border Remittance Platform. This is an automated message, please do not reply."}</p></div></div></body></html>`;
}

// ─── FX Rate Alert ────────────────────────────────────────────────────────────
export function buildFxAlertEmail(opts: {
  fromCurrency: string;
  toCurrency: string;
  targetRate: number;
  currentRate: number;
  direction: string;
}): { subject: string; html: string; text: string } {
  const { fromCurrency, toCurrency, targetRate, currentRate, direction } = opts;
  const appUrl = ENV.appUrl;
  const subject = `FX Alert Triggered: ${fromCurrency}/${toCurrency} has reached your target rate`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 32px;">
  <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px 32px 24px;">
      <h1 style="color: #fff; margin: 0; font-size: 22px; font-weight: 700;">FX Rate Alert Triggered</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Your target rate has been reached</p>
    </div>
    <div style="padding: 32px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Currency Pair</td><td style="padding: 10px 0; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${fromCurrency} / ${toCurrency}</td></tr>
        <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Your Target Rate</td><td style="padding: 10px 0; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${targetRate.toFixed(4)} (${direction})</td></tr>
        <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Current Rate</td><td style="padding: 10px 0; font-weight: 700; color: #10b981; text-align: right;">${currentRate.toFixed(4)}</td></tr>
      </table>
      <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
        The ${fromCurrency}/${toCurrency} exchange rate has moved ${direction} your target of <strong>${targetRate.toFixed(4)}</strong>.
        Log in to RemitFlow to take advantage of this rate now.
      </p>
      <a href="${appUrl}/send-money" style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">Send Money Now</a>
    </div>
    <div style="padding: 16px 32px; background: #f9fafb; border-top: 1px solid #f3f4f6;">
      <p style="margin: 0; color: #9ca3af; font-size: 12px;">
        You received this email because you set up an FX rate alert on RemitFlow.
        This alert has been deactivated. You can create a new alert from the FX Alerts page.
      </p>
    </div>
  </div>
</body>
</html>`;
  const text = `FX Alert Triggered: ${fromCurrency}/${toCurrency}\n\nYour target rate has been reached.\n\nCurrency Pair: ${fromCurrency}/${toCurrency}\nYour Target Rate: ${targetRate.toFixed(4)} (${direction})\nCurrent Rate: ${currentRate.toFixed(4)}\n\nLog in to RemitFlow to take advantage of this rate now: ${appUrl}/send-money\n\nThis alert has been deactivated.`;
  return { subject, html, text };
}

// ─── Transfer Confirmation ────────────────────────────────────────────────────
export function buildTransferConfirmationEmail(opts: {
  userName: string; amount: number; fromCurrency: string; toAmount: number;
  toCurrency: string; recipientName: string; fee: number; reference: string; estimatedTime?: string;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const subject = `Transfer Confirmed — ${opts.amount.toLocaleString()} ${opts.fromCurrency} to ${opts.recipientName}`;
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Transfer Confirmed ✓</h2>
    <p style="color: #374151; margin: 0 0 20px;">Hi ${opts.userName}, your transfer has been initiated successfully.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">You sent</td><td style="padding: 10px 0; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.amount.toLocaleString()} ${opts.fromCurrency}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Recipient receives</td><td style="padding: 10px 0; font-weight: 700; color: #10b981; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.toAmount.toLocaleString()} ${opts.toCurrency}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">To</td><td style="padding: 10px 0; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.recipientName}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Fee</td><td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.fee.toFixed(2)} ${opts.fromCurrency}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Reference</td><td style="padding: 10px 0; font-family: monospace; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.reference}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Estimated delivery</td><td style="padding: 10px 0; text-align: right;">${opts.estimatedTime ?? "1-3 business days"}</td></tr>
    </table>
    <a href="${appUrl}/transactions" style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">Track Transfer</a>`
  );
  const text = `Transfer Confirmed\nYou sent ${opts.amount} ${opts.fromCurrency} to ${opts.recipientName}.\nRecipient receives: ${opts.toAmount} ${opts.toCurrency}\nFee: ${opts.fee} ${opts.fromCurrency}\nReference: ${opts.reference}\nTrack: ${appUrl}/transactions`;
  return { subject, html, text };
}

// ─── KYC Status Update ────────────────────────────────────────────────────────
export function buildKycStatusEmail(opts: {
  userName: string; docType: string; status: "approved" | "rejected";
  rejectionReason?: string; newTier?: string;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const isApproved = opts.status === "approved";
  const subject = isApproved
    ? `KYC Document Approved — ${opts.docType}`
    : `KYC Document Requires Attention — ${opts.docType}`;
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">KYC Verification ${isApproved ? "Approved ✓" : "Update Required"}</h2>
    <p style="color: #374151; margin: 0 0 20px;">Hi ${opts.userName},</p>
    ${isApproved
      ? `<p style="color: #374151; margin: 0 0 20px;">Your <strong>${opts.docType}</strong> has been verified successfully.${opts.newTier ? ` Your account has been upgraded to <strong>${opts.newTier}</strong>.` : ""}</p>`
      : `<p style="color: #374151; margin: 0 0 20px;">We were unable to verify your <strong>${opts.docType}</strong>. ${opts.rejectionReason ? `Reason: <em>${opts.rejectionReason}</em>` : "Please re-upload a clearer copy."}</p>`
    }
    <a href="${appUrl}/kyc" style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">${isApproved ? "View Account" : "Re-upload Document"}</a>`
  );
  const text = `KYC ${isApproved ? "Approved" : "Rejected"}: ${opts.docType}. ${opts.rejectionReason ?? ""}`;
  return { subject, html, text };
}

// ─── Dispute Opened ───────────────────────────────────────────────────────────
export function buildDisputeOpenedEmail(opts: {
  userName: string; caseId: string; subject: string; slaHours: number;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const emailSubject = `Dispute Case Opened — ${opts.caseId}`;
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Dispute Case Opened</h2>
    <p style="color: #374151; margin: 0 0 20px;">Hi ${opts.userName}, we have received your dispute and our team will review it within <strong>${opts.slaHours} hours</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Case ID</td><td style="padding: 10px 0; font-family: monospace; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.caseId}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Subject</td><td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.subject}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px;">SLA</td><td style="padding: 10px 0; text-align: right;">Within ${opts.slaHours} hours</td></tr>
    </table>
    <a href="${appUrl}/disputes" style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">View Case</a>`
  );
  const text = `Dispute Case ${opts.caseId} opened. Subject: ${opts.subject}. We will respond within ${opts.slaHours} hours. View: ${appUrl}/disputes`;
  return { subject: emailSubject, html, text };
}

// ─── Wallet Top-Up Confirmation ───────────────────────────────────────────────
export function buildTopUpEmail(opts: {
  userName: string; amount: number; currency: string; method: string; newBalance: number;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const subject = `Wallet Credited — ${opts.amount.toLocaleString()} ${opts.currency}`;
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Wallet Credited ✓</h2>
    <p style="color: #374151; margin: 0 0 20px;">Hi ${opts.userName}, your ${opts.currency} wallet has been topped up.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Amount Added</td><td style="padding: 10px 0; font-weight: 700; color: #10b981; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.amount.toLocaleString()} ${opts.currency}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Method</td><td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.method}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px;">New Balance</td><td style="padding: 10px 0; font-weight: 600; text-align: right;">${opts.newBalance.toLocaleString()} ${opts.currency}</td></tr>
    </table>
    <a href="${appUrl}/wallet" style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">View Wallet</a>`
  );
  const text = `Wallet credited: ${opts.amount} ${opts.currency}. New balance: ${opts.newBalance} ${opts.currency}. View: ${appUrl}/wallet`;
  return { subject, html, text };
}

// ─── Welcome Email ────────────────────────────────────────────────────────────
export function buildWelcomeEmail(opts: {
  userName: string; email: string;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const subject = "Welcome to RemitFlow — Your Global Money Transfer Platform";
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Welcome to RemitFlow, ${opts.userName}! 🎉</h2>
    <p style="color: #374151; margin: 0 0 16px;">You're now part of a platform that makes cross-border money transfers fast, transparent, and affordable.</p>
    <p style="color: #374151; margin: 0 0 20px;"><strong>Get started in 3 steps:</strong></p>
    <ol style="color: #374151; margin: 0 0 24px; padding-left: 20px; line-height: 1.8;">
      <li>Complete your KYC verification to unlock higher transfer limits</li>
      <li>Add a beneficiary for the person you want to send money to</li>
      <li>Top up your wallet and send your first transfer</li>
    </ol>
    <a href="${appUrl}/kyc" style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">Complete KYC Verification</a>`,
    "You received this email because you created a RemitFlow account."
  );
  const text = `Welcome to RemitFlow, ${opts.userName}!\n\nGet started:\n1. Complete KYC: ${appUrl}/kyc\n2. Add a beneficiary: ${appUrl}/beneficiaries\n3. Send your first transfer: ${appUrl}/send-money`;
  return { subject, html, text };
}

// ─── Security Alert ───────────────────────────────────────────────────────────
export function buildSecurityAlertEmail(opts: {
  userName: string; event: string; details: string; ipAddress?: string; timestamp?: string;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const subject = `Security Alert — ${opts.event}`;
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Security Alert</h2>
    <p style="color: #374151; margin: 0 0 20px;">Hi ${opts.userName}, we detected a security event on your account.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Event</td><td style="padding: 10px 0; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.event}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Details</td><td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.details}</td></tr>
      ${opts.ipAddress ? `<tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">IP Address</td><td style="padding: 10px 0; font-family: monospace; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.ipAddress}</td></tr>` : ""}
      ${opts.timestamp ? `<tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Time</td><td style="padding: 10px 0; text-align: right;">${opts.timestamp}</td></tr>` : ""}
    </table>
    <p style="color: #374151; font-size: 14px; margin: 0 0 20px;">If this was you, no action is needed. If you did not perform this action, please secure your account immediately.</p>
    <a href="${appUrl}/settings/security" style="display: inline-block; background: #ef4444; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">Review Security Settings</a>`,
    "You received this security alert because your account had a notable security event."
  );
  const text = `Security Alert: ${opts.event}\n\nDetails: ${opts.details}\n${opts.ipAddress ? `IP: ${opts.ipAddress}\n` : ""}${opts.timestamp ? `Time: ${opts.timestamp}\n` : ""}\nReview your security settings: ${appUrl}/settings/security`;
  return { subject, html, text };
}

// ─── Weekly Community Fund Digest ─────────────────────────────────────────────
export interface FundDigestEntry {
  name: string;
  totalRaised: number;
  goalAmount: number;
  contributorCount: number;
  currency: string;
  activeProposals: number;
  topProposal?: string;
  topProposalVotesFor?: number;
  status: string;
}

export function buildWeeklyFundDigestEmail(opts: {
  userName: string;
  userEmail: string;
  funds: FundDigestEntry[];
  weekStart: string;
  weekEnd: string;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const { userName, funds, weekStart, weekEnd } = opts;
  const totalRaisedAll = funds.reduce((s, f) => s + f.totalRaised, 0);
  const totalProposals = funds.reduce((s, f) => s + f.activeProposals, 0);
  const fundRows = funds.map((f) => {
    const progress = f.goalAmount > 0 ? Math.min(100, Math.round((f.totalRaised / f.goalAmount) * 100)) : 0;
    return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:12px;"><div style="display:flex;justify-content:space-between;margin-bottom:4px;"><strong style="color:#111827;font-size:14px;">${f.name}</strong><span style="font-size:11px;color:#6b7280;background:#f9fafb;padding:2px 8px;border-radius:12px;">${f.status}</span></div><div style="background:#f3f4f6;border-radius:4px;height:6px;margin:4px 0 8px;"><div style="background:#6366f1;border-radius:4px;height:6px;width:${progress}%;"></div></div><div style="font-size:12px;color:#6b7280;">💰 <strong style="color:#111827;">$${f.totalRaised.toLocaleString()}</strong> raised &nbsp;👥 <strong style="color:#111827;">${f.contributorCount}</strong> contributors &nbsp;📋 <strong style="color:#111827;">${f.activeProposals}</strong> proposals &nbsp;📊 <strong style="color:#6366f1;">${progress}%</strong> of goal</div>${f.topProposal ? `<div style="margin-top:8px;padding:8px;background:#f9fafb;border-radius:6px;font-size:12px;color:#374151;">🗳️ Top proposal: <em>"${f.topProposal}"</em> — ${f.topProposalVotesFor ?? 0} YES votes</div>` : ""}</div>`;
  }).join("");
  const subject = `📊 Your Weekly Community Fund Digest — ${weekStart} to ${weekEnd}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;margin:0;padding:32px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 32px 20px;"><h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">RemitFlow</h1><p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Weekly Community Fund Digest</p></div><div style="padding:32px;"><h2 style="margin:0 0 8px;color:#111827;font-size:18px;">Weekly Fund Digest</h2><p style="color:#6b7280;font-size:13px;margin:0 0 20px;">Hi ${userName}, here's your community fund summary for <strong>${weekStart} – ${weekEnd}</strong>.</p><div style="display:flex;gap:12px;margin-bottom:20px;"><div style="flex:1;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:10px;padding:14px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#fff;">$${totalRaisedAll.toLocaleString()}</div><div style="font-size:11px;color:rgba(255,255,255,0.8);">Total Raised</div></div><div style="flex:1;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#111827;">${funds.length}</div><div style="font-size:11px;color:#6b7280;">Funds</div></div><div style="flex:1;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#111827;">${totalProposals}</div><div style="font-size:11px;color:#6b7280;">Proposals</div></div></div><h3 style="font-size:14px;color:#374151;margin:0 0 12px;">Your Funds</h3>${fundRows}<a href="${appUrl}/community" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;margin-top:8px;">View Community Funds →</a></div><div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #f3f4f6;"><p style="margin:0;color:#9ca3af;font-size:12px;">You received this digest because you contribute to community funds on RemitFlow. <a href="${appUrl}/settings" style="color:#6366f1;">Manage preferences</a></p></div></div></body></html>`;
  const text = `Weekly Community Fund Digest (${weekStart} – ${weekEnd})\n\nHi ${userName},\n\nTotal raised: $${totalRaisedAll.toLocaleString()} across ${funds.length} funds.\n${funds.map((f) => `• ${f.name}: $${f.totalRaised.toLocaleString()} raised, ${f.contributorCount} contributors, ${f.activeProposals} proposals`).join("\n")}\n\nView your funds: ${appUrl}/community`;
  return { subject, html, text };
}


// --- Document Vault Expiry Reminder ---
export function buildDocumentExpiryReminderEmail(opts: {
  userName: string;
  documentName: string;
  documentCategory: string;
  daysLeft: number;
  expiresAt: Date;
  appUrl?: string;
}): { subject: string; html: string; text: string } {
  const { userName, documentName, documentCategory, daysLeft, expiresAt } = opts;
  const url = opts.appUrl ?? process.env.APP_URL ?? "https://remitflow.example.com";
  const expiryStr = expiresAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const urgencyColor = daysLeft <= 1 ? "#dc2626" : daysLeft <= 3 ? "#ea580c" : daysLeft <= 7 ? "#d97706" : "#6366f1";
  const urgencyLabel = daysLeft <= 0 ? "EXPIRED" : daysLeft === 1 ? "EXPIRES TOMORROW" : `EXPIRES IN ${daysLeft} DAYS`;
  const subject = daysLeft <= 0
    ? `Document Expired: ${documentName}`
    : `Reminder: "${documentName}" expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`;
  const actionLabel = daysLeft <= 0 ? "Upload Replacement Now" : "Manage Documents";
  const bodyMsg = daysLeft <= 0
    ? `This document expired on ${expiryStr}. Please upload a renewed version immediately.`
    : `This document will expire on ${expiryStr} — ${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining.`;
  const text = `Document Expiry Reminder — ${urgencyLabel}

Hi ${userName},

${bodyMsg}

Manage your documents: ${url}/document-vault-v2`;
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f0a1e;color:#e2e8f0;padding:24px"><div style="max-width:520px;margin:0 auto;background:#1a1035;border-radius:12px;padding:24px;border:1px solid #4c1d95"><div style="background:${urgencyColor};color:#fff;padding:8px 16px;border-radius:6px;font-weight:700;font-size:13px;display:inline-block;margin-bottom:16px">${urgencyLabel}</div><h2 style="color:#a78bfa;margin:0 0 8px">Document Expiry Reminder</h2><p style="color:#c4b5fd">Hi ${userName},</p><p style="color:#e2e8f0">${bodyMsg}</p><p style="color:#94a3b8">Document: <strong style="color:#e2e8f0">${documentName}</strong> (${documentCategory})</p><a href="${url}/document-vault-v2" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${actionLabel}</a></div></body></html>`;
  return { subject, html, text };
}

// ─── Transfer Completed (status update) ──────────────────────────────────────
export function buildTransferCompletedEmail(opts: {
  userName: string;
  recipientName: string;
  amount: number;
  fromCurrency: string;
  toAmount: number;
  toCurrency: string;
  reference: string;
  completedAt?: string;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const subject = `Transfer Delivered — ${opts.toAmount.toLocaleString()} ${opts.toCurrency} to ${opts.recipientName}`;
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Transfer Delivered ✓</h2>
    <p style="color: #374151; margin: 0 0 20px;">Hi ${opts.userName}, great news — your transfer has been delivered successfully.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">You sent</td><td style="padding: 10px 0; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.amount.toLocaleString()} ${opts.fromCurrency}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Delivered to ${opts.recipientName}</td><td style="padding: 10px 0; font-weight: 700; color: #10b981; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.toAmount.toLocaleString()} ${opts.toCurrency}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Reference</td><td style="padding: 10px 0; font-family: monospace; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.reference}</td></tr>
      ${opts.completedAt ? `<tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Completed at</td><td style="padding: 10px 0; text-align: right;">${opts.completedAt}</td></tr>` : ""}
    </table>
    <a href="${appUrl}/transactions" style="display: inline-block; background: #10b981; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">View Receipt</a>`
  );
  const text = `Transfer Delivered!\nYour transfer of ${opts.amount} ${opts.fromCurrency} to ${opts.recipientName} has been delivered.\nRecipient received: ${opts.toAmount} ${opts.toCurrency}\nReference: ${opts.reference}\nView receipt: ${appUrl}/transactions`;
  return { subject, html, text };
}

// ─── Transfer Failed ──────────────────────────────────────────────────────────
export function buildTransferFailedEmail(opts: {
  userName: string;
  recipientName: string;
  amount: number;
  fromCurrency: string;
  reference: string;
  reason?: string;
}): { subject: string; html: string; text: string } {
  const appUrl = ENV.appUrl;
  const subject = `Transfer Failed — ${opts.amount.toLocaleString()} ${opts.fromCurrency} to ${opts.recipientName}`;
  const html = emailWrapper(
    `<h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Transfer Failed</h2>
    <p style="color: #374151; margin: 0 0 20px;">Hi ${opts.userName}, unfortunately your transfer could not be completed.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Amount</td><td style="padding: 10px 0; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.amount.toLocaleString()} ${opts.fromCurrency}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Recipient</td><td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.recipientName}</td></tr>
      <tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Reference</td><td style="padding: 10px 0; font-family: monospace; text-align: right; border-bottom: 1px solid #f3f4f6;">${opts.reference}</td></tr>
      ${opts.reason ? `<tr><td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Reason</td><td style="padding: 10px 0; color: #ef4444; text-align: right;">${opts.reason}</td></tr>` : ""}
    </table>
    <p style="color: #374151; font-size: 14px; margin: 0 0 20px;">Any debited amount will be refunded to your wallet within 1-2 business days. Please try again or contact support if the issue persists.</p>
    <a href="${appUrl}/send" style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">Try Again</a>`,
    "If you need assistance, please contact RemitFlow support."
  );
  const text = `Transfer Failed\nYour transfer of ${opts.amount} ${opts.fromCurrency} to ${opts.recipientName} failed.\nReference: ${opts.reference}\n${opts.reason ? `Reason: ${opts.reason}\n` : ""}Any debited amount will be refunded within 1-2 business days.\nTry again: ${appUrl}/send`;
  return { subject, html, text };
}
