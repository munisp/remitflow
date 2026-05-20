/**
 * RemitFlow — Tier 1/2/3 Middleware Event Wiring (v99)
 *
 * Provides fire-and-forget helpers that wire Kafka event emission,
 * TigerBeetle ledger entries (via gRPC), Temporal workflow triggers,
 * and OpenSearch indexing for all 13 new tier feature mutations.
 *
 * All functions are non-blocking (best-effort) — they never throw to the caller.
 * Import and call from tier1.ts, tier2.ts, tier3.ts after the DB insert/update.
 */

import { publishEvent, KAFKA_TOPICS } from "./kafka";
import { indexMarketListing } from "./opensearch";
import { logger } from '../_core/logger';

// ── Kafka topic extensions for tier features ──────────────────────────────────
export const TIER_TOPICS = {
  EXPENSE_SUBMITTED:          "remitflow.expense.submitted",
  CONTRACTOR_INVOICE_CREATED: "remitflow.contractor.invoice.created",
  CONTRACTOR_INVOICE_PAID:    "remitflow.contractor.invoice.paid",
  KYB_SUBMITTED:              "remitflow.kyb.submitted",
  KYB_REVIEWED:               "remitflow.kyb.reviewed",
  PAYROLL_TAX_FILED:          "remitflow.payroll.tax.filed",
  SAVINGS_ACCOUNT_OPENED:     "remitflow.savings.account.opened",
  SAVINGS_DEPOSIT:            "remitflow.savings.deposit",
  SAVINGS_WITHDRAWAL:         "remitflow.savings.withdrawal",
  BOND_ORDER_PLACED:          "remitflow.bond.order.placed",
  BOND_ORDER_MATCHED:         "remitflow.bond.order.matched",
  LC_OPENED:                  "remitflow.lc.opened",
  LC_DOCUMENT_UPLOADED:       "remitflow.lc.document.uploaded",
  INVOICE_FINANCING_APPLIED:  "remitflow.invoice.financing.applied",
  INVOICE_FINANCING_FUNDED:   "remitflow.invoice.financing.funded",
  PAYROLL_RUN_CREATED:        "remitflow.payroll.run.created",
  PAYROLL_RUN_APPROVED:       "remitflow.payroll.run.approved",
  PAYROLL_RUN_DISBURSED:      "remitflow.payroll.run.disbursed",
  EMBEDDED_PAYROLL_KEY_CREATED: "remitflow.embedded.payroll.key.created",
  MORTGAGE_APPLICATION:       "remitflow.mortgage.application",
  CREDIT_SCORE_GENERATED:     "remitflow.credit.score.generated",
  ESG_REPORT_SUBMITTED:       "remitflow.esg.report.submitted",
} as const;

// ── Helper: safe fire-and-forget wrapper ──────────────────────────────────────
function safeEmit(fn: () => Promise<unknown>, label: string): void {
  fn().catch(err =>
    logger.warn(`[TierEvents] ${label} failed (non-blocking):`, (err as Error).message)
  );
}

// ── Tier 1: Expense Management ────────────────────────────────────────────────
export function emitExpenseSubmitted(userId: number, reportId: number, totalUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.EXPENSE_SUBMITTED, `user-${userId}`, {
    userId, reportId, totalUsd, timestamp: new Date().toISOString(),
  }), "ExpenseSubmitted");
}

// ── Tier 1: Contractor Payments ───────────────────────────────────────────────
export function emitContractorInvoiceCreated(userId: number, invoiceId: number, totalUsd: number, contractorId: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.CONTRACTOR_INVOICE_CREATED, `user-${userId}`, {
    userId, invoiceId, totalUsd, contractorId, timestamp: new Date().toISOString(),
  }), "ContractorInvoiceCreated");
}

export function emitContractorInvoicePaid(userId: number, invoiceId: number, totalUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.CONTRACTOR_INVOICE_PAID, `invoice-${invoiceId}`, {
    userId, invoiceId, totalUsd, timestamp: new Date().toISOString(),
  }), "ContractorInvoicePaid");
}

// ── Tier 1: Merchant KYB ──────────────────────────────────────────────────────
export function emitKybSubmitted(userId: number, reviewId: number, businessName: string): void {
  safeEmit(() => publishEvent(TIER_TOPICS.KYB_SUBMITTED, `user-${userId}`, {
    userId, reviewId, businessName, timestamp: new Date().toISOString(),
  }), "KybSubmitted");
}

export function emitKybReviewed(reviewId: number, status: string, adminId: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.KYB_REVIEWED, `review-${reviewId}`, {
    reviewId, status, adminId, timestamp: new Date().toISOString(),
  }), "KybReviewed");
}

// ── Tier 1: Payroll Tax Filing ────────────────────────────────────────────────
export function emitPayrollTaxFiled(userId: number, filingId: number, jurisdiction: string, totalTaxUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.PAYROLL_TAX_FILED, `filing-${filingId}`, {
    userId, filingId, jurisdiction, totalTaxUsd, timestamp: new Date().toISOString(),
  }), "PayrollTaxFiled");
}

// ── Tier 2: Business Savings ──────────────────────────────────────────────────
export function emitSavingsAccountOpened(userId: number, accountId: number, productId: number, balanceUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.SAVINGS_ACCOUNT_OPENED, `account-${accountId}`, {
    userId, accountId, productId, balanceUsd, timestamp: new Date().toISOString(),
  }), "SavingsAccountOpened");
  // TigerBeetle ledger: create account entry (via gRPC, best-effort)
  safeEmit(async () => {
    const { ledgerTransfer } = await import("../grpc-client");
    await ledgerTransfer({
      idempotencyKey: `savings-open-${accountId}-${Date.now()}`,
      sourceAccountId: `user-${userId}-USD`,
      destinationAccountId: `savings-${accountId}-USD`,
      amount: balanceUsd.toFixed(2),
      currency: "USD",
      reference: `SAVINGS-OPEN-${accountId}`,
      description: "Business savings account opening deposit",
    });
  }, "TigerBeetle:SavingsOpen");
}

export function emitSavingsDeposit(userId: number, accountId: number, amountUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.SAVINGS_DEPOSIT, `account-${accountId}`, {
    userId, accountId, amountUsd, timestamp: new Date().toISOString(),
  }), "SavingsDeposit");
  // TigerBeetle ledger entry for deposit
  safeEmit(async () => {
    const { ledgerTransfer } = await import("../grpc-client");
    await ledgerTransfer({
      idempotencyKey: `savings-deposit-${accountId}-${Date.now()}`,
      sourceAccountId: `user-${userId}-USD`,
      destinationAccountId: `savings-${accountId}-USD`,
      amount: amountUsd.toFixed(2),
      currency: "USD",
      reference: `SAVINGS-DEP-${accountId}-${Date.now()}`,
      description: "Business savings deposit",
    });
  }, "TigerBeetle:SavingsDeposit");
}

export function emitSavingsWithdrawal(userId: number, accountId: number, amountUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.SAVINGS_WITHDRAWAL, `account-${accountId}`, {
    userId, accountId, amountUsd, timestamp: new Date().toISOString(),
  }), "SavingsWithdrawal");
  // TigerBeetle ledger entry for withdrawal
  safeEmit(async () => {
    const { ledgerTransfer } = await import("../grpc-client");
    await ledgerTransfer({
      idempotencyKey: `savings-withdraw-${accountId}-${Date.now()}`,
      sourceAccountId: `savings-${accountId}-USD`,
      destinationAccountId: `user-${userId}-USD`,
      amount: amountUsd.toFixed(2),
      currency: "USD",
      reference: `SAVINGS-WD-${accountId}-${Date.now()}`,
      description: "Business savings withdrawal",
    });
  }, "TigerBeetle:SavingsWithdrawal");
}

// ── Tier 2: Bond Secondary Market ─────────────────────────────────────────────
export function emitBondOrderPlaced(userId: number, orderId: number, bondId: number, units: number, priceUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.BOND_ORDER_PLACED, `order-${orderId}`, {
    userId, orderId, bondId, units, priceUsd, timestamp: new Date().toISOString(),
  }), "BondOrderPlaced");
  // OpenSearch: index the new bond listing
  safeEmit(() => indexMarketListing({
    id: `bond-order-${orderId}`,
    category: "bond_secondary_order",
    sellerId: String(userId),
    title: `Bond Order #${orderId}`,
    description: `${units} units at $${priceUsd}`,
    price: priceUsd,
    currency: "USD",
    status: "open",
    createdAt: new Date(),
  }), "OpenSearch:BondOrderPlaced");
}

export function emitBondOrderMatched(buyerId: number, sellerId: number, orderId: number, units: number, totalUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.BOND_ORDER_MATCHED, `order-${orderId}`, {
    buyerId, sellerId, orderId, units, totalUsd, timestamp: new Date().toISOString(),
  }), "BondOrderMatched");
}

// ── Tier 2: Letter of Credit ──────────────────────────────────────────────────
export function emitLcOpened(userId: number, lcId: number, amountUsd: number, beneficiaryName: string): void {
  safeEmit(() => publishEvent(TIER_TOPICS.LC_OPENED, `lc-${lcId}`, {
    userId, lcId, amountUsd, beneficiaryName, timestamp: new Date().toISOString(),
  }), "LcOpened");
}

export function emitLcDocumentUploaded(userId: number, lcId: number, documentType: string): void {
  safeEmit(() => publishEvent(TIER_TOPICS.LC_DOCUMENT_UPLOADED, `lc-${lcId}`, {
    userId, lcId, documentType, timestamp: new Date().toISOString(),
  }), "LcDocumentUploaded");
}

// ── Tier 2: Invoice Financing ─────────────────────────────────────────────────
export function emitInvoiceFinancingApplied(userId: number, applicationId: number, invoiceAmountUsd: number, advanceAmountUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.INVOICE_FINANCING_APPLIED, `app-${applicationId}`, {
    userId, applicationId, invoiceAmountUsd, advanceAmountUsd, timestamp: new Date().toISOString(),
  }), "InvoiceFinancingApplied");
  // OpenSearch: index the invoice financing application
  safeEmit(() => indexMarketListing({
    id: `invoice-financing-${applicationId}`,
    category: "invoice_financing",
    sellerId: String(userId),
    title: `Invoice Financing Application #${applicationId}`,
    description: `Invoice: $${invoiceAmountUsd} | Advance: $${advanceAmountUsd}`,
    price: advanceAmountUsd,
    currency: "USD",
    status: "pending_review",
    createdAt: new Date(),
  }), "OpenSearch:InvoiceFinancingApplied");
}

// ── Tier 2: Payroll Run ───────────────────────────────────────────────────────
export function emitPayrollRunCreated(userId: number, runId: number, companyId: number, grossPayrollUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.PAYROLL_RUN_CREATED, `run-${runId}`, {
    userId, runId, companyId, grossPayrollUsd, timestamp: new Date().toISOString(),
  }), "PayrollRunCreated");
}

export function emitPayrollRunApproved(runId: number, companyId: number, approvedBy: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.PAYROLL_RUN_APPROVED, `run-${runId}`, {
    runId, companyId, approvedBy, timestamp: new Date().toISOString(),
  }), "PayrollRunApproved");
  // Temporal: start payroll disbursement workflow
  safeEmit(async () => {
    const { Connection, Client } = await import("@temporalio/client");
    const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
    let temporalClient;
    try {
      const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
      temporalClient = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });
    } catch { return; }
    if (!temporalClient) return;
    await temporalClient.workflow.start("payrollDisbursementWorkflow", {
      taskQueue: "remitflow-payroll",
      workflowId: `payroll-run-${runId}-${Date.now()}`,
      args: [{ runId, companyId, approvedBy }],
    });
  }, "Temporal:PayrollRunApproved");
}

export function emitPayrollRunDisbursed(runId: number, companyId: number, netPayrollUsd: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.PAYROLL_RUN_DISBURSED, `run-${runId}`, {
    runId, companyId, netPayrollUsd, timestamp: new Date().toISOString(),
  }), "PayrollRunDisbursed");
}

// ── Tier 3: Embedded Payroll API ──────────────────────────────────────────────
export function emitEmbeddedPayrollKeyCreated(tenantId: number, keyId: number, label: string): void {
  safeEmit(() => publishEvent(TIER_TOPICS.EMBEDDED_PAYROLL_KEY_CREATED, `tenant-${tenantId}`, {
    tenantId, keyId, label, timestamp: new Date().toISOString(),
  }), "EmbeddedPayrollKeyCreated");
}

// ── Tier 3: Diaspora Mortgage ─────────────────────────────────────────────────
export function emitMortgageApplication(userId: number, applicationId: number, loanAmountUsd: number, propertyCountry: string): void {
  safeEmit(() => publishEvent(TIER_TOPICS.MORTGAGE_APPLICATION, `app-${applicationId}`, {
    userId, applicationId, loanAmountUsd, propertyCountry, timestamp: new Date().toISOString(),
  }), "MortgageApplication");
}

// ── Tier 3: Business Credit Scoring ──────────────────────────────────────────
export function emitCreditScoreGenerated(userId: number, scoreId: number, score: number, grade: string): void {
  safeEmit(() => publishEvent(TIER_TOPICS.CREDIT_SCORE_GENERATED, `user-${userId}`, {
    userId, scoreId, score, grade, timestamp: new Date().toISOString(),
  }), "CreditScoreGenerated");
}

// ── Tier 3: ESG Reporting ─────────────────────────────────────────────────────
export function emitEsgReportSubmitted(userId: number, reportId: number, companyId: number, carbonTons: number): void {
  safeEmit(() => publishEvent(TIER_TOPICS.ESG_REPORT_SUBMITTED, `report-${reportId}`, {
    userId, reportId, companyId, carbonTons, timestamp: new Date().toISOString(),
  }), "EsgReportSubmitted");
}
