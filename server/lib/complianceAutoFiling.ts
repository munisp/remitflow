/**
 * Compliance Auto-Filing
 *
 * Evaluates every completed outbound transfer against mandatory regulatory
 * filing rules and enqueues the required reports on the durable filing queue
 * (server/services/regulatoryFilingQueue.ts), which retries with backoff and
 * dead-letters on permanent failure.
 *
 * Rules implemented:
 *   - CTR / LCTR: single transactions above the jurisdiction threshold
 *     (server/lib/regulatoryReporting.ts CTR_THRESHOLDS).
 *   - Travel Rule: cross-border transfers at or above the FATF USD/EUR 1,000
 *     threshold carry originator/beneficiary information in the report payload.
 *   - NFIU (Nigeria): NGN-denominated transfers above the NG threshold are
 *     reported to the NFIU via the same CTR queue path.
 *
 * Nothing here fabricates a filing: reports are only produced from the real
 * transfer parameters supplied by the caller, and queue failures surface as
 * { status: "failed" } entries so callers can alert on them.
 */

import {
  generateCTR,
  getJurisdiction,
  shouldFileCTR,
  type Jurisdiction,
  type RegulatoryReport,
  type SubjectInfo,
  type TransactionDetail,
} from "./regulatoryReporting";
import { enqueueRegulatoryFiling } from "../services/regulatoryFilingQueue";
import { resolveTenantContext } from "../tenantMiddleware";
import { logger } from "../_core/logger";

/** FATF Recommendation 16 (Travel Rule) threshold in USD equivalent. */
export const TRAVEL_RULE_THRESHOLD_USD = 1_000;

export interface AutoFileComplianceInput {
  userId: number;
  reference: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  amountUSD: number;
  toAmount: number;
  fxRate: number;
  fee: number;
  recipientName: string;
  recipientAccount?: string;
  recipientBank?: string;
  recipientCountry?: string;
  senderName: string;
  senderEmail?: string;
  /** Epoch ms or ISO string of the FX quote, when captured by the caller. */
  fxQuoteTime?: number | string;
}

export interface FilingResult {
  type: "CTR" | "LCTR" | "TRAVEL_RULE";
  jurisdiction: Jurisdiction;
  reportId: string;
  status: "queued" | "failed";
  error?: string;
}

function buildSubject(input: AutoFileComplianceInput, country: string): SubjectInfo {
  const nameParts = input.senderName.trim().split(/\s+/);
  const [firstName, ...rest] = nameParts;
  return {
    type: "individual",
    firstName,
    lastName: rest.length > 0 ? rest.join(" ") : undefined,
    country,
    accountNumbers: [],
    email: input.senderEmail,
  };
}

function buildTransaction(input: AutoFileComplianceInput): TransactionDetail {
  return {
    id: input.reference,
    date: new Date().toISOString(),
    amount: input.amount,
    currency: input.fromCurrency,
    type: "wire",
    direction: "outbound",
    counterparty: input.recipientName,
    description:
      `Remittance ${input.reference}: ${input.fromCurrency} ${input.amount} -> ` +
      `${input.toCurrency} ${input.toAmount} (fx=${input.fxRate}, fee=${input.fee})` +
      (input.recipientBank ? ` via ${input.recipientBank}` : ""),
    rail: "remitflow",
  };
}

/**
 * Evaluate a completed transfer and enqueue every mandatory filing.
 * Returns one FilingResult per required filing so the caller can alert on
 * failures. Never throws on filing failure — the transfer itself already
 * completed — but errors are logged and reported in the result.
 */
export async function autoFileCompliance(input: AutoFileComplianceInput): Promise<FilingResult[]> {
  const results: FilingResult[] = [];
  // Corridor default mirrors the transfer router ("NG" when unspecified).
  const recipientCountry = input.recipientCountry ?? "NG";
  const jurisdiction = getJurisdiction(recipientCountry);
  const transaction = buildTransaction(input);
  const subject = buildSubject(input, recipientCountry);

  // CTR / LCTR — mandatory reporting of large transactions. amountUSD is the
  // FX-normalized amount used when the local-currency threshold does not apply
  // directly (see shouldFileCTR).
  const ctrTriggered =
    shouldFileCTR(input.amount, input.fromCurrency, jurisdiction) ||
    shouldFileCTR(input.amountUSD, "USD", jurisdiction);

  // Travel Rule — cross-border transfers >= USD 1,000 must carry
  // originator/beneficiary data. The beneficiary data is embedded in the
  // transaction description and report narrative.
  const travelRuleTriggered =
    input.fromCurrency !== input.toCurrency && input.amountUSD >= TRAVEL_RULE_THRESHOLD_USD;

  if (!ctrTriggered && !travelRuleTriggered) {
    return results;
  }

  const tenant = await resolveTenantContext(input.userId);
  if (!tenant.tenantId) {
    const error = "No active tenant — cannot queue regulatory filing";
    logger.error({ userId: input.userId, reference: input.reference }, `[ComplianceFiling] ${error}`);
    return [{ type: ctrTriggered ? "CTR" : "TRAVEL_RULE", jurisdiction, reportId: "", status: "failed", error }];
  }

  if (ctrTriggered) {
    const report: RegulatoryReport = generateCTR({
      subject,
      transaction,
      jurisdiction,
      filedBy: `user-${input.userId}`,
    });
    try {
      const queued = await enqueueRegulatoryFiling({ tenantId: tenant.tenantId, requestedBy: input.userId, report });
      results.push({ type: report.type === "LCTR" ? "LCTR" : "CTR", jurisdiction, reportId: queued.report_id, status: "queued" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err: error, reference: input.reference }, "[ComplianceFiling] CTR enqueue failed");
      results.push({ type: "CTR", jurisdiction, reportId: report.id, status: "failed", error });
    }
  }

  if (travelRuleTriggered) {
    // Travel Rule data travels with the CTR report when both fire; when the
    // transfer is below the CTR threshold a standalone CTR-type record is
    // still queued so originator/beneficiary information is retained for the
    // regulator. This is a record-keeping obligation, not a suspicion report.
    const report = generateCTR({
      subject: { ...subject, accountNumbers: input.recipientAccount ? [input.recipientAccount] : [] },
      transaction,
      jurisdiction,
      filedBy: `user-${input.userId}`,
    });
    report.narrative =
      `Travel Rule (FATF R.16) record for cross-border transfer ${input.reference}: ` +
      `originator ${input.senderName}${input.senderEmail ? ` <${input.senderEmail}>` : ""}, ` +
      `beneficiary ${input.recipientName}` +
      `${input.recipientAccount ? ` (${input.recipientAccount})` : ""}` +
      `${input.recipientBank ? ` at ${input.recipientBank}` : ""}, ` +
      `${recipientCountry}. USD-equivalent amount ${input.amountUSD.toFixed(2)}.` +
      (input.fxQuoteTime
        ? ` FX quote time ${typeof input.fxQuoteTime === "number" ? new Date(input.fxQuoteTime).toISOString() : input.fxQuoteTime}.`
        : "");
    try {
      const queued = await enqueueRegulatoryFiling({ tenantId: tenant.tenantId, requestedBy: input.userId, report });
      results.push({ type: "TRAVEL_RULE", jurisdiction, reportId: queued.report_id, status: "queued" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err: error, reference: input.reference }, "[ComplianceFiling] Travel Rule enqueue failed");
      results.push({ type: "TRAVEL_RULE", jurisdiction, reportId: report.id, status: "failed", error });
    }
  }

  return results;
}
