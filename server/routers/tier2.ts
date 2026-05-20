/**
 * RemitFlow — Tier 2 Feature Routers
 * Invoice Financing, Supply Chain / Letter of Credit, Multi-Entity Treasury,
 * Payroll Tax Filing, Business Savings
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { checkPolicy } from "../security.pbac";
import { getDb, createAuditLog } from "../db";
import {
  emitInvoiceFinancingApplied,
  emitSavingsAccountOpened,
  emitSavingsDeposit,
  emitSavingsWithdrawal,
  emitLcOpened,
  emitLcDocumentUploaded,
  emitPayrollRunCreated,
  emitPayrollRunApproved,
} from "../middleware/tier-events";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  invoiceFinancingApplications,
  invoiceFinancingRepayments,
  lettersOfCredit,
  lcDocuments,
  entityGroups,
  entityGroupMembers,
  intercompanyTransfers,
  payrollTaxFilings,
  businessSavingsProducts,
  businessSavingsAccounts,
  businessSavingsTxns,
  payrollCompanies,
  payrollRuns,
} from "../../drizzle/schema";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function callTaxSidecar(path: string, body: object) {
  try {
    const res = await fetch(`http://localhost:8230${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function callTreasuryEngine(path: string, body: object) {
  try {
    const res = await fetch(`http://localhost:8211${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── INVOICE FINANCING ROUTER ────────────────────────────────────────────────

export const invoiceFinancingRouter = router({
  // Apply for invoice financing — PBAC: invoice_financing:apply
  applyForFinancing: protectedProcedure
    .input(z.object({
      invoiceNumber:    z.string().min(3),
      debtorName:       z.string().min(2),
      debtorCountry:    z.string().length(2).optional(),
      invoiceAmountUsd: z.number().positive(),
      advanceRatePct:   z.number().min(50).max(90).default(80),
      invoiceDocUrl:    z.string().url().optional(),
      invoiceDueDate:   z.string(), // ISO date
    }))
    .mutation(async ({ ctx, input }) => {
      checkPolicy(ctx, 'invoice_financing:apply');
      const db = await getDb();

      // Business rule: max $500k per application
      if (input.invoiceAmountUsd > 500000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum invoice financing amount is $500,000 per application" });
      }

      const advanceAmount = input.invoiceAmountUsd * (input.advanceRatePct / 100);
      // Fee: 2.5% of advance amount
      const feeAmount = advanceAmount * 0.025;
      const netAdvance = advanceAmount - feeAmount;
      const dueDate = new Date(input.invoiceDueDate);
      const daysToMaturity = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      if (daysToMaturity < 14) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice must be due at least 14 days from today" });
      }

      const [application] = await db
        .insert(invoiceFinancingApplications)
        .values({
          applicantId:      ctx.user.id,
          invoiceNumber:    input.invoiceNumber,
          debtorName:       input.debtorName,
          debtorCountry:    input.debtorCountry,
          invoiceAmountUsd: input.invoiceAmountUsd.toFixed(2),
          advanceRatePct:   input.advanceRatePct.toFixed(2),
          advanceAmountUsd: advanceAmount.toFixed(2),
          feeAmountUsd:     feeAmount.toFixed(2),
          netAdvanceUsd:    netAdvance.toFixed(2),
          invoiceDocUrl:    input.invoiceDocUrl,
          invoiceDueDate:   dueDate,
          status:           "pending_review",
        })
        .returning();

      emitInvoiceFinancingApplied(ctx.user.id, application.id, input.invoiceAmountUsd, advanceAmount);
      return { application, summary: { advanceAmount, feeAmount, netAdvance, daysToMaturity } };
    }),

  // List my applications
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["draft", "submitted", "under_review", "approved", "funded", "repaying", "repaid", "rejected", "defaulted"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const ownerCond = eq(invoiceFinancingApplications.applicantId, ctx.user.id);
      const statusCond = input.status ? eq(invoiceFinancingApplications.status, input.status) : undefined;
      return db
        .select()
        .from(invoiceFinancingApplications)
        .where(statusCond ? and(ownerCond, statusCond) : ownerCond)
        .orderBy(desc(invoiceFinancingApplications.createdAt));
    }),

  // Admin: approve and fund
  adminFund: protectedProcedure
    .input(z.object({ applicationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      const [app] = await db
        .select()
        .from(invoiceFinancingApplications)
        .where(eq(invoiceFinancingApplications.id, input.applicationId));
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      if (app.status !== "pending_review") throw new TRPCError({ code: "BAD_REQUEST", message: `Application is ${app.status}` });

      const fundingRef = `IF-${Date.now()}`;
      const [updated] = await db
        .update(invoiceFinancingApplications)
        .set({ status: "funded", fundingRef, fundedAt: new Date(), updatedAt: new Date() })
        .where(eq(invoiceFinancingApplications.id, input.applicationId))
        .returning();
      return updated;
    }),

  // Record repayment
  repay: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      amountUsd:     z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [app] = await db
        .select()
        .from(invoiceFinancingApplications)
        .where(and(eq(invoiceFinancingApplications.id, input.applicationId), eq(invoiceFinancingApplications.applicantId, ctx.user.id)));
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      if (app.status !== "funded") throw new TRPCError({ code: "BAD_REQUEST", message: "Application is not in funded state" });

      const [repayment] = await db
        .insert(invoiceFinancingRepayments)
        .values({
          applicationId: input.applicationId,
          amountUsd:     input.amountUsd.toFixed(2),
          paymentRef:    `IFREPAY-${Date.now()}`,
          paidAt:        new Date(),
        })
        .returning();

      // Check if fully repaid
      const totalRepaid = await db
        .select({ total: sql<number>`SUM(${invoiceFinancingRepayments.amountUsd})` })
        .from(invoiceFinancingRepayments)
        .where(eq(invoiceFinancingRepayments.applicationId, input.applicationId));

      const repaidAmount = Number(totalRepaid[0]?.total ?? 0);
      const advanceAmount = Number(app.advanceAmountUsd);

      if (repaidAmount >= advanceAmount) {
        await db
          .update(invoiceFinancingApplications)
          .set({ status: "repaid", updatedAt: new Date() })
          .where(eq(invoiceFinancingApplications.id, input.applicationId));
      }

      return { repayment, totalRepaid: repaidAmount, fullyRepaid: repaidAmount >= advanceAmount };
    }),
});

// ─── LETTER OF CREDIT ROUTER ─────────────────────────────────────────────────

export const letterOfCreditRouter = router({
  // Open an LC — PBAC: lc:open
  open: protectedProcedure
    .input(z.object({
      beneficiaryName:    z.string().min(2),
      beneficiaryCountry: z.string().length(2),
      beneficiaryBank:    z.string().optional(),
      lcType:             z.enum(["sight", "usance", "standby", "revolving"]).default("sight"),
      currency:           z.string().length(3).default("USD"),
      amountUsd:          z.number().positive(),
      expiryDate:         z.string(), // ISO date
      description:        z.string().optional(),
      requiredDocuments:  z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      checkPolicy(ctx, 'lc:open', { amountUsd: input.amountUsd });
      const db = await getDb();

      // Business rule: max $2M per LC
      if (input.amountUsd > 2_000_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum LC amount is $2,000,000" });
      }

      const expiry = new Date(input.expiryDate);
      const daysToExpiry = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysToExpiry < 30) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "LC expiry must be at least 30 days from today" });
      }

      const lcRef = `LC-${Date.now()}-${ctx.user.id}`;
      const [lc] = await db
        .insert(lettersOfCredit)
        .values({
          applicantId:        ctx.user.id,
          beneficiaryName:    input.beneficiaryName,
          beneficiaryCountry: input.beneficiaryCountry,
          beneficiaryBank:    input.beneficiaryBank,
          lcType:             input.lcType,
          currency:           input.currency,
          amountUsd:          input.amountUsd.toFixed(2),
          expiryDate:         expiry,
          description:        input.description,
          requiredDocuments:  input.requiredDocuments,
          lcRef,
          status:             "draft",
        })
        .returning();
      emitLcOpened(ctx.user.id, lc.id, input.amountUsd, input.beneficiaryName);
      return lc;
    }),

  // List my LCs
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["draft", "submitted", "issued", "advised", "documents_presented", "documents_checked", "payment_authorised", "settled", "expired", "cancelled"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const ownerCond = eq(lettersOfCredit.applicantId, ctx.user.id);
      const statusCond = input.status ? eq(lettersOfCredit.status, input.status) : undefined;
      return db
        .select()
        .from(lettersOfCredit)
        .where(statusCond ? and(ownerCond, statusCond) : ownerCond)
        .orderBy(desc(lettersOfCredit.createdAt));
    }),

  // Upload document for LC
  uploadDocument: protectedProcedure
    .input(z.object({
      lcId:         z.number(),
      documentType: z.string().min(3),
      documentUrl:  z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [lc] = await db
        .select()
        .from(lettersOfCredit)
        .where(and(eq(lettersOfCredit.id, input.lcId), eq(lettersOfCredit.applicantId, ctx.user.id)));
      if (!lc) throw new TRPCError({ code: "NOT_FOUND" });

      const [doc] = await db
        .insert(lcDocuments)
        .values({
          lcId:         input.lcId,
          documentType: input.documentType,
          documentUrl:  input.documentUrl,
          uploadedBy:   ctx.user.id,
        })
        .returning();
      return doc;
    }),

  // Get LC with documents
  getWithDocuments: protectedProcedure
    .input(z.object({ lcId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [lc] = await db
        .select()
        .from(lettersOfCredit)
        .where(and(eq(lettersOfCredit.id, input.lcId), eq(lettersOfCredit.applicantId, ctx.user.id)));
      if (!lc) throw new TRPCError({ code: "NOT_FOUND" });
      const documents = await db
        .select()
        .from(lcDocuments)
        .where(eq(lcDocuments.lcId, input.lcId));
      return { lc, documents };
    }),

  // Admin: issue LC
  adminIssue: protectedProcedure
    .input(z.object({ lcId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      const [updated] = await db
        .update(lettersOfCredit)
        .set({ status: "issued", issuedAt: new Date(), updatedAt: new Date() })
        .where(eq(lettersOfCredit.id, input.lcId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),
});

// ─── MULTI-ENTITY TREASURY ROUTER ────────────────────────────────────────────

export const multiEntityTreasuryRouter = router({
  // Create entity group
  createGroup: protectedProcedure
    .input(z.object({
      name:         z.string().min(2),
      description:  z.string().optional(),
      baseCurrency: z.string().length(3).default("USD"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [group] = await db
        .insert(entityGroups)
        .values({
          ownerId:      ctx.user.id,
          name:         input.name,
          description:  input.description,
          baseCurrency: input.baseCurrency,
          status:       "active",
        })
        .returning();
      return group;
    }),

  // List my entity groups
  listGroups: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db
      .select()
      .from(entityGroups)
      .where(eq(entityGroups.ownerId, ctx.user.id))
      .orderBy(desc(entityGroups.createdAt));
  }),

  // Add company to entity group
  addMember: protectedProcedure
    .input(z.object({
      groupId:   z.number(),
      companyId: z.number(),
      role:      z.enum(["parent", "subsidiary", "branch"]).default("subsidiary"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Verify group ownership
      const [group] = await db
        .select()
        .from(entityGroups)
        .where(and(eq(entityGroups.id, input.groupId), eq(entityGroups.ownerId, ctx.user.id)));
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });

      const [member] = await db
        .insert(entityGroupMembers)
        .values({ groupId: input.groupId, companyId: input.companyId, role: input.role })
        .returning();
      return member;
    }),

  // Initiate intercompany transfer
  transfer: protectedProcedure
    .input(z.object({
      groupId:       z.number(),
      fromCompanyId: z.number(),
      toCompanyId:   z.number(),
      amountUsd:     z.number().positive(),
      fromCurrency:  z.string().length(3),
      toCurrency:    z.string().length(3),
      purpose:       z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // Verify group ownership
      const [group] = await db
        .select()
        .from(entityGroups)
        .where(and(eq(entityGroups.id, input.groupId), eq(entityGroups.ownerId, ctx.user.id)));
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });

      // Call Go treasury netting engine for FX rate
      const fxResult = await callTreasuryEngine("/fx-rate", {
        from_currency: input.fromCurrency,
        to_currency:   input.toCurrency,
        amount_usd:    input.amountUsd,
      });

      const fxRate = fxResult?.rate ?? 1.0;

      const [transfer] = await db
        .insert(intercompanyTransfers)
        .values({
          groupId:       input.groupId,
          fromCompanyId: input.fromCompanyId,
          toCompanyId:   input.toCompanyId,
          amountUsd:     input.amountUsd.toFixed(2),
          fromCurrency:  input.fromCurrency,
          toCurrency:    input.toCurrency,
          fxRate:        fxRate.toFixed(8),
          purpose:       input.purpose,
          status:        "pending",
        })
        .returning();

      return { transfer, fxRate, toAmount: input.amountUsd * fxRate };
    }),

  // Approve intercompany transfer
  approveTransfer: protectedProcedure
    .input(z.object({ transferId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [updated] = await db
        .update(intercompanyTransfers)
        .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(intercompanyTransfers.id, input.transferId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  // List intercompany transfers for a group
  listTransfers: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      return db
        .select()
        .from(intercompanyTransfers)
        .where(eq(intercompanyTransfers.groupId, input.groupId))
        .orderBy(desc(intercompanyTransfers.createdAt));
    }),

  // Get netting report (Go engine)
  getNettingReport: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const transfers = await db
        .select()
        .from(intercompanyTransfers)
        .where(and(eq(intercompanyTransfers.groupId, input.groupId), eq(intercompanyTransfers.status, "pending")));

      const result = await callTreasuryEngine("/net", {
        group_id:  input.groupId,
        transfers: transfers.map((t: any) => ({
          from_company_id: t.fromCompanyId,
          to_company_id:   t.toCompanyId,
          amount_usd:      parseFloat(t.amountUsd),
          from_currency:   t.fromCurrency,
          to_currency:     t.toCurrency,
        })),
      });

      return result ?? { netted_transfers: [], gross_total_usd: 0, net_total_usd: 0, savings_usd: 0 };
    }),
});

// ─── PAYROLL TAX FILING ROUTER ───────────────────────────────────────────────

export const payrollTaxFilingRouter = router({
  // Calculate tax filing for a payroll run
  calculate: protectedProcedure
    .input(z.object({
      companyId:    z.number(),
      payrollRunId: z.number().optional(),
      jurisdiction: z.string().length(2),
      periodStart:  z.string(), // ISO date
      periodEnd:    z.string(), // ISO date
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // Verify company ownership
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "NOT_FOUND" });

      // Get payroll run data if provided
      let runData = null;
      if (input.payrollRunId) {
        const [run] = await db
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, input.payrollRunId));
        runData = run;
      }

      // Call Python tax sidecar for calculation
      const taxResult = await callTaxSidecar("/calculate", {
        jurisdiction:    input.jurisdiction,
        period_start:    input.periodStart,
        period_end:      input.periodEnd,
        total_gross_usd: runData ? parseFloat(runData.totalGrossUsd ?? "0") : 0,
        employee_count:  runData ? (runData.totalEmployees ?? 0) : 0,
      });

      const totalGross = runData ? parseFloat(runData.totalGrossUsd ?? "0") : 0;
      const totalTax = taxResult?.total_tax_usd ?? totalGross * 0.075;
      const totalPension = taxResult?.total_pension_usd ?? totalGross * 0.08;

      const [filing] = await db
        .insert(payrollTaxFilings)
        .values({
          companyId:       input.companyId,
          payrollRunId:    input.payrollRunId,
          jurisdiction:    input.jurisdiction,
          periodStart:     new Date(input.periodStart),
          periodEnd:       new Date(input.periodEnd),
          totalGrossUsd:   totalGross.toFixed(2),
          totalTaxUsd:     totalTax.toFixed(2),
          totalPensionUsd: totalPension.toFixed(2),
          employeeCount:   runData?.totalEmployees ?? 0,
          status:          "calculated",
        })
        .returning();

      return { filing, taxBreakdown: taxResult };
    }),

  // Submit filing
  submit: protectedProcedure
    .input(z.object({
      filingId:        z.number(),
      filingReference: z.string().optional(),
      filingDocUrl:    z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [updated] = await db
        .update(payrollTaxFilings)
        .set({
          status:          "submitted",
          filingReference: input.filingReference,
          filingDocUrl:    input.filingDocUrl,
          submittedAt:     new Date(),
          updatedAt:       new Date(),
        })
        .where(eq(payrollTaxFilings.id, input.filingId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  // List filings for a company
  list: protectedProcedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "NOT_FOUND" });
      return db
        .select()
        .from(payrollTaxFilings)
        .where(eq(payrollTaxFilings.companyId, input.companyId))
        .orderBy(desc(payrollTaxFilings.periodStart));
    }),
});

// ─── BUSINESS SAVINGS ROUTER ─────────────────────────────────────────────────

export const businessSavingsRouter = router({
  // List available savings products
  listProducts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db
      .select()
      .from(businessSavingsProducts)
      .where(eq(businessSavingsProducts.isActive, true));
  }),

  // Open a savings account
  openAccount: protectedProcedure
    .input(z.object({
      companyId:    z.number(),
      productId:    z.number(),
      principalUsd: z.number().positive(),
      autoRenew:    z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // Verify company ownership
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });

      // Get product
      const [product] = await db
        .select()
        .from(businessSavingsProducts)
        .where(and(eq(businessSavingsProducts.id, input.productId), eq(businessSavingsProducts.isActive, true)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Savings product not found" });

      // Business rules
      if (input.principalUsd < parseFloat(product.minDepositUsd)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Minimum deposit is $${product.minDepositUsd}` });
      }
      if (input.principalUsd > parseFloat(product.maxDepositUsd)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum deposit is $${product.maxDepositUsd}` });
      }

      const startDate = new Date();
      const maturityDate = product.termDays
        ? new Date(startDate.getTime() + product.termDays * 24 * 60 * 60 * 1000)
        : undefined;

      const [account] = await db
        .insert(businessSavingsAccounts)
        .values({
          companyId:          input.companyId,
          ownerId:            ctx.user.id,
          productId:          input.productId,
          principalUsd:       input.principalUsd.toFixed(2),
          currentBalanceUsd:  input.principalUsd.toFixed(2),
          accruedInterestUsd: "0",
          startDate,
          maturityDate,
          status:             "active",
          autoRenew:          input.autoRenew,
        })
        .returning();

      // Record deposit transaction
      await db.insert(businessSavingsTxns).values({
        accountId:   account.id,
        type:        "deposit",
        amountUsd:   input.principalUsd.toFixed(2),
        description: "Initial deposit",
        balanceAfter: input.principalUsd.toFixed(2),
      });

      return { account, product };
    }),

  // List my savings accounts
  listAccounts: protectedProcedure
    .input(z.object({ companyId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const ownerCond = eq(businessSavingsAccounts.ownerId, ctx.user.id);
      const companyCond = input.companyId ? eq(businessSavingsAccounts.companyId, input.companyId) : undefined;
      return db
        .select()
        .from(businessSavingsAccounts)
        .where(companyCond ? and(ownerCond, companyCond) : ownerCond)
        .orderBy(desc(businessSavingsAccounts.createdAt));
    }),

  // Get account with transactions
  getAccount: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [account] = await db
        .select()
        .from(businessSavingsAccounts)
        .where(and(eq(businessSavingsAccounts.id, input.accountId), eq(businessSavingsAccounts.ownerId, ctx.user.id)));
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });

      const [product] = await db
        .select()
        .from(businessSavingsProducts)
        .where(eq(businessSavingsProducts.id, account.productId));

      const txns = await db
        .select()
        .from(businessSavingsTxns)
        .where(eq(businessSavingsTxns.accountId, input.accountId))
        .orderBy(desc(businessSavingsTxns.createdAt));

      // Calculate projected interest
      const principal = parseFloat(account.principalUsd);
      const annualRate = parseFloat(product?.annualRatePct ?? "0") / 100;
      const daysElapsed = Math.ceil((Date.now() - account.startDate.getTime()) / (1000 * 60 * 60 * 24));
      const projectedInterest = principal * annualRate * (daysElapsed / 365);

      return { account, product, txns, projectedInterest };
    }),

  // Withdraw from savings account
  withdraw: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      amountUsd: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [account] = await db
        .select()
        .from(businessSavingsAccounts)
        .where(and(eq(businessSavingsAccounts.id, input.accountId), eq(businessSavingsAccounts.ownerId, ctx.user.id)));
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });
      if (account.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Account is not active" });

      const currentBalance = parseFloat(account.currentBalanceUsd);
      if (input.amountUsd > currentBalance) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient balance. Available: $${currentBalance.toFixed(2)}` });
      }

      // Check early withdrawal penalty (if term product)
      const [product] = await db
        .select()
        .from(businessSavingsProducts)
        .where(eq(businessSavingsProducts.id, account.productId));

      let penalty = 0;
      if (product?.termDays && account.maturityDate && new Date() < account.maturityDate) {
        penalty = input.amountUsd * 0.015; // 1.5% early withdrawal penalty
      }

      const netWithdrawal = input.amountUsd - penalty;
      const newBalance = currentBalance - input.amountUsd;

      await db
        .update(businessSavingsAccounts)
        .set({
          currentBalanceUsd: newBalance.toFixed(2),
          status: newBalance <= 0 ? "closed" : "active",
          withdrawnAt: newBalance <= 0 ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(businessSavingsAccounts.id, input.accountId));

      await db.insert(businessSavingsTxns).values({
        accountId:    input.accountId,
        type:         "withdrawal",
        amountUsd:    input.amountUsd.toFixed(2),
        description:  penalty > 0 ? `Withdrawal (early penalty: $${penalty.toFixed(2)})` : "Withdrawal",
        balanceAfter: newBalance.toFixed(2),
      });

      return { netWithdrawal, penalty, newBalance };
    }),
});
