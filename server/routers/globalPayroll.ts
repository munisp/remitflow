/**
 * RemitFlow — Global Payroll Router
 * Full business rules: company setup, employee management, payroll run lifecycle,
 * multi-jurisdiction tax calculation (via Go engine), disbursement, reports
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
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
import { publishPayrollDisbursement, pendingTransferIdFor, resolveTbTransferAccounts } from "../_core/transferPipeline";
import { screenSanctions } from "../_core/polyglotClient";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { tigerBeetle } from "../middleware/middlewareIntegration";
import { broadcastUserEvent } from "../sse.service";
import { sendNotification } from "../notifications.service";

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

// ─── W9/F11-1: TigerBeetle hold-reversal helpers ─────────────────────────────
// TB 0.16 CreateTransferResult codes relevant to two-phase reversal state
// detection (mirrors _core/transferPipeline.ts compensateFailedTransfer).
const TB_RESULT = {
  PENDING_NOT_FOUND: 25,  // pending_transfer_not_found — hold never existed
  ALREADY_POSTED: 33,     // pending_transfer_already_posted — funds moved
  ALREADY_VOIDED: 34,     // pending_transfer_already_voided
  EXPIRED: 35,            // pending_transfer_expired (auto-void at timeout)
} as const;

function tbResultCodes(err: unknown): number[] {
  const msg = err instanceof Error ? err.message : String(err);
  const codes: number[] = [];
  for (const m of msg.matchAll(/"result":\s*(\d+)/g)) codes.push(Number(m[1]));
  return codes;
}

/**
 * Reverse the TigerBeetle ledger movement created for a payroll batch in
 * disburseRun (wallet → float pool, deterministic id = pendingTransferIdFor(batchRef)).
 * State-aware and replay-safe:
 *   - void succeeds / exists-replay        → hold released
 *   - already_voided / expired / not_found → nothing held, nothing to refund
 *   - already_posted (disburseRun posts with flags=0) → compensating reversal
 *     transfer float pool → wallet with a deterministic id (TB exists(46) makes
 *     retries idempotent)
 *   - anything else → THROW: caller must NOT mark the run cancelled.
 */
async function reversePayrollBatchHold(batch: { id: number; batchReference: string; currency: string; totalAmount: string }, ownerId: number): Promise<"voided" | "reversed" | "no_hold"> {
  const accounts = await resolveTbTransferAccounts(ownerId, batch.currency);
  const pendingId = pendingTransferIdFor(batch.batchReference);
  const voidId = pendingTransferIdFor(`VOID:${batch.batchReference}`);
  try {
    await tigerBeetle.voidPendingTransfer({ id: voidId, pendingId, ledger: accounts.ledger, code: 3 }); // code must match the disburseRun hold (code 3) — TB rejects mismatched code
    return "voided";
  } catch (voidErr) {
    const codes = tbResultCodes(voidErr);
    if (codes.includes(TB_RESULT.ALREADY_POSTED)) {
      // Funds already moved to the float pool — refund the owner's wallet from
      // the float pool with a deterministic reversal id (replay-safe).
      await tigerBeetle.createTransfer({
        id: pendingTransferIdFor(`REV:${batch.batchReference}`),
        debitAccountId: accounts.creditAccountId,  // float pool → owner wallet
        creditAccountId: accounts.debitAccountId,
        amount: BigInt(Math.round(Number(batch.totalAmount) * 100)),
        ledger: accounts.ledger,
        code: 4, // payroll hold reversal
      });
      return "reversed";
    }
    if (codes.includes(TB_RESULT.ALREADY_VOIDED) || codes.includes(TB_RESULT.EXPIRED) || codes.includes(TB_RESULT.PENDING_NOT_FOUND)) {
      return "no_hold";
    }
    throw voidErr; // unknown outcome — do NOT blind-refund (double-refund vector)
  }
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
  grossSalary: z.number().positive().max(10_000_000),
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
  notes: z.string().max(2000).optional(),
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
      if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
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
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
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
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

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
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

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
      if (!emp) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, emp.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

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
      if (!emp) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, emp.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

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
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

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
        employees: employees.map((e: any) => ({
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
        employees: employees.map((e: any) => ({
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
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

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
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

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
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (run.status !== "draft" && run.status !== "pending_approval") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot approve run in status: ${run.status}` });
      }

      const [company] = await db
        .select({ id: payrollCompanies.id })
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      const [updated] = await db
        .update(payrollRuns)
        .set({ status: "approved", approvedByUserId: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(payrollRuns.id, input.runId))
        .returning();
      return updated;
    }),

  disburseRun: protectedProcedure
    .input(z.object({
      runId: z.number(),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (run.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Run must be approved before disbursement" });
      }

      // D8 — separation of duty: the user who approved the run must NOT be the
      // one who disburses it. Maker-checker control over money movement.
      if (run.approvedByUserId != null && run.approvedByUserId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Separation of duty: the approver of a payroll run cannot disburse it — a different authorised user must disburse",
        });
      }

      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      // D8 — TOTP step-up (Contract 2): enrolled users MUST pass 2FA to queue
      // payouts. Fail closed when the enrollment store is unavailable.
      {
        const { getTotpEnrollment, verifyTOTP } = await import("../totp");
        const enrollment = await getTotpEnrollment(ctx.user.id);
        if (!enrollment.dbAvailable) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — disbursement blocked (fail-closed)" });
        }
        if (enrollment.enabled && enrollment.secret) {
          if (!input.totpCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
          const valid = await verifyTOTP(input.totpCode, enrollment.secret);
          if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
        }
      }

      // FF-005: single-winner status transition — two concurrent disburseRun
      // calls must not both "pay". Only the caller whose UPDATE matches
      // status='approved' proceeds; the loser gets 0 rows.
      const claimed = await db
        .update(payrollRuns)
        .set({ status: "processing", updatedAt: new Date() })
        .where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.status, "approved")))
        .returning({ id: payrollRuns.id });
      if (claimed.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Payroll run is already being disbursed" });
      }

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

      // Sanctions screening for all employees in batch — FAIL CLOSED (Wave 7
      // verification): screenSanctions throws when the screener is unreachable;
      // a screening outage must block the disbursement, never silently pass.
      let sanctionChecks: Array<Awaited<ReturnType<typeof screenSanctions>> & { employeeId: any; empName: string }>;
      try {
        sanctionChecks = await Promise.all(
          items.map(async (item: any) => {
            const emp = await db.select().from(payrollEmployees).where(eq(payrollEmployees.id, item.employeeId)).limit(1);
            const empName = emp[0] ? `${emp[0].firstName} ${emp[0].lastName}` : "Unknown";
            const result = await screenSanctions({ name: empName, country: emp[0]?.country ?? "NG" });
            return { ...result, employeeId: item.employeeId, empName };
          })
        );
      } catch (sanctionsErr) {
        logger.error({ err: sanctionsErr instanceof Error ? sanctionsErr.message : String(sanctionsErr), runId: input.runId },
          "[Payroll] FAIL-CLOSED: sanctions screening unavailable — disbursement blocked");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Payroll disbursement blocked: sanctions screening is temporarily unavailable. Please retry.",
        });
      }
      const sanctioned = sanctionChecks.filter(s => s.isSanctioned);
      if (sanctioned.length > 0) {
        publishEvent(KAFKA_TOPICS.COMPLIANCE_ALERT, `payroll-sanctions:${run.companyId}`, {
          alertType: "payroll_sanctions_match",
          userId: ctx.user.id,
          companyId: run.companyId,
          matchedEmployees: sanctioned.map(s => ({ employeeId: s.employeeId, name: s.empName, matchType: s.matchType })),
          timestamp: new Date().toISOString(),
        }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Payroll] Kafka sanctions alert failed"));
        throw new TRPCError({ code: "FORBIDDEN", message: `Disbursement blocked: ${sanctioned.length} employee(s) matched sanctions list: ${sanctioned.map(s => s.empName).join(", ")}` });
      }

      const disbursements = [];
      for (const [currency, currItems] of Object.entries(byCurrency)) {
        const totalAmount = currItems.reduce((s: any, i: any) => s + Number(i.netPay), 0);
        const batchRef = `DISB-${run.runReference}-${currency}`;
        const rail = currency === "NGN" ? "nip" : currency === "GBP" ? "fps" : "swift";

        // TigerBeetle double-entry ledger — FF-005: REAL provisioned accounts
        // (company owner's wallet → platform float pool), per-currency ledger,
        // deterministic id derived from the batch reference (replay-safe via
        // TB exists(46)), and FAIL-CLOSED: a ledger failure must never mark a
        // payroll run as disbursed while no money moved.
        const tbAccounts = await resolveTbTransferAccounts(ctx.user.id, currency);
        try {
          await tigerBeetle.createTransfer({
            id: pendingTransferIdFor(batchRef),
            debitAccountId: tbAccounts.debitAccountId,
            creditAccountId: tbAccounts.creditAccountId,
            amount: BigInt(Math.round(totalAmount * 100)),
            ledger: tbAccounts.ledger,
            code: 3, // payroll disbursement
          });
        } catch (err) {
          logger.error({ err: err instanceof Error ? err.message : String(err), batchRef, currency, totalAmount },
            "[Payroll] FAIL-CLOSED: TigerBeetle disbursement failed — run NOT marked paid");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Payroll disbursement failed at ledger for ${currency} batch — run left in processing state for retry/reconciliation`,
          });
        }

        // W7/B1: no outbound rail call exists — the batch is QUEUED, never
        // sent. Status is honestly `pending_settlement`; sentAt stays null
        // until a real rail integration transmits the batch.
        const [disb] = await db
          .insert(payrollDisbursements)
          .values({
            runId: input.runId,
            batchReference: batchRef,
            rail,
            currency,
            totalAmount: String(totalAmount.toFixed(2)),
            itemCount: currItems.length,
            status: "pending_settlement",
          })
          .returning();

        disbursements.push(disb);

        // Kafka event for each batch disbursement
        publishPayrollDisbursement({
          runId: input.runId,
          companyId: run.companyId,
          userId: ctx.user.id,
          batchRef,
          currency,
          totalAmount,
          itemCount: currItems.length,
          rail,
        }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Payroll] Kafka event failed"));

        // W7/B1: items stay `pending` (payroll_item_status enum has no
        // `pending_payout` value and schema changes are out of scope) — no
        // payout has been executed, so stamping paid/processing would be a lie.
        // They are flipped to `paid` only by a future real payout confirmation.
      }

      // W7/B1: DO NOT stamp items `paid`, disbursements `settled`, or the run
      // `disbursed` — no employee ever received funds (the `rail` variable is
      // never used for an outbound call). The run remains `processing`
      // (payroll_run_status enum has no `payout_pending` value; schema changes
      // are out of scope) and disbursements remain `pending_settlement` until a
      // real rail integration confirms payout. disbursedAt/settledAt stay null.
      const [finalRun] = await db
        .update(payrollRuns)
        .set({ updatedAt: new Date() })
        .where(eq(payrollRuns.id, input.runId))
        .returning();

      // Audit log — honest action name: payouts were QUEUED, not disbursed.
      await createAuditLog({
        userId: ctx.user.id,
        action: "PAYROLL_PAYOUTS_QUEUED",
        description: `Payroll run ${run.runReference}: payouts queued for ${items.length} employees, ${disbursements.length} batch(es) — NOT yet paid out (no rail transmission)`,
        metadata: { runId: input.runId, companyId: run.companyId, batches: disbursements.length, payoutsCompleted: false },
      });

      // Notification — honest: queued, not disbursed.
      broadcastUserEvent(ctx.user.id, {
        type: "transfer_sent",
        payload: {
          title: "Payroll Payouts Queued",
          message: `Payroll run ${run.runReference}: payouts queued for ${items.length} employees — funds have NOT yet been sent`,
          amount: disbursements.reduce((s: number, d: any) => s + Number(d.totalAmount), 0),
          fromCurrency: company.baseCurrency,
          toCurrency: company.baseCurrency,
        },
      });
      sendNotification({
        userId: ctx.user.id,
        title: "Payroll Payouts Queued",
        message: `Your payroll run ${run.runReference} is queued for payout to ${items.length} employees. Funds have not yet been sent — you will be notified when payouts complete.`,
        type: "transfer",
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Payroll] Notification failed"));

      return {
        run: finalRun,
        disbursements,
        itemsProcessed: items.length,
        verified: true,
        payoutsQueued: true,
        payoutsCompleted: false,
        message: "Payouts are queued, not completed — no funds have been sent to employees yet (no payment rail transmission exists for this flow).",
      };
    }),

  // ── W9/F11-1: admin confirmation that a queued payout batch actually settled
  // on the external rail. This is the ONLY path that flips a batch out of
  // `pending_settlement` — nothing auto-flips. Requires the rail's external
  // reference + TOTP step-up for enrolled admins (fail closed).
  confirmPayout: adminProcedure
    .input(z.object({
      batchId: z.number().int().positive(),
      externalReference: z.string().min(1).max(200),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Canonical W7 step-up: enrolled admins MUST pass 2FA; fail closed when
      // the enrollment store is unavailable.
      {
        const { getTotpEnrollment, verifyTOTP } = await import("../totp");
        const enrollment = await getTotpEnrollment(ctx.user.id);
        if (!enrollment.dbAvailable) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — payout confirmation blocked (fail-closed)" });
        }
        if (enrollment.enabled && enrollment.secret) {
          if (!input.totpCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
          const valid = await verifyTOTP(input.totpCode, enrollment.secret);
          if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
        }
      }

      const db = await getDb();
      const [batch] = await db.select().from(payrollDisbursements).where(eq(payrollDisbursements.id, input.batchId));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Disbursement batch not found" });
      if (batch.status !== "pending_settlement") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot confirm payout for batch in status: ${batch.status}` });
      }

      // Single-winner flip — two concurrent confirmations can't both settle.
      const now = new Date();
      const flipped = await db
        .update(payrollDisbursements)
        .set({ status: "completed", externalRef: input.externalReference, sentAt: batch.sentAt ?? now, settledAt: now })
        .where(and(eq(payrollDisbursements.id, input.batchId), eq(payrollDisbursements.status, "pending_settlement")))
        .returning();
      if (flipped.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Batch was already confirmed by another admin" });
      }

      // Payout confirmed by an admin with a rail reference — the run items for
      // this batch's currency are now honestly `paid`.
      await db
        .update(payrollRunItems)
        .set({ status: "paid", disbursedAt: now, updatedAt: now })
        .where(and(
          eq(payrollRunItems.runId, batch.runId),
          eq(payrollRunItems.netCurrency, batch.currency),
          inArray(payrollRunItems.status, ["pending", "processing"]),
        ));

      // When no queued batches remain, the run's lifecycle is complete.
      const remaining = await db
        .select({ id: payrollDisbursements.id })
        .from(payrollDisbursements)
        .where(and(eq(payrollDisbursements.runId, batch.runId), eq(payrollDisbursements.status, "pending_settlement")));
      let runCompleted = false;
      if (remaining.length === 0) {
        const runFlip = await db
          .update(payrollRuns)
          .set({ status: "disbursed", disbursedAt: now, updatedAt: now })
          .where(and(eq(payrollRuns.id, batch.runId), eq(payrollRuns.status, "processing")))
          .returning({ id: payrollRuns.id });
        runCompleted = runFlip.length > 0;
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "PAYROLL_PAYOUT_CONFIRMED",
        description: `Payroll batch ${batch.batchReference} confirmed settled on rail ${batch.rail} (ref ${input.externalReference})`,
        targetId: batch.id,
        targetType: "payroll_disbursement",
        metadata: { batchId: batch.id, runId: batch.runId, batchReference: batch.batchReference, externalReference: input.externalReference, currency: batch.currency, totalAmount: batch.totalAmount, runCompleted },
      });

      return { batch: flipped[0], runCompleted, payoutsCompleted: true };
    }),

  cancelRun: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (["disbursed", "cancelled"].includes(run.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot cancel run in status: ${run.status}` });
      }

      const [company] = await db
        .select()
        .from(payrollCompanies)
        .where(and(eq(payrollCompanies.id, run.companyId), eq(payrollCompanies.ownerId, ctx.user.id)));
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      // W9/F11-1: a run whose payouts were queued already moved funds (wallet
      // → float pool via TigerBeetle). Reverse each batch's ledger hold BEFORE
      // marking anything cancelled — a cancelled run with an unreversed hold
      // strands real money.
      const queuedBatches = await db
        .select()
        .from(payrollDisbursements)
        .where(and(eq(payrollDisbursements.runId, input.runId), eq(payrollDisbursements.status, "pending_settlement")));

      const reversalFailures: Array<{ batchId: number; batchReference: string; error: string }> = [];
      for (const batch of queuedBatches) {
        try {
          const action = await reversePayrollBatchHold(batch, company.ownerId);
          logger.info({ batchId: batch.id, batchReference: batch.batchReference, action }, "[Payroll] Batch ledger hold reversed for cancellation");
          await db
            .update(payrollDisbursements)
            .set({ status: "cancelled" })
            .where(eq(payrollDisbursements.id, batch.id));
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          reversalFailures.push({ batchId: batch.id, batchReference: batch.batchReference, error: errorMsg });
          // NEVER silently strand funds: flag the batch and raise a structured
          // alert. NOTE: payroll_disbursements.status is varchar(20) — the
          // canonical `cancel_failed_unreversed_hold` tag (29 chars) does not
          // fit and schema changes are out of scope, so the row carries
          // `cancel_failed_hold` and the full tag lives in this error log +
          // the audit record below.
          try {
            await db
              .update(payrollDisbursements)
              .set({ status: "cancel_failed_hold" })
              .where(eq(payrollDisbursements.id, batch.id));
          } catch (flagErr) {
            logger.error({ err: flagErr instanceof Error ? flagErr.message : String(flagErr), batchId: batch.id },
              "[Payroll] CRITICAL: could not even flag unreversed-hold batch — MANUAL RECONCILIATION REQUIRED");
          }
          logger.error({
            batchId: batch.id,
            batchReference: batch.batchReference,
            runId: input.runId,
            currency: batch.currency,
            totalAmount: batch.totalAmount,
            error: errorMsg,
            status: "cancel_failed_unreversed_hold",
          }, "[Payroll] FAIL-CLOSED: TigerBeetle hold reversal failed — batch marked cancel_failed_unreversed_hold, MANUAL RECONCILIATION REQUIRED");
          await createAuditLog({
            userId: ctx.user.id,
            action: "PAYROLL_CANCEL_FAILED_UNREVERSED_HOLD",
            description: `Cancellation of payroll run ${run.runReference} failed: ledger hold for batch ${batch.batchReference} could not be reversed — funds still provisioned to the float pool`,
            severity: "critical",
            targetId: batch.id,
            targetType: "payroll_disbursement",
            metadata: { batchId: batch.id, runId: input.runId, batchReference: batch.batchReference, currency: batch.currency, totalAmount: batch.totalAmount, error: errorMsg, status: "cancel_failed_unreversed_hold" },
          });
        }
      }

      if (reversalFailures.length > 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Cancellation aborted: ${reversalFailures.length} batch(es) have unreversed ledger holds (marked cancel_failed_unreversed_hold) — manual reconciliation required before this run can be cancelled`,
        });
      }

      // All holds reversed (or none existed) — safe to cancel.
      const [updated] = await db
        .update(payrollRuns)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(payrollRuns.id, input.runId))
        .returning();

      if (queuedBatches.length > 0) {
        await createAuditLog({
          userId: ctx.user.id,
          action: "PAYROLL_RUN_CANCELLED_WITH_REVERSAL",
          description: `Payroll run ${run.runReference} cancelled after reversing ${queuedBatches.length} queued batch hold(s)`,
          metadata: { runId: input.runId, reversedBatches: queuedBatches.map(b => b.batchReference) },
        });
      }
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
      if (!company) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      const runs = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.companyId, input.companyId))
        .orderBy(desc(payrollRuns.createdAt))
        .limit(12);

      const totalDisbursed = runs
        .filter((r: any) => r.status === "disbursed")
        .reduce((s: any, r: any) => s + Number(r.totalNetUsd), 0);

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
        disbursedRuns: runs.filter((r: any) => r.status === "disbursed").length,
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
