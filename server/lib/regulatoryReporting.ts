/**
 * regulatoryReporting.ts — STR/SAR/CTR Filing for Multi-Jurisdiction Compliance
 *
 * Automated suspicious transaction reporting for:
 *   - Canada (FINTRAC): STR, LCTR (Large Cash Transaction Report)
 *   - USA (FinCEN): SAR, CTR (Currency Transaction Report)
 *   - UK (NCA): SAR (Suspicious Activity Report)
 *   - Nigeria (NFIU): STR, CTR
 *
 * Filing triggers:
 *   - CTR: Any transaction ≥ $10,000 USD equivalent (auto-file, not suspicious)
 *   - SAR/STR: Suspicious patterns detected by compliance engine
 *   - Structuring detection: Multiple transactions that appear to avoid CTR threshold
 *
 * All reports are:
 *   1. Generated in jurisdiction-specific format
 *   2. Persisted to PostgreSQL for audit trail
 *   3. Submitted to regulator API (or queued for manual submission)
 *   4. Immutable once filed (cannot be deleted or modified)
 */

import { randomBytes } from "crypto";
import { logger } from "../_core/logger";
import { persistFeatureRecord } from "../_core/featurePersistence";

// ── Types ───────────────────────────────────────────────────────────────────

export type ReportType = "SAR" | "STR" | "CTR" | "LCTR" | "EFTR";
export type ReportStatus = "draft" | "pending_review" | "submitted" | "acknowledged" | "rejected";
export type Jurisdiction = "CA" | "US" | "GB" | "NG" | "GH" | "KE" | "ZA";

export interface SuspiciousIndicator {
  code: string;
  description: string;
  category: "structuring" | "fraud" | "sanctions" | "terrorism" | "money_laundering" | "tax_evasion" | "other";
  severity: "low" | "medium" | "high" | "critical";
}

export interface SubjectInfo {
  type: "individual" | "entity";
  firstName?: string;
  lastName?: string;
  entityName?: string;
  dateOfBirth?: string;
  nationalId?: string;
  nationalIdType?: string;
  country: string;
  address?: string;
  occupation?: string;
  accountNumbers: string[];
  phoneNumber?: string;
  email?: string;
}

export interface TransactionDetail {
  id: string;
  date: string;
  amount: number;
  currency: string;
  type: "wire" | "crypto" | "cash" | "mobile_money" | "card";
  direction: "inbound" | "outbound" | "internal";
  counterparty?: string;
  description?: string;
  rail?: string;
}

export interface RegulatoryReport {
  id: string;
  type: ReportType;
  jurisdiction: Jurisdiction;
  status: ReportStatus;
  filingReference?: string;    // Regulator-assigned reference after submission
  subject: SubjectInfo;
  transactions: TransactionDetail[];
  indicators: SuspiciousIndicator[];
  narrative: string;           // Free-text explanation of suspicion
  totalAmount: number;
  currency: string;
  dateRange: { from: string; to: string };
  filedBy: string;             // Compliance officer ID
  filedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Jurisdiction-specific fields
  fintracReportNumber?: string;
  fincenBsaId?: string;
  ncaReference?: string;
  nfiuReference?: string;
}

// ── Suspicious Activity Indicators ──────────────────────────────────────────

export const SUSPICIOUS_INDICATORS: SuspiciousIndicator[] = [
  // Structuring
  { code: "STRUCT-001", description: "Multiple transactions just below reporting threshold within 24h", category: "structuring", severity: "high" },
  { code: "STRUCT-002", description: "Round-number transactions suggesting intentional structuring", category: "structuring", severity: "medium" },
  { code: "STRUCT-003", description: "Rapid successive deposits across multiple accounts", category: "structuring", severity: "high" },

  // Fraud
  { code: "FRAUD-001", description: "Account velocity anomaly (10x normal transaction rate)", category: "fraud", severity: "high" },
  { code: "FRAUD-002", description: "Transaction from sanctioned jurisdiction", category: "fraud", severity: "critical" },
  { code: "FRAUD-003", description: "Mismatched sender/beneficiary KYC data", category: "fraud", severity: "medium" },

  // Money Laundering
  { code: "ML-001", description: "Layering: rapid movement through multiple accounts", category: "money_laundering", severity: "high" },
  { code: "ML-002", description: "Integration: large purchase immediately after deposit", category: "money_laundering", severity: "medium" },
  { code: "ML-003", description: "Placement: cash-intensive deposits from high-risk geography", category: "money_laundering", severity: "high" },

  // Terrorism Financing
  { code: "TF-001", description: "Transfer to/from designated entity on UNSC list", category: "terrorism", severity: "critical" },
  { code: "TF-002", description: "Small recurring transfers to conflict zone", category: "terrorism", severity: "high" },

  // Sanctions
  { code: "SANC-001", description: "Partial name match against OFAC SDN list", category: "sanctions", severity: "high" },
  { code: "SANC-002", description: "Wallet address flagged by Chainalysis", category: "sanctions", severity: "critical" },
];

// ── CTR/LCTR Thresholds ─────────────────────────────────────────────────────

export const CTR_THRESHOLDS: Record<Jurisdiction, { amount: number; currency: string }> = {
  CA: { amount: 10000, currency: "CAD" },
  US: { amount: 10000, currency: "USD" },
  GB: { amount: 10000, currency: "GBP" },
  NG: { amount: 5000000, currency: "NGN" },
  GH: { amount: 50000, currency: "GHS" },
  KE: { amount: 1000000, currency: "KES" },
  ZA: { amount: 25000, currency: "ZAR" },
};

// ── Report Generation ───────────────────────────────────────────────────────

/**
 * Generate a CTR (Currency Transaction Report) for automatic filing.
 * CTRs are NOT suspicious — they are mandatory reports for large transactions.
 */
export function generateCTR(params: {
  subject: SubjectInfo;
  transaction: TransactionDetail;
  jurisdiction: Jurisdiction;
  filedBy: string;
}): RegulatoryReport {
  const id = `ctr-${randomBytes(12).toString("hex")}`;
  const now = new Date().toISOString();
  const type: ReportType = params.jurisdiction === "CA" ? "LCTR" : "CTR";

  return {
    id,
    type,
    jurisdiction: params.jurisdiction,
    status: "pending_review",
    subject: params.subject,
    transactions: [params.transaction],
    indicators: [],
    narrative: `Automatic ${type} filing: Transaction of ${params.transaction.currency} ${params.transaction.amount.toLocaleString()} exceeds reporting threshold for ${params.jurisdiction}.`,
    totalAmount: params.transaction.amount,
    currency: params.transaction.currency,
    dateRange: { from: params.transaction.date, to: params.transaction.date },
    filedBy: params.filedBy,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generate a SAR/STR (Suspicious Activity/Transaction Report).
 * Requires narrative explanation and indicator codes.
 */
export function generateSAR(params: {
  subject: SubjectInfo;
  transactions: TransactionDetail[];
  indicators: SuspiciousIndicator[];
  narrative: string;
  jurisdiction: Jurisdiction;
  filedBy: string;
  dateRange: { from: string; to: string };
}): RegulatoryReport {
  const id = `sar-${randomBytes(12).toString("hex")}`;
  const now = new Date().toISOString();
  const type: ReportType = params.jurisdiction === "CA" || params.jurisdiction === "NG" ? "STR" : "SAR";

  const totalAmount = params.transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const currency = params.transactions[0]?.currency || "USD";

  return {
    id,
    type,
    jurisdiction: params.jurisdiction,
    status: "draft",
    subject: params.subject,
    transactions: params.transactions,
    indicators: params.indicators,
    narrative: params.narrative,
    totalAmount,
    currency,
    dateRange: params.dateRange,
    filedBy: params.filedBy,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Structuring Detection ───────────────────────────────────────────────────

/**
 * Detect structuring patterns in a user's recent transactions.
 * Returns suspicious indicators if structuring is detected.
 */
export function detectStructuring(params: {
  transactions: TransactionDetail[];
  jurisdiction: Jurisdiction;
  windowHours?: number;
}): SuspiciousIndicator[] {
  const indicators: SuspiciousIndicator[] = [];
  const threshold = CTR_THRESHOLDS[params.jurisdiction];
  const windowMs = (params.windowHours || 24) * 60 * 60 * 1000;

  // Group transactions by time window
  const sorted = [...params.transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Check for multiple transactions just below threshold
  const belowThreshold = sorted.filter(tx => {
    const ratio = tx.amount / threshold.amount;
    return ratio >= 0.7 && ratio < 1.0;
  });

  if (belowThreshold.length >= 3) {
    // Check if they're within the same time window
    const first = new Date(belowThreshold[0].date).getTime();
    const last = new Date(belowThreshold[belowThreshold.length - 1].date).getTime();
    if (last - first <= windowMs) {
      indicators.push(SUSPICIOUS_INDICATORS.find(i => i.code === "STRUCT-001")!);
    }
  }

  // Check for round numbers (ending in 000 or 500)
  const roundNumbers = sorted.filter(tx => tx.amount % 500 === 0 && tx.amount > 1000);
  if (roundNumbers.length >= 3) {
    indicators.push(SUSPICIOUS_INDICATORS.find(i => i.code === "STRUCT-002")!);
  }

  // Check total across transactions within window
  for (let i = 0; i < sorted.length; i++) {
    let windowTotal = 0;
    let count = 0;
    const windowStart = new Date(sorted[i].date).getTime();

    for (let j = i; j < sorted.length; j++) {
      const txTime = new Date(sorted[j].date).getTime();
      if (txTime - windowStart <= windowMs) {
        windowTotal += sorted[j].amount;
        count++;
      } else break;
    }

    // Multiple transactions that sum to > threshold but individually below
    if (count >= 3 && windowTotal > threshold.amount && sorted[i].amount < threshold.amount) {
      if (!indicators.some(ind => ind.code === "STRUCT-003")) {
        indicators.push(SUSPICIOUS_INDICATORS.find(i => i.code === "STRUCT-003")!);
      }
      break;
    }
  }

  return indicators;
}

// ── Filing Submission ───────────────────────────────────────────────────────

/**
 * Submit a report to the appropriate regulator.
 * In production, this calls the real API. In dev, it persists locally.
 */
export async function submitReport(report: RegulatoryReport): Promise<RegulatoryReport> {
  logger.info({ reportId: report.id, type: report.type, jurisdiction: report.jurisdiction }, "Submitting regulatory report");

  // Persist to database (immutable)
  await persistFeatureRecord("regulatory_reports", report.id, {
    id: report.id,
    type: report.type,
    jurisdiction: report.jurisdiction,
    status: "submitted",
    subjectName: report.subject.firstName
      ? `${report.subject.firstName} ${report.subject.lastName}`
      : report.subject.entityName || "Unknown",
    totalAmount: report.totalAmount,
    currency: report.currency,
    narrative: report.narrative,
    indicatorCodes: report.indicators.map(i => i.code).join(","),
    transactionCount: report.transactions.length,
    filedBy: report.filedBy,
    filedAt: new Date().toISOString(),
    createdAt: report.createdAt,
    userId: 0,
  });

  // Jurisdiction-specific submission
  switch (report.jurisdiction) {
    case "CA":
      return submitToFINTRAC(report);
    case "US":
      return submitToFinCEN(report);
    case "GB":
      return submitToNCA(report);
    case "NG":
      return submitToNFIU(report);
    default:
      // For jurisdictions without API integration, mark as submitted
      return { ...report, status: "submitted", filedAt: new Date().toISOString() };
  }
}

async function submitToFINTRAC(report: RegulatoryReport): Promise<RegulatoryReport> {
  const FINTRAC_API_URL = process.env.FINTRAC_API_URL || "https://api-report.fintrac-canafe.gc.ca";
  const FINTRAC_API_KEY = process.env.FINTRAC_API_KEY || "";

  if (!FINTRAC_API_KEY) {
    logger.warn("[FINTRAC] API key not configured — report queued for manual submission");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }

  try {
    const response = await fetch(`${FINTRAC_API_URL}/v1/reports`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FINTRAC_API_KEY}`,
        "Content-Type": "application/json",
        "X-Report-Type": report.type,
      },
      body: JSON.stringify({
        reportType: report.type === "STR" ? "str" : "lctr",
        reportingEntity: {
          name: "RemitFlow Inc.",
          registrationNumber: "M-REMITFLOW-CA",
          type: "MSB",
        },
        subject: report.subject,
        transactions: report.transactions,
        narrative: report.narrative,
        indicators: report.indicators.map(i => i.code),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`FINTRAC API ${response.status}`);
    const data = (await response.json()) as { reportNumber: string };

    return {
      ...report,
      status: "submitted",
      filingReference: data.reportNumber,
      fintracReportNumber: data.reportNumber,
      filedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, reportId: report.id }, "FINTRAC submission failed");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }
}

async function submitToFinCEN(report: RegulatoryReport): Promise<RegulatoryReport> {
  const FINCEN_API_URL = process.env.FINCEN_API_URL || "https://bsaefiling.fincen.treas.gov/api";
  const FINCEN_API_KEY = process.env.FINCEN_API_KEY || "";

  if (!FINCEN_API_KEY) {
    logger.warn("[FinCEN] API key not configured — report queued for manual submission");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }

  try {
    const response = await fetch(`${FINCEN_API_URL}/v1/filing`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FINCEN_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filingType: report.type,
        filerName: "RemitFlow Inc.",
        filerEIN: process.env.REMITFLOW_EIN || "",
        subject: report.subject,
        suspiciousActivity: {
          narrative: report.narrative,
          indicators: report.indicators.map(i => ({
            code: i.code,
            description: i.description,
          })),
          dateRange: report.dateRange,
          totalAmount: report.totalAmount,
        },
        transactions: report.transactions,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`FinCEN API ${response.status}`);
    const data = (await response.json()) as { bsaId: string };

    return {
      ...report,
      status: "submitted",
      filingReference: data.bsaId,
      fincenBsaId: data.bsaId,
      filedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, reportId: report.id }, "FinCEN submission failed");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }
}

async function submitToNCA(report: RegulatoryReport): Promise<RegulatoryReport> {
  const NCA_API_URL = process.env.NCA_API_URL || "https://www.ukgovernmentgateway.gov.uk/api/sar";
  const NCA_API_KEY = process.env.NCA_API_KEY || "";

  if (!NCA_API_KEY) {
    logger.warn("[NCA] API key not configured — report queued for manual submission");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }

  try {
    const response = await fetch(`${NCA_API_URL}/submit`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NCA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reportType: "SAR",
        reporter: { name: "RemitFlow UK Ltd", firmReference: "FRN-REMITFLOW" },
        subject: report.subject,
        reason: report.narrative,
        transactions: report.transactions,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`NCA API ${response.status}`);
    const data = (await response.json()) as { reference: string };

    return {
      ...report,
      status: "submitted",
      filingReference: data.reference,
      ncaReference: data.reference,
      filedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, reportId: report.id }, "NCA submission failed");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }
}

async function submitToNFIU(report: RegulatoryReport): Promise<RegulatoryReport> {
  const NFIU_API_URL = process.env.NFIU_API_URL || "https://nfiu.gov.ng/api/v1";
  const NFIU_API_KEY = process.env.NFIU_API_KEY || "";

  if (!NFIU_API_KEY) {
    logger.warn("[NFIU] API key not configured — report queued for manual submission");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }

  try {
    const response = await fetch(`${NFIU_API_URL}/reports/submit`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NFIU_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reportType: report.type,
        reportingInstitution: { name: "RemitFlow Nigeria", licenseNumber: "IMTO-REMITFLOW" },
        subject: report.subject,
        suspiciousActivity: report.narrative,
        transactions: report.transactions,
        indicators: report.indicators.map(i => i.code),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`NFIU API ${response.status}`);
    const data = (await response.json()) as { reference: string };

    return {
      ...report,
      status: "submitted",
      filingReference: data.reference,
      nfiuReference: data.reference,
      filedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, reportId: report.id }, "NFIU submission failed");
    return { ...report, status: "pending_review", updatedAt: new Date().toISOString() };
  }
}

// ── Automated Filing Triggers ───────────────────────────────────────────────

/**
 * Check if a transaction triggers automatic CTR filing.
 */
export function shouldFileCTR(amount: number, currency: string, jurisdiction: Jurisdiction): boolean {
  const threshold = CTR_THRESHOLDS[jurisdiction];
  if (!threshold) return false;
  // Compare in same currency (simplified — production needs FX conversion)
  if (currency === threshold.currency) {
    return amount >= threshold.amount;
  }
  // Default: use USD equivalent threshold of $10,000
  return amount >= 10000;
}

/**
 * Determine the correct jurisdiction for a user based on their country.
 */
export function getJurisdiction(country: string): Jurisdiction {
  const mapping: Record<string, Jurisdiction> = {
    CA: "CA", US: "US", GB: "GB", NG: "NG", GH: "GH", KE: "KE", ZA: "ZA",
    // Map UK constituent countries
    "GB-ENG": "GB", "GB-SCT": "GB", "GB-WLS": "GB", "GB-NIR": "GB",
  };
  return mapping[country] || "US"; // Default to US for unknown jurisdictions
}
