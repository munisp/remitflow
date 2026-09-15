/**
 * BDC Customer Rescreening (wave12 G3) — periodic re-screening of every
 * KYC-verified BDC customer against the SAME fail-closed sanctions/PEP
 * provider used at onboarding (server/lib/enhancedScreening.ts).
 *
 * Contract (SPEC-wave12 §4.4):
 *   - Pages bdc_customers WHERE kyc_status='verified' (+ optional tenant
 *     filter), calls runEnhancedScreening per customer, and appends one
 *     bdc_rescreening_results row per screened customer (append-only —
 *     the sale-path gate reads the LATEST row per customer).
 *   - verdict 'match' (overallResult 'potential_match'|'confirmed_match')
 *     → blocked=true + Kafka alert. From then on buyFx/sellFx refuse the
 *     customer (assertCustomerNotRescreenBlocked) until an MLRO review
 *     produces a newer non-blocked row.
 *   - Provider errors record verdict='error' honestly and are counted in
 *     the run summary — a customer is NEVER blocked on error alone, and one
 *     customer's failure never aborts the run.
 *   - Telemetry (Kafka) is fail-soft: an alert-publish failure never fails
 *     the run (SPEC §0.5).
 *
 * Scheduler: startBdcRescreeningScheduler() registers a nightly 02:17 UTC
 * tick ("17 2 * * *") with the same overlap-guarded, never-throw tick
 * discipline as server/services/bdcScheduler.ts. Boot registration is done
 * by ORCH at merge.
 */
import cron, { type ScheduledTask } from "node-cron";
import { and, asc, eq, gt } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getDb } from "../db";
import { bdcCustomers, bdcRescreeningResults } from "../../drizzle/schema";
import { logger } from "../_core/logger";

/** Literal topic — ORCH adds the KAFKA_TOPICS constant at merge. */
const BDC_RESCREENING_ALERTS_TOPIC = "remitflow.bdc.rescreening.alerts";

const PAGE_SIZE = 200;

let schedulerTasks: ScheduledTask[] = [];
let runInFlight = false;

export interface BdcRescreeningSummary {
  runId: string;
  screened: number;
  matches: number;
  errors: number;
}

/** Generate the run id (also used by the router for honest started-state). */
export function newRescreeningRunId(): string {
  return `bdc-rescreen-${Date.now()}-${randomBytes(6).toString("hex")}`;
}

/** True while a rescreening run is in progress (manual or scheduled). */
export function isRescreeningRunInFlight(): boolean {
  return runInFlight;
}

async function publishMatchAlert(payload: Record<string, unknown>): Promise<void> {
  try {
    const { publishEvent } = await import("../middleware/kafka.js");
    await publishEvent(BDC_RESCREENING_ALERTS_TOPIC, `bdc-rescreen-match-${payload.customerId}-${payload.runId}`, {
      type: "BDC_RESCREENING_MATCH",
      ...payload,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(
      { errMsg: (err as Error)?.message, customerId: payload.customerId },
      "[BDC] Rescreening match alert publish failed (non-blocking)",
    );
  }
}

/**
 * Run one rescreening sweep. `tenantId === null` sweeps ALL tenants (nightly
 * scheduler); a number scopes the run to one tenant (manual admin trigger).
 * Honest summary: every screened customer yields exactly one result row;
 * `errors` counts provider failures (verdict='error', never blocked).
 */
export async function runBdcRescreening(
  tenantId: number | null,
  opts?: { runId?: string },
): Promise<BdcRescreeningSummary> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable — BDC rescreening cannot run (fail-closed)");
  }
  if (runInFlight) {
    throw new Error("A BDC rescreening run is already in progress — refusing overlap");
  }
  runInFlight = true;

  const runId = opts?.runId ?? newRescreeningRunId();
  let screened = 0;
  let matches = 0;
  let errors = 0;

  try {
    const { runEnhancedScreening } = await import("../lib/enhancedScreening");

    let lastId = 0;
    for (;;) {
      const customers = (await db
        .select({
          id: bdcCustomers.id,
          tenantId: bdcCustomers.tenantId,
          fullName: bdcCustomers.fullName,
          platformUserId: bdcCustomers.platformUserId,
          mrzData: bdcCustomers.mrzData,
        })
        .from(bdcCustomers)
        .where(and(
          eq(bdcCustomers.kycStatus, "verified"),
          tenantId !== null ? eq(bdcCustomers.tenantId, tenantId) : undefined,
          gt(bdcCustomers.id, lastId),
        ))
        .orderBy(asc(bdcCustomers.id))
        .limit(PAGE_SIZE)) as Array<{
        id: number;
        tenantId: number;
        fullName: string | null;
        platformUserId: number | null;
        mrzData: unknown;
      }>;

      if (customers.length === 0) break;
      lastId = customers[customers.length - 1]!.id;

      for (const customer of customers) {
        // Best-effort enrichment from stored MRZ jsonb (optional provider params).
        const mrz =
          customer.mrzData && typeof customer.mrzData === "object" && !Array.isArray(customer.mrzData)
            ? (customer.mrzData as Record<string, unknown>)
            : {};
        const dateOfBirth = typeof mrz.dateOfBirth === "string" ? mrz.dateOfBirth : undefined;
        const country = typeof mrz.country === "string" ? mrz.country : undefined;

        try {
          const report = await runEnhancedScreening({
            name: customer.fullName ?? "UNKNOWN",
            dateOfBirth,
            country,
            userId: customer.platformUserId ?? 0,
            transactionId: `${runId}-customer-${customer.id}`,
          });

          const isMatch = report.overallResult !== "clear";
          const topScore =
            report.sanctions.matches.length > 0
              ? Math.max(...report.sanctions.matches.map((m) => Number(m.score) || 0))
              : null;
          await db.insert(bdcRescreeningResults).values({
            tenantId: customer.tenantId,
            customerId: customer.id,
            runId,
            verdict: isMatch ? "match" : "clear",
            score: topScore !== null ? topScore.toFixed(4) : null,
            matchedLists: isMatch ? report.sanctions.lists : [],
            blocked: isMatch,
            report: report as unknown as Record<string, unknown>,
          });
          screened++;
          if (isMatch) {
            matches++;
            logger.warn(
              {
                runId,
                tenantId: customer.tenantId,
                customerId: customer.id,
                overallResult: report.overallResult,
                riskLevel: report.riskLevel,
                matchedLists: report.sanctions.lists,
              },
              "[BDC] Rescreening MATCH — customer blocked pending MLRO review",
            );
            await publishMatchAlert({
              runId,
              tenantId: customer.tenantId,
              customerId: customer.id,
              overallResult: report.overallResult,
              riskLevel: report.riskLevel,
              matchedLists: report.sanctions.lists,
              blocked: true,
              source: "bdc-rescreening",
            });
          }
        } catch (err) {
          // Provider failure: record honestly, NEVER block on error alone,
          // and never let one customer abort the run.
          errors++;
          logger.error(
            { errMsg: (err as Error)?.message, runId, tenantId: customer.tenantId, customerId: customer.id },
            "[BDC] Rescreening provider error for customer (verdict='error', NOT blocked)",
          );
          try {
            await db.insert(bdcRescreeningResults).values({
              tenantId: customer.tenantId,
              customerId: customer.id,
              runId,
              verdict: "error",
              score: null,
              matchedLists: [],
              blocked: false,
              report: { error: (err as Error)?.message ?? "screening provider unavailable" },
            });
          } catch (insertErr) {
            logger.error(
              { errMsg: (insertErr as Error)?.message, runId, customerId: customer.id },
              "[BDC] Failed to persist rescreening error row (customer left unscreened this run)",
            );
          }
        }
      }
    }

    logger.info({ runId, tenantId, screened, matches, errors }, "[BDC] Rescreening run complete");
    return { runId, screened, matches, errors };
  } finally {
    runInFlight = false;
  }
}

/**
 * Nightly scheduler (02:17 UTC). Guarded-tick pattern copied from
 * server/services/bdcScheduler.ts: overlap guard, never throw out of the
 * cron callback, idempotent start. Boot registration by ORCH at merge.
 */
export function startBdcRescreeningScheduler(): void {
  if (schedulerTasks.length > 0) {
    logger.info("[BDC] Rescreening scheduler already running — start is idempotent, ignoring");
    return;
  }

  const guarded = (name: string, fn: () => Promise<unknown>) => async () => {
    if (runInFlight) {
      logger.warn(`[BDC] ${name}: previous rescreening run still in progress — skipping (overlap guard)`);
      return;
    }
    try {
      const result = await fn();
      logger.info({ result }, `[BDC] ${name} tick complete`);
    } catch (err) {
      logger.error({ errMsg: (err as Error)?.message }, `[BDC] ${name} tick FAILED (will retry next schedule):`);
    }
  };

  schedulerTasks = [
    cron.schedule(
      "17 2 * * *",
      guarded("bdc-customer-rescreening", async () => runBdcRescreening(null)),
    ),
  ];
  logger.info("[BDC] Rescreening scheduler started (nightly 02:17 UTC, all tenants)");
}

export function stopBdcRescreeningScheduler(): void {
  for (const t of schedulerTasks) t.stop();
  schedulerTasks = [];
}
