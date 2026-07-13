/**
 * RemitFlow Email Service (v92)
 * Nodemailer-based SMTP delivery with sensible defaults.
 * Default transport: MailHog (local dev) → SMTP in production.
 * Override via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
import nodemailer from "nodemailer";
import { logger } from './_core/logger';

const SMTP_HOST = process.env.SMTP_HOST ?? "localhost";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "1025", 10);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_FROM = process.env.SMTP_FROM ?? "RemitFlow <noreply@remitflow.io>";
const SMTP_SECURE = process.env.SMTP_SECURE === "true";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    tls: { rejectUnauthorized: false },
    pool: true,
    maxConnections: 5,
  });
  return _transporter;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmail(opts: EmailOptions): Promise<EmailResult> {
  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: SMTP_FROM,
      to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      replyTo: opts.replyTo,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? opts.html.replace(/<[^>]+>/g, ""),
      attachments: opts.attachments,
    });
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    logger.error({ err: err.message }, '[Email] Send failed:');
    return { success: false, error: err.message };
  }
}

// ─── Template Helpers ─────────────────────────────────────────────────────────

export function complianceReportEmailHtml(opts: {
  reportType: string;
  reportId: string;
  period: string;
  filedBy: string;
  amount?: number;
  currency?: string;
  summary?: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; color: #1a1a2e; background: #f8f9fa; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #7c3aed, #06b6d4); padding: 32px; color: white; text-align: center; }
  .header h1 { margin: 0; font-size: 24px; }
  .header p { margin: 8px 0 0; opacity: 0.85; font-size: 14px; }
  .body { padding: 32px; }
  .badge { display: inline-block; background: #7c3aed; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 16px; }
  .field { margin-bottom: 16px; }
  .field label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px; }
  .field value { font-size: 15px; color: #1a1a2e; font-weight: 500; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  .footer { background: #f8f9fa; padding: 20px 32px; font-size: 12px; color: #9ca3af; text-align: center; }
  .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px; font-size: 13px; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>RemitFlow Compliance</h1>
    <p>Regulatory Report Notification</p>
  </div>
  <div class="body">
    <div class="badge">${opts.reportType}</div>
    <div class="alert">⚠️ This report has been filed with the relevant regulatory authority. Please retain this notification for your records.</div>
    <div class="field"><label>Report ID</label><value>${opts.reportId}</value></div>
    <div class="field"><label>Report Type</label><value>${opts.reportType}</value></div>
    <div class="field"><label>Period</label><value>${opts.period}</value></div>
    <div class="field"><label>Filed By</label><value>${opts.filedBy}</value></div>
    ${opts.amount ? `<div class="field"><label>Amount</label><value>${opts.currency ?? "USD"} ${opts.amount.toLocaleString()}</value></div>` : ""}
    ${opts.summary ? `<div class="field"><label>Summary</label><value>${opts.summary}</value></div>` : ""}
    <hr class="divider">
    <p style="font-size:13px;color:#6b7280;">This is an automated notification from RemitFlow's compliance system. If you have questions, contact <a href="mailto:compliance@remitflow.io">compliance@remitflow.io</a>.</p>
  </div>
  <div class="footer">RemitFlow Inc. · Regulated by FinCEN · AML/BSA Compliant · ${new Date().getFullYear()}</div>
</div>
</body>
</html>`;
}

export function partnerApprovalEmailHtml(opts: {
  partnerName: string;
  contactName: string;
  plan: string;
  inviteCode: string;
  loginUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; color: #1a1a2e; background: #f8f9fa; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #7c3aed, #06b6d4); padding: 32px; color: white; text-align: center; }
  .body { padding: 32px; }
  .code-box { background: #f3f4f6; border: 2px dashed #7c3aed; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
  .code { font-size: 24px; font-weight: bold; color: #7c3aed; letter-spacing: 0.1em; font-family: monospace; }
  .btn { display: inline-block; background: #7c3aed; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 16px; }
  .footer { background: #f8f9fa; padding: 20px 32px; font-size: 12px; color: #9ca3af; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>🎉 Application Approved!</h1>
    <p>Welcome to the RemitFlow Partner Network</p>
  </div>
  <div class="body">
    <p>Dear ${opts.contactName},</p>
    <p>We're thrilled to inform you that <strong>${opts.partnerName}</strong>'s application to join the RemitFlow Partner Network has been <strong>approved</strong>!</p>
    <p>Your plan: <strong>${opts.plan.toUpperCase()}</strong></p>
    <p>Use the invite code below to activate your partner account:</p>
    <div class="code-box">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Your Invite Code</p>
      <div class="code">${opts.inviteCode}</div>
    </div>
    <p style="text-align:center;"><a href="${opts.loginUrl}" class="btn">Activate Your Account →</a></p>
    <p style="font-size:13px;color:#6b7280;margin-top:24px;">If you have any questions, contact your dedicated partner success manager at <a href="mailto:partners@remitflow.io">partners@remitflow.io</a>.</p>
  </div>
  <div class="footer">RemitFlow Inc. · Partner Program · ${new Date().getFullYear()}</div>
</div>
</body>
</html>`;
}

export function transferNotificationEmailHtml(opts: {
  recipientName: string;
  senderName: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  toAmount: number;
  transferId: string;
  status: string;
  estimatedArrival?: string;
}): string {
  const statusColor = opts.status === "completed" ? "#10b981" : opts.status === "failed" ? "#ef4444" : "#f59e0b";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; color: #1a1a2e; background: #f8f9fa; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #7c3aed, #06b6d4); padding: 32px; color: white; text-align: center; }
  .body { padding: 32px; }
  .amount-box { background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
  .status { display: inline-block; background: ${statusColor}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
  .footer { background: #f8f9fa; padding: 20px 32px; font-size: 12px; color: #9ca3af; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>Transfer Update</h1>
    <p>Reference: ${opts.transferId}</p>
  </div>
  <div class="body">
    <p>Dear ${opts.recipientName},</p>
    <p>${opts.senderName} has sent you money via RemitFlow.</p>
    <div class="amount-box">
      <p style="margin:0;font-size:13px;color:#6b7280;">You will receive</p>
      <p style="margin:8px 0;font-size:32px;font-weight:bold;color:#7c3aed;">${opts.toCurrency} ${opts.toAmount.toLocaleString()}</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">from ${opts.fromCurrency} ${opts.amount.toLocaleString()}</p>
    </div>
    <p>Status: <span class="status">${opts.status.toUpperCase()}</span></p>
    ${opts.estimatedArrival ? `<p>Estimated arrival: <strong>${opts.estimatedArrival}</strong></p>` : ""}
    <p style="font-size:13px;color:#6b7280;margin-top:24px;">Transfer ID: ${opts.transferId}</p>
  </div>
  <div class="footer">RemitFlow Inc. · Secure Cross-Border Payments · ${new Date().getFullYear()}</div>
</div>
</body>
</html>`;
}

export function kycStatusEmailHtml(opts: {
  userName: string;
  status: "approved" | "rejected" | "pending";
  tier?: string;
  rejectionReason?: string;
  nextSteps?: string;
}): string {
  const statusMap = {
    approved: { color: "#10b981", icon: "✅", title: "KYC Approved" },
    rejected: { color: "#ef4444", icon: "❌", title: "KYC Rejected" },
    pending: { color: "#f59e0b", icon: "⏳", title: "KYC Under Review" },
  };
  const s = statusMap[opts.status];
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; color: #1a1a2e; background: #f8f9fa; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
  .header { background: ${s.color}; padding: 32px; color: white; text-align: center; }
  .body { padding: 32px; }
  .footer { background: #f8f9fa; padding: 20px 32px; font-size: 12px; color: #9ca3af; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header"><h1>${s.icon} ${s.title}</h1></div>
  <div class="body">
    <p>Dear ${opts.userName},</p>
    <p>Your identity verification (KYC) status has been updated to: <strong>${opts.status.toUpperCase()}</strong></p>
    ${opts.tier ? `<p>KYC Tier: <strong>${opts.tier}</strong></p>` : ""}
    ${opts.rejectionReason ? `<p style="color:#ef4444;">Reason: ${opts.rejectionReason}</p>` : ""}
    ${opts.nextSteps ? `<p>Next steps: ${opts.nextSteps}</p>` : ""}
    <p style="font-size:13px;color:#6b7280;margin-top:24px;">Questions? Contact <a href="mailto:support@remitflow.io">support@remitflow.io</a></p>
  </div>
  <div class="footer">RemitFlow Inc. · ${new Date().getFullYear()}</div>
</div>
</body>
</html>`;
}

export async function sendComplianceReport(opts: {
  to: string | string[];
  reportType: string;
  reportId: string;
  period: string;
  filedBy: string;
  amount?: number;
  currency?: string;
  summary?: string;
  pdfBuffer?: Buffer;
}): Promise<EmailResult> {
  return sendEmail({
    to: opts.to,
    subject: `[RemitFlow Compliance] ${opts.reportType} Report — ${opts.period}`,
    html: complianceReportEmailHtml(opts),
    attachments: opts.pdfBuffer ? [{
      filename: `${opts.reportType}-${opts.reportId}.pdf`,
      content: opts.pdfBuffer,
      contentType: "application/pdf",
    }] : undefined,
  });
}

export async function sendPartnerApproval(opts: {
  to: string;
  partnerName: string;
  contactName: string;
  plan: string;
  inviteCode: string;
  loginUrl?: string;
}): Promise<EmailResult> {
  return sendEmail({
    to: opts.to,
    subject: `🎉 Your RemitFlow Partner Application is Approved!`,
    html: partnerApprovalEmailHtml({
      ...opts,
      loginUrl: opts.loginUrl ?? "https://app.remitflow.io/login",
    }),
  });
}

export async function sendTransferNotification(opts: {
  to: string;
  recipientName: string;
  senderName: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  toAmount: number;
  transferId: string;
  status: string;
  estimatedArrival?: string;
}): Promise<EmailResult> {
  return sendEmail({
    to: opts.to,
    subject: `Transfer ${opts.status === "completed" ? "Completed" : "Update"} — ${opts.fromCurrency} ${opts.amount} → ${opts.toCurrency} ${opts.toAmount}`,
    html: transferNotificationEmailHtml(opts),
  });
}

export async function sendKycStatusEmail(opts: {
  to: string;
  userName: string;
  status: "approved" | "rejected" | "pending";
  tier?: string;
  rejectionReason?: string;
  nextSteps?: string;
}): Promise<EmailResult> {
  return sendEmail({
    to: opts.to,
    subject: `RemitFlow KYC Status Update — ${opts.status.toUpperCase()}`,
    html: kycStatusEmailHtml(opts),
  });
}
