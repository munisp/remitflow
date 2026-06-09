/**
 * RemitFlow — Tier 1 Feature Routers
 * Contractor Payments, Expense Management, Merchant KYB Review, Bond Secondary Market Buyer
 * All procedures call the respective Go/Rust microservices for computation.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { checkPolicy } from "../security.pbac";
import { getDb, createAuditLog } from "../db";
import {
  emitContractorInvoiceCreated,
  emitExpenseSubmitted,
  emitKybSubmitted,
  emitKybReviewed,
  emitBondOrderMatched,
} from "../middleware/tier-events";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  contractors,
  contractorInvoices,
  expensePolicies,
  expenseReports,
  expenseItems,
  merchantKybReviews,
  bondSecondaryMarketOrders,
  bondSubscriptions,
  diasporaBonds,
  payrollCompanies,
} from "../../drizzle/schema";
import { safeParseAmount } from "../lib/safeDecimal";

// ─── Helper: call Go contractor engine ───────────────────────────────────────

async function callContractorEngine(path: string, body: object) {
  try {
    const res = await fetch(`http://localhost:8210${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Contractor engine error: ${res.status}`);
    return await res.json();
  } catch {
    // Fallback: return null and let router handle gracefully
    return null;
  }
}

// ─── Helper: call Go expense policy engine ───────────────────────────────────

async function callExpenseEngine(path: string, body: object) {
  try {
    const res = await fetch(`http://localhost:8212${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Expense engine error: ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

// ─── CONTRACTOR PAYMENTS ROUTER ──────────────────────────────────────────────

export const contractorRouter = router({
  // List contractors for the authenticated user
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db
      .select()
      .from(contractors)
      .where(eq(contractors.ownerId, ctx.user.id))
      .orderBy(desc(contractors.createdAt));
  }),

  // Create a new contractor
  create: protectedProcedure
    .input(z.object({
      name:        z.string().min(2).max(200),
      email:       z.string().email(),
      country:     z.string().length(2),
      currency:    z.string().length(3),
      taxId:       z.string().optional(),
      bankAccount: z.string().optional(),
      bankName:    z.string().optional(),
      swiftCode:   z.string().optional(),
      paymentRail: z.enum(["swift", "sepa", "ach", "nip", "mobile_money", "crypto"]).default("swift"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [created] = await db
        .insert(contractors)
        .values({
          ownerId:     ctx.user.id,
          name:        input.name,
          email:       input.email,
          country:     input.country,
          currency:    input.currency,
          taxId:       input.taxId,
          bankAccount: input.bankAccount,
          bankName:    input.bankName,
          swiftCode:   input.swiftCode,
          paymentRail: input.paymentRail,
          status:      "active",
        })
        .returning();
      return created;
    }),

  // Update contractor
  update: protectedProcedure
    .input(z.object({
      id:          z.number(),
      name:        z.string().min(2).max(200).optional(),
      email:       z.string().email().optional(),
      bankAccount: z.string().optional(),
      bankName:    z.string().optional(),
      swiftCode:   z.string().optional(),
      paymentRail: z.enum(["swift", "sepa", "ach", "nip", "mobile_money", "crypto"]).optional(),
      status:      z.enum(["active", "inactive", "suspended"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...updates } = input;
      const [updated] = await db
        .update(contractors)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(contractors.id, id), eq(contractors.ownerId, ctx.user.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return updated;
    }),

  // Submit invoice for payment
  submitInvoice: protectedProcedure
    .input(z.object({
      contractorId: z.number(),
      description:  z.string().min(5),
      lineItems:    z.array(z.object({
        description: z.string(),
        quantity:    z.number().positive(),
        unitPrice:   z.number().positive(),
        total:       z.number().positive(),
      })),
      currency:     z.string().length(3).default("USD"),
      dueDate:      z.string().optional(), // ISO date string
      attachmentUrl: z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // Verify contractor belongs to user
      const [contractor] = await db
        .select()
        .from(contractors)
        .where(and(eq(contractors.id, input.contractorId), eq(contractors.ownerId, ctx.user.id)));
      if (!contractor) throw new TRPCError({ code: "NOT_FOUND", message: "Contractor not found" });
      if (contractor.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Contractor is not active" });

      const subtotal = input.lineItems.reduce((sum, li) => sum + li.total, 0);
      const taxAmount = subtotal * 0.075; // 7.5% VAT default
      const total = subtotal + taxAmount;

      // Generate invoice number
      const invoiceNumber = `INV-${Date.now()}-${ctx.user.id}`;

      // Call Go engine for routing recommendation
      const engineResult = await callContractorEngine("/route", {
        contractor_id: input.contractorId,
        amount_usd: total,
        currency: input.currency,
        destination_country: contractor.country,
        payment_rail: contractor.paymentRail,
      });

      const [invoice] = await db
        .insert(contractorInvoices)
        .values({
          contractorId:  input.contractorId,
          ownerId:       ctx.user.id,
          invoiceNumber,
          description:   input.description,
          lineItems:     input.lineItems,
          subtotalUsd:   subtotal.toFixed(2),
          taxAmountUsd:  taxAmount.toFixed(2),
          totalUsd:      total.toFixed(2),
          currency:      input.currency,
          dueDate:       input.dueDate ? new Date(input.dueDate) : undefined,
          attachmentUrl: input.attachmentUrl,
          status:        "pending",
        })
        .returning();

      emitContractorInvoiceCreated(ctx.user.id, invoice.id, total, input.contractorId);
      return { invoice, routing: engineResult };
    }),

  // List invoices
  listInvoices: protectedProcedure
    .input(z.object({
      contractorId: z.number().optional(),
      status:       z.enum(["draft", "submitted", "approved", "paid", "rejected", "cancelled"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const ownerCond = eq(contractorInvoices.ownerId, ctx.user.id);
      const contractorCond = input.contractorId ? eq(contractorInvoices.contractorId, input.contractorId) : undefined;
      const statusCond = input.status ? eq(contractorInvoices.status, input.status) : undefined;
      const whereCond = contractorCond && statusCond ? and(ownerCond, contractorCond, statusCond)
        : contractorCond ? and(ownerCond, contractorCond)
        : statusCond ? and(ownerCond, statusCond)
        : ownerCond;
      return db
        .select()
        .from(contractorInvoices)
        .where(whereCond)
        .orderBy(desc(contractorInvoices.createdAt));
    }),

  // Approve and pay invoice
  approveAndPay: protectedProcedure
    .input(z.object({ invoiceId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [invoice] = await db
        .select()
        .from(contractorInvoices)
        .where(and(eq(contractorInvoices.id, input.invoiceId), eq(contractorInvoices.ownerId, ctx.user.id)));
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (invoice.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: `Invoice is ${invoice.status}, cannot approve` });

      const paymentRef = `PAY-${Date.now()}`;
      const [updated] = await db
        .update(contractorInvoices)
        .set({ status: "paid", paidAt: new Date(), paymentRef, updatedAt: new Date() })
        .where(eq(contractorInvoices.id, input.invoiceId))
        .returning();
      return updated;
    }),

  // Reject invoice
  reject: protectedProcedure
    .input(z.object({ invoiceId: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [updated] = await db
        .update(contractorInvoices)
        .set({ status: "rejected", rejectionReason: input.reason, updatedAt: new Date() })
        .where(and(eq(contractorInvoices.id, input.invoiceId), eq(contractorInvoices.ownerId, ctx.user.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return updated;
    }),
});

// ─── EXPENSE MANAGEMENT ROUTER ───────────────────────────────────────────────

export const expenseRouter = router({
  // List expense policies for a company
  listPolicies: protectedProcedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      // Verify company ownership
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return db
        .select()
        .from(expensePolicies)
        .where(eq(expensePolicies.companyId, input.companyId));
    }),

  // Create expense policy
  createPolicy: protectedProcedure
    .input(z.object({
      companyId:       z.number(),
      name:            z.string().min(3),
      category:        z.enum(["travel", "accommodation", "meals", "equipment", "software", "marketing", "training", "other"]),
      maxAmountUsd:    z.number().positive(),
      requiresReceipt: z.boolean().default(true),
      action:          z.enum(["auto_approve", "require_review", "reject"]).default("require_review"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const [policy] = await db
        .insert(expensePolicies)
        .values({
          companyId:       input.companyId,
          name:            input.name,
          category:        input.category,
          maxAmountUsd:    input.maxAmountUsd.toFixed(2),
          requiresReceipt: input.requiresReceipt,
          action:          input.action,
        })
        .returning();
      return policy;
    }),

  // Submit expense report — PBAC: expense:submit
  submitReport: protectedProcedure
    .input(z.object({
      companyId:   z.number(),
      title:       z.string().min(3),
      description: z.string().optional(),
      items:       z.array(z.object({
        category:       z.enum(["travel", "accommodation", "meals", "equipment", "software", "marketing", "training", "other"]),
        description:    z.string().min(3),
        amountUsd:      z.number().positive(),
        currency:       z.string().length(3).default("USD"),
        expenseDate:    z.string(), // ISO date
        receiptUrl:     z.string().url().optional(),
        merchantName:   z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      checkPolicy(ctx, 'expense:submit');
      const db = await getDb();

      const totalAmount = input.items.reduce((sum, i) => sum + i.amountUsd, 0);

      // Call Go expense policy engine for auto-evaluation
      const policyResult = await callExpenseEngine("/evaluate", {
        company_id:   input.companyId,
        submitter_id: ctx.user.id,
        items: input.items.map(i => ({
          category:   i.category,
          amount_usd: i.amountUsd,
          has_receipt: !!i.receiptUrl,
        })),
      });

      // Determine initial status based on policy engine result
      const autoApproved = policyResult?.auto_approved === true;
      const status = autoApproved ? "approved" : "submitted";

      const [report] = await db
        .insert(expenseReports)
        .values({
          companyId:      input.companyId,
          submittedBy:    ctx.user.id,
          title:          input.title,
          description:    input.description,
          totalAmountUsd: totalAmount.toFixed(2),
          status,
        })
        .returning();

      // Insert line items
      if (input.items.length > 0) {
        await db.insert(expenseItems).values(
          input.items.map(item => ({
            reportId:     report.id,
            category:     item.category,
            description:  item.description,
            amountUsd:    item.amountUsd.toFixed(2),
            currency:     item.currency,
            expenseDate:  new Date(item.expenseDate),
            receiptUrl:   item.receiptUrl,
            merchantName: item.merchantName,
            status:       autoApproved ? "approved" : "pending",
          }))
        );
      }

      emitExpenseSubmitted(ctx.user.id, report.id, report.totalAmount ? Number(report.totalAmount) : 0);
      return { report, policyEvaluation: policyResult };
    }),
  // List expense reportss
  listReports: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      status:    z.enum(["draft", "submitted", "approved", "rejected", "reimbursed"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const ownerCond2 = eq(expenseReports.submittedBy, ctx.user.id);
      const companyCond = input.companyId ? eq(expenseReports.companyId, input.companyId) : undefined;
      const statusCond2 = input.status ? eq(expenseReports.status, input.status) : undefined;
      const whereCond2 = companyCond && statusCond2 ? and(ownerCond2, companyCond, statusCond2)
        : companyCond ? and(ownerCond2, companyCond)
        : statusCond2 ? and(ownerCond2, statusCond2)
        : ownerCond2;
      return db
        .select()
        .from(expenseReports)
        .where(whereCond2)
        .orderBy(desc(expenseReports.createdAt));
    }),

  // Get report with items
  getReport: protectedProcedure
    .input(z.object({ reportId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [report] = await db
        .select()
        .from(expenseReports)
        .where(and(eq(expenseReports.id, input.reportId), eq(expenseReports.submittedBy, ctx.user.id)));
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const items = await db
        .select()
        .from(expenseItems)
        .where(eq(expenseItems.reportId, input.reportId));
      return { report, items };
    }),

  // Approve report (manager action) — PBAC: expense:approve
  approveReport: protectedProcedure
    .input(z.object({ reportId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      checkPolicy(ctx, 'expense:approve');
      const db = await getDb();
      const [updated] = await db
        .update(expenseReports)
        .set({ status: "approved", approvedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(expenseReports.id, input.reportId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return updated;
    }),

  // Reimburse report
  reimburse: protectedProcedure
    .input(z.object({ reportId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [report] = await db
        .select()
        .from(expenseReports)
        .where(eq(expenseReports.id, input.reportId));
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (report.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Report must be approved before reimbursement" });

      const paymentRef = `REIMB-${Date.now()}`;
      const [updated] = await db
        .update(expenseReports)
        .set({ status: "reimbursed", reimbursedAt: new Date(), paymentRef, updatedAt: new Date() })
        .where(eq(expenseReports.id, input.reportId))
        .returning();
      return updated;
    }),
});

// ─── MERCHANT KYB REVIEW ROUTER ──────────────────────────────────────────────

export const merchantKybRouter = router({
  // Submit KYB application
  submit: protectedProcedure
    .input(z.object({
      businessName:        z.string().min(2).max(300),
      registrationNumber:  z.string().optional(),
      taxId:               z.string().optional(),
      country:             z.string().length(2),
      industry:            z.string().optional(),
      website:             z.string().url().optional(),
      expectedMonthlyVol:  z.number().positive().optional(),
      businessRegDocUrl:   z.string().url().optional(),
      directorIdDocUrl:    z.string().url().optional(),
      bankStatementDocUrl: z.string().url().optional(),
      amlPolicyDocUrl:     z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // Check for existing pending/approved application
      const [existing] = await db
        .select()
        .from(merchantKybReviews)
        .where(and(
          eq(merchantKybReviews.userId, ctx.user.id),
          sql`${merchantKybReviews.status} IN ('pending', 'under_review', 'approved')`
        ));
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You already have a KYB application with status: ${existing.status}`,
        });
      }

      const [review] = await db
        .insert(merchantKybReviews)
        .values({
          userId:              ctx.user.id,
          businessName:        input.businessName,
          registrationNumber:  input.registrationNumber,
          taxId:               input.taxId,
          country:             input.country,
          industry:            input.industry,
          website:             input.website,
          expectedMonthlyVol:  input.expectedMonthlyVol?.toFixed(2),
          businessRegDocUrl:   input.businessRegDocUrl,
          directorIdDocUrl:    input.directorIdDocUrl,
          bankStatementDocUrl: input.bankStatementDocUrl,
          amlPolicyDocUrl:     input.amlPolicyDocUrl,
          status:              "pending",
          riskRating:          "medium",
        })
        .returning();
      emitKybSubmitted(ctx.user.id, review.id, input.businessName);
      return review;
    }),
  // Get my KYB statuss
  getMyStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const [review] = await db
      .select()
      .from(merchantKybReviews)
      .where(eq(merchantKybReviews.userId, ctx.user.id))
      .orderBy(desc(merchantKybReviews.createdAt));
    return review ?? null;
  }),

  // Admin: list all KYB applications
  adminList: protectedProcedure
    .input(z.object({
      status: z.enum(["pending", "under_review", "approved", "rejected", "suspended"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      const conditions = [];
      if (input.status) conditions.push(eq(merchantKybReviews.status, input.status));
      return db
        .select()
        .from(merchantKybReviews)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(merchantKybReviews.createdAt));
    }),

  // Admin: review KYB application
  adminReview: protectedProcedure
    .input(z.object({
      reviewId:        z.number(),
      decision:        z.enum(["approved", "rejected", "under_review"]),
      riskRating:      z.enum(["low", "medium", "high", "critical"]).optional(),
      rejectionReason: z.string().optional(),
      notes:           z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      const [updated] = await db
        .update(merchantKybReviews)
        .set({
          status:          input.decision,
          reviewedBy:      ctx.user.id,
          reviewedAt:      new Date(),
          riskRating:      input.riskRating,
          rejectionReason: input.rejectionReason,
          notes:           input.notes,
        })
        .where(eq(merchantKybReviews.id, input.reviewId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return updated;
    }),
});

// ─── BOND SECONDARY MARKET BUYER ROUTER ──────────────────────────────────────

export const bondSecondaryBuyerRouter = router({
  // List open sell orders for a bond
  listOpenOrders: protectedProcedure
    .input(z.object({ bondId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      return db
        .select()
        .from(bondSecondaryMarketOrders)
        .where(and(
          eq(bondSecondaryMarketOrders.bondId, input.bondId),
          eq(bondSecondaryMarketOrders.status, "open"),
          eq(bondSecondaryMarketOrders.orderType, "sell"),
        ))
        .orderBy(bondSecondaryMarketOrders.askPrice);
    }),

  // Get YTM and pricing for a bond
  getPricing: protectedProcedure
    .input(z.object({
      bondId:         z.number(),
      marketPriceUsd: z.number().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [bond] = await db
        .select()
        .from(diasporaBonds)
        .where(eq(diasporaBonds.id, input.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const maturity = new Date(bond.maturityDate);
      const now = new Date();
      const yearsToMaturity = (maturity.getTime() - now.getTime()) / (365.25 * 24 * 3600 * 1000);

      // Call Rust bond-market-matcher YTM endpoint (fallback to TS calc if unavailable)
      try {
        const res = await fetch("http://localhost:8222/ytm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            face_value_usd:    safeParseAmount(bond.faceValue),
            coupon_rate_pct:   safeParseAmount(bond.couponRate) * 100,
            market_price_usd:  input.marketPriceUsd,
            years_to_maturity: yearsToMaturity,
            payments_per_year: 2,
          }),
        });
        if (res.ok) return await res.json();
      } catch { /* fallback */ }

      // TypeScript fallback YTM calculation
      const fv = safeParseAmount(bond.faceValue);
      const c = fv * safeParseAmount(bond.couponRate) / 2;
      const n = Math.round(yearsToMaturity * 2);
      const p = input.marketPriceUsd;
      // Approximation: YTM ≈ (C + (FV-P)/n) / ((FV+P)/2)
      const ytm = n > 0 ? ((c + (fv - p) / n) / ((fv + p) / 2)) * 2 * 100 : 0;
      return {
        ytm_pct: Math.round(ytm * 100) / 100,
        clean_price_usd: p,
        dirty_price_usd: p + c * 0.5,
        accrued_interest_usd: c * 0.5,
        years_to_maturity: Math.round(yearsToMaturity * 100) / 100,
      };
    }),

  // Place a buy order (match against open sell orders)
  buy: protectedProcedure
    .input(z.object({
      bondId:       z.number(),
      units:        z.number().int().positive(),
      maxPriceUsd:  z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // Get open sell orders
      const openOrders = await db
        .select()
        .from(bondSecondaryMarketOrders)
        .where(and(
          eq(bondSecondaryMarketOrders.bondId, input.bondId),
          eq(bondSecondaryMarketOrders.status, "open"),
          eq(bondSecondaryMarketOrders.orderType, "sell"),
        ))
        .orderBy(bondSecondaryMarketOrders.askPrice);

      if (openOrders.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No open sell orders for this bond" });
      }

      // Find best matching order
      const eligible = openOrders.filter((o: any) => safeParseAmount(o.askPrice) <= input.maxPriceUsd);
      if (eligible.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No orders available at or below $${input.maxPriceUsd}. Best ask: $${openOrders[0].askPrice}`,
        });
      }

      const bestOrder = eligible[0];
      const fillUnits = Math.min(input.units, bestOrder.units);
      const matchedPrice = safeParseAmount(bestOrder.askPrice);
      const totalValue = fillUnits * matchedPrice;

      // Update the sell order
      await db
        .update(bondSecondaryMarketOrders)
        .set({
          buyerId:      ctx.user.id,
          matchedPrice: matchedPrice.toFixed(2),
          totalValue:   totalValue.toFixed(2),
          status:       fillUnits === bestOrder.units ? "matched" : "partial",
          matchedAt:    new Date(),
          updatedAt:    new Date(),
        })
        .where(eq(bondSecondaryMarketOrders.id, bestOrder.id));

      // Create a new subscription for the buyer
      const subscriptionRef = `BOND-SM-${Date.now()}-${ctx.user.id}`;
      const [newSub] = await db
        .insert(bondSubscriptions)
        .values({
          userId:          ctx.user.id,
          bondId:          input.bondId,
          subscriptionRef,
          units:           fillUnits,
          faceValue:       (fillUnits * safeParseAmount(bestOrder.askPrice)).toFixed(2),
          purchasePrice:   matchedPrice.toFixed(2),
          totalPaid:       totalValue.toFixed(2),
          currency:        bestOrder.currency ?? "USD",
          status:          "active",
        })
        .returning();

      return {
        subscription: newSub,
        fill: {
          orderId:       bestOrder.id,
          units:         fillUnits,
          pricePerUnit:  matchedPrice,
          totalValueUsd: totalValue,
          sellerId:      bestOrder.sellerId,
        },
      };
    }),
});
