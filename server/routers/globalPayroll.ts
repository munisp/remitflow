/**
 * RemitFlow — Global Payroll Router
 * Full business rules: company setup, employee management, payroll run lifecycle,
 * multi-jurisdiction tax calculation (via Go engine), disbursement, reports
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb, createAuditLog } from "../db";
import {
  payrollCompanies,
  payrollEmployees,
  payrollRuns,
  payrollRunItems,
  payrollDisbursements,
  payrollTaxConfigs,
  transactions,
} from "../../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { logger } from '../_core/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYROLL_ENGINE_URL = process.env.PAYROLL_ENGINE_URL || "http://localhost:8200";
const COMPLIANCE_URL = process.env.COMPLIANCE_URL || "http://localhost:8202";

async function callPayrollEngine(path: string, body: unknown) {
  try {
    const res = await fetch(`${PAYROLL_ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Engine returned ${res.status}`);
    return res.json();
  } catch (err) {
    logger.error({ err: err }, '[payroll-engine] call failed:');
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payroll engine unavailable" });
  }
}

async function callComplianceService(path: string, body?: unknown) {
  try {
    const res = await fetch(`${COMPLIANCE_URL}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null; // compliance service is non-blocking
  }
}

function genRunRef(companyId: number): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `PAY-${companyId}-${ts}`;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const CompanySchema = z.object({
  name: z.string().min(2).max(200),
  registrationNumber: z.string().optional(),
  taxId: z.string().optional(),
  country: z.string().length(2),
  baseCurrency: z.string().length(3).default("USD"),
  logoUrl: z.string().url().optional(),
});

const EmployeeSchema = z.object({
  companyId: z.number().int().positive(),
  employeeCode: z.string().min(1).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  employmentType: z.enum(["full_time", "part_time", "contractor", "intern"]).default("full_time"),
  jurisdiction: z.enum(["NG", "GB", "US", "CA", "DE", "FR", "IT", "AE", "GH", "KE", "ZA"]),
  country: z.string().length(2),
  grossSalary: z.number().positive(),
  salaryCurrency: z.string().length(3).default("USD"),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankRoutingCode: z.string().optional(),
  mobileMoneyNum: z.string().optional(),
  preferredChannel: z.enum(["bank", "mobile_money", "wallet"]).default("bank"),
  taxCode: z.string().optional(),
  nationalId: z.string().optional(),
  startDate: z.string().optional(),
});

const RunSchema = z.object({
  companyId: z.number().int().positive(),
  periodStart: z.string(),
  periodEnd: z.string(),
  payDate: z.string(),
  frequency: z.enum(["weekly", "bi_weekly", "semi_monthly", "monthly"]).default("monthly"),
  notes: z.string().optional(),
  employeeIds: z.array(z.number()).optional(), // if empty, include all active
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const globalPayrollRouter = router({

  // ── Company ────────────────────────────────────────────────────────────────

  createCompany: protectedProcedure
    .input(CompanySchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .insert(payrollCompanies)
        .values({ ...input, ownerId: ctx.user.id })
        .returning();
      return company;
    }),

  listCompanies: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
    return db
      .select()
      .from(payrollCompanies)
      .where(eq(payrollCompanies.ownerId, ctx.user.id))
      .orderBy(desc(payrollCompanies.createdAt));
  }),

  getCompany: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.id), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "NOT_FOUND" });
      return company;
    }),

  updateCompany: protectedProcedure
    .input(CompanySchema.partial().extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...data } = input;
      const [updated] = await db
        .update(payrollCompanies)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(payrollCompanies.id, id), eq(payrollCompanies.ownerId, ctx.user.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  // ── Employees ──────────────────────────────────────────────────────────────

  addEmployee: protectedProcedure
    .input(EmployeeSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Verify company ownership
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      // Tax preview from Go engine
      let taxPreview = null;
      try {
        taxPreview = await callPayrollEngine("/tax-preview", {
          employee_id: 0,
          employee_code: input.employeeCode,
          first_name: input.firstName,
          last_name: input.lastName,
          gross_salary: input.grossSalary,
          salary_currency: input.salaryCurrency,
          jurisdiction: input.jurisdiction,
          employment_type: input.employmentType,
        });
      } catch { /* non-blocking */ }

      const [employee] = await db
        .insert(payrollEmployees)
        .values({
          ...input,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
        })
        .returning();

      // Update company employee count
      await db
        .update(payrollCompanies)
        .set({ totalEmployees: sql`${payrollCompanies.totalEmployees} + 1`, updatedAt: new Date() })
        .where(eq(payrollCompanies.id, input.companyId));

      return { employee, taxPreview };
    }),

  listEmployees: protectedProcedure
    .input(z.object({ companyId: z.number(), activeOnly: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      return db
        .select()
        .from(payrollEmployees)
        .where(
          input.activeOnly
            ? and(eq(payrollEmployees.companyId, input.companyId), eq(payrollEmployees.isActive, true))
            : eq(payrollEmployees.companyId, input.companyId)
        )
        .orderBy(payrollEmployees.lastName);
    }),

  updateEmployee: protectedProcedure
    .input(EmployeeSchema.partial().extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...data } = input;
      const [emp] = await db.select().from(payrollEmployees).where(eq(payrollEmployees.id, id));
      if (!emp) throw new TRPCError({ code: "NOT_FOUND" });

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, emp.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      const [updated] = await db
        .update(payrollEmployees)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(payrollEmployees.id, id))
        .returning();
      return updated;
    }),

  terminateEmployee: protectedProcedure
    .input(z.object({ id: z.number(), endDate: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [emp] = await db.select().from(payrollEmployees).where(eq(payrollEmployees.id, input.id));
      if (!emp) throw new TRPCError({ code: "NOT_FOUND" });

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, emp.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      const [updated] = await db
        .update(payrollEmployees)
        .set({ isActive: false, endDate: new Date(input.endDate), updatedAt: new Date() })
        .where(eq(payrollEmployees.id, input.id))
        .returning();

      await db
        .update(payrollCompanies)
        .set({ totalEmployees: sql`${payrollCompanies.totalEmployees} - 1`, updatedAt: new Date() })
        .where(eq(payrollCompanies.id, emp.companyId));

      return updated;
    }),

  getTaxPreview: protectedProcedure
    .input(z.object({
      grossSalary: z.number(),
      salaryCurrency: z.string(),
      jurisdiction: z.string(),
      employmentType: z.string().default("full_time"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      return callPayrollEngine("/tax-preview", {
        employee_id: 0,
        employee_code: "PREVIEW",
        first_name: "Preview",
        last_name: "User",
        gross_salary: input.grossSalary,
        salary_currency: input.salaryCurrency,
        jurisdiction: input.jurisdiction,
        employment_type: input.employmentType,
      });
    }),

  // ── Payroll Runs ───────────────────────────────────────────────────────────

  createRun: protectedProcedure
    .input(RunSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      // Get employees for this run
      const employeeQuery = input.employeeIds?.length
        ? and(
            eq(payrollEmployees.companyId, input.companyId),
            eq(payrollEmployees.isActive, true),
            inArray(payrollEmployees.id, input.employeeIds)
          )
        : and(eq(payrollEmployees.companyId, input.companyId), eq(payrollEmployees.isActive, true));

      const employees = await db.select().from(payrollEmployees).where(employeeQuery);
      if (!employees.length) throw new TRPCError({ code: "BAD_REQUEST", message: "No active employees found" });

      // Validate with compliance service
      const validation = await callComplianceService("/validate-run", {
        company: { name: company.name, country: company.country },
        employees: employees.map((e) => ({
          employee_code: e.employeeCode,
          jurisdiction: e.jurisdiction,
          gross_salary: Number(e.grossSalary),
          salary_currency: e.salaryCurrency,
          bank_account: e.bankAccount,
          mobile_money_num: e.mobileMoneyNum,
          tax_code: e.taxCode,
        })),
      });

      if (validation && !validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Compliance validation failed: ${validation.errors.map((e: any) => e.message).join("; ")}`,
        });
      }

      // Call Go engine for calculations
      const engineResult = await callPayrollEngine("/calculate-run", {
        company_id: input.companyId,
        run_reference: genRunRef(input.companyId),
        period_start: input.periodStart,
        period_end: input.periodEnd,
        pay_date: input.payDate,
        frequency: input.frequency,
        employees: employees.map((e) => ({
          employee_id: e.id,
          employee_code: e.employeeCode,
          first_name: e.firstName,
          last_name: e.lastName,
          gross_salary: Number(e.grossSalary),
          salary_currency: e.salaryCurrency,
          jurisdiction: e.jurisdiction,
          employment_type: e.employmentType,
          other_deductions: 0,
        })),
      });

      // Persist run
      const [run] = await db
        .insert(payrollRuns)
        .values({
          companyId: input.companyId,
          runReference: engineResult.run_reference,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          payDate: new Date(input.payDate),
          frequency: input.frequency,
          status: "draft",
          totalGrossUsd: String(engineResult.total_gross_usd),
          totalTaxUsd: String(engineResult.total_tax_usd),
          totalDeductUsd: String(engineResult.total_deduct_usd),
          totalNetUsd: String(engineResult.total_net_usd),
          totalFeeUsd: String(engineResult.total_fee_usd),
          employeeCount: engineResult.employee_count,
          notes: input.notes,
          engineResponse: engineResult,
        })
        .returning();

      // Persist run items
      const items = engineResult.items.map((item: any) => ({
        runId: run.id,
        employeeId: item.employee_id,
        grossSalary: String(item.gross_salary),
        grossCurrency: item.gross_currency,
        grossUsd: String(item.gross_usd),
        fxRate: String(item.fx_rate),
        incomeTax: String(item.tax_breakdown.income_tax),
        socialSecurity: String(item.tax_breakdown.social_security),
        pension: String(item.tax_breakdown.pension),
        nhf: String(item.tax_breakdown.nhf),
        nhis: String(item.tax_breakdown.nhis),
        otherDeductions: "0",
        totalDeductions: String(item.tax_breakdown.total_deductions),
        netPay: String(item.net_pay),
        netCurrency: item.net_currency,
        netUsd: String(item.net_usd),
        remitFee: String(item.remit_fee),
        status: "pending" as const,
        taxBreakdown: item.tax_breakdown,
      }));

      await db.insert(payrollRunItems).values(items);

      return { run, itemCount: items.length, engineResult };
    }),

  listRuns: protectedProcedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      return db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.companyId, input.companyId))
        .orderBy(desc(payrollRuns.createdAt));
    }),

  getRunDetail: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      const items = await db
        .select({
          item: payrollRunItems,
          employee: payrollEmployees,
        })
        .from(payrollRunItems)
        .leftJoin(payrollEmployees, eq(payrollRunItems.employeeId, payrollEmployees.id))
        .where(eq(payrollRunItems.runId, input.runId));

      return { run, items };
    }),

  approveRun: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      if (run.status !== "draft" && run.status !== "pending_approval") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot approve run in status: ${run.status}` });
      }

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      const [updated] = await db
        .update(payrollRuns)
        .set({ status: "approved", approvedByUserId: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(payrollRuns.id, input.runId))
        .returning();
      return updated;
    }),

  disburseRun: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      if (run.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Run must be approved before disbursement" });
      }

      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      // Update run status to processing
      await db
        .update(payrollRuns)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(payrollRuns.id, input.runId));

      // Get all pending items
      const items = await db
        .select()
        .from(payrollRunItems)
        .where(and(eq(payrollRunItems.runId, input.runId), eq(payrollRunItems.status, "pending")));

      // Group by currency for batch disbursement
      const byCurrency: Record<string, typeof items> = {};
      for (const item of items) {
        const key = item.netCurrency;
        if (!byCurrency[key]) byCurrency[key] = [];
        byCurrency[key].push(item);
      }

      const disbursements = [];
      for (const [currency, currItems] of Object.entries(byCurrency)) {
        const totalAmount = currItems.reduce((s, i) => s + Number(i.netPay), 0);
        const batchRef = `DISB-${run.runReference}-${currency}`;

        const [disb] = await db
          .insert(payrollDisbursements)
          .values({
            runId: input.runId,
            batchReference: batchRef,
            rail: currency === "NGN" ? "nip" : currency === "GBP" ? "fps" : "swift",
            currency,
            totalAmount: String(totalAmount.toFixed(2)),
            itemCount: currItems.length,
            status: "processing",
            sentAt: new Date(),
          })
          .returning();

        disbursements.push(disb);

        // Mark items as processing
        await db
          .update(payrollRunItems)
          .set({ status: "processing", updatedAt: new Date() })
          .where(inArray(payrollRunItems.id, currItems.map((i) => i.id)));
      }

      // Simulate successful disbursement (in production: call payment rails)
      await db
        .update(payrollRunItems)
        .set({ status: "paid", disbursedAt: new Date(), updatedAt: new Date() })
        .where(eq(payrollRunItems.runId, input.runId));

      await db
        .update(payrollDisbursements)
        .set({ status: "settled", settledAt: new Date() })
        .where(eq(payrollDisbursements.runId, input.runId));

      const [finalRun] = await db
        .update(payrollRuns)
        .set({ status: "disbursed", disbursedAt: new Date(), updatedAt: new Date() })
        .where(eq(payrollRuns.id, input.runId))
        .returning();

      return { run: finalRun, disbursements, itemsProcessed: items.length };
    }),

  cancelRun: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      if (["disbursed", "cancelled"].includes(run.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot cancel run in status: ${run.status}` });
      }

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      const [updated] = await db
        .update(payrollRuns)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(payrollRuns.id, input.runId))
        .returning();
      return updated;
    }),

  // ── Reports & Analytics ────────────────────────────────────────────────────

  getCompanyStats: protectedProcedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, input.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN" });

      const runs = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.companyId, input.companyId))
        .orderBy(desc(payrollRuns.createdAt))
        .limit(12);

      const totalDisbursed = runs
        .filter((r) => r.status === "disbursed")
        .reduce((s, r) => s + Number(r.totalNetUsd), 0);

      const activeEmployees = await db
        .select({ count: sql<number>`count(*)` })
        .from(payrollEmployees)
        .where(and(eq(payrollEmployees.companyId, input.companyId), eq(payrollEmployees.isActive, true)));

      // Jurisdiction breakdown
      const jurisdictions = await db
        .select({
          jurisdiction: payrollEmployees.jurisdiction,
          count: sql<number>`count(*)`,
        })
        .from(payrollEmployees)
        .where(and(eq(payrollEmployees.companyId, input.companyId), eq(payrollEmployees.isActive, true)))
        .groupBy(payrollEmployees.jurisdiction);

      return {
        company,
        totalRuns: runs.length,
        disbursedRuns: runs.filter((r) => r.status === "disbursed").length,
        totalDisbursedUsd: totalDisbursed,
        activeEmployees: Number(activeEmployees[0]?.count ?? 0),
        recentRuns: runs.slice(0, 5),
        jurisdictionBreakdown: jurisdictions,
      };
    }),

  getJurisdictions: protectedProcedure.query(async () => {
      const db = await getDb();
    try {
      const res = await fetch(`${PAYROLL_ENGINE_URL}/jurisdictions`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return res.json();
    } catch { /* fallback */ }
    return [
      { code: "NG", name: "Nigeria" },
      { code: "GB", name: "United Kingdom" },
      { code: "US", name: "United States" },
      { code: "CA", name: "Canada" },
      { code: "DE", name: "Germany" },
      { code: "AE", name: "UAE" },
      { code: "GH", name: "Ghana" },
      { code: "KE", name: "Kenya" },
      { code: "ZA", name: "South Africa" },
    ];
  }),

  getComplianceCalendar: protectedProcedure
    .input(z.object({ jurisdiction: z.string(), year: z.number().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const year = input.year ?? new Date().getFullYear();
      const result = await callComplianceService(
        `/compliance-calendar?jurisdiction=${input.jurisdiction}&year=${year}`
      );
      return result ?? { jurisdiction: input.jurisdiction, year, calendar: [], compliance_notes: [] };
    }),
});
