import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "../_core/logger";

const TEMPLATE_DIR = join(__dirname, "..", "email-templates");

type TemplateVars = Record<string, string>;

function loadTemplate(name: string, vars: TemplateVars): string {
  try {
    let html = readFileSync(join(TEMPLATE_DIR, `${name}.html`), "utf-8");
    for (const [key, value] of Object.entries(vars)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }
    return html;
  } catch (err) {
    logger.warn({ template: name, err }, "[Email] Template not found, falling back to plain text");
    return "";
  }
}

export function renderTransactionReceipt(vars: {
  status: string;
  reference: string;
  fromAmount: string;
  fromCurrency: string;
  toAmount: string;
  toCurrency: string;
  rate: string;
  fee: string;
  rail: string;
  recipientName: string;
  date: string;
  trackingUrl: string;
  appUrl: string;
}): string {
  return loadTemplate("transaction-receipt", {
    STATUS: vars.status,
    REFERENCE: vars.reference,
    FROM_AMOUNT: vars.fromAmount,
    FROM_CURRENCY: vars.fromCurrency,
    TO_AMOUNT: vars.toAmount,
    TO_CURRENCY: vars.toCurrency,
    RATE: vars.rate,
    FEE: vars.fee,
    RAIL: vars.rail,
    RECIPIENT_NAME: vars.recipientName,
    DATE: vars.date,
    TRACKING_URL: vars.trackingUrl,
    APP_URL: vars.appUrl,
  });
}

export function renderKycStatus(vars: {
  status: string;
  userName: string;
  tier: string;
  dailyLimit: string;
  monthlyLimit: string;
  bodyMessage: string;
  ctaText: string;
  appUrl: string;
}): string {
  const isApproved = vars.status.toLowerCase() === "approved";
  return loadTemplate("kyc-status", {
    STATUS: vars.status,
    STATUS_BG: isApproved ? "#ecfdf5" : "#fef3c7",
    STATUS_BORDER: isApproved ? "#a7f3d0" : "#fcd34d",
    STATUS_COLOR: isApproved ? "#059669" : "#d97706",
    STATUS_MESSAGE: isApproved ? "Verification Approved" : "Action Required",
    USER_NAME: vars.userName,
    BODY_MESSAGE: vars.bodyMessage,
    TIER: vars.tier,
    DAILY_LIMIT: vars.dailyLimit,
    MONTHLY_LIMIT: vars.monthlyLimit,
    CTA_TEXT: vars.ctaText,
    APP_URL: vars.appUrl,
  });
}

export function renderSecurityAlert(vars: {
  userName: string;
  alertTitle: string;
  alertMessage: string;
  eventType: string;
  timestamp: string;
  ipAddress: string;
  device: string;
  appUrl: string;
}): string {
  return loadTemplate("security-alert", {
    USER_NAME: vars.userName,
    ALERT_TITLE: vars.alertTitle,
    ALERT_MESSAGE: vars.alertMessage,
    EVENT_TYPE: vars.eventType,
    TIMESTAMP: vars.timestamp,
    IP_ADDRESS: vars.ipAddress,
    DEVICE: vars.device,
    APP_URL: vars.appUrl,
  });
}
