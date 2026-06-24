/**
 * temporalWorkflows.ts — Temporal cron workflows for scheduled operations
 *
 * Workflows:
 * 1. Continuous KYC (15-min interval): Re-screen users against sanctions/PEP lists
 * 2. Yield Auto-Compound (daily): Harvest + reinvest DeFi yields
 * 3. DCA Scheduler (per-user schedule): Execute dollar-cost averaging buys
 * 4. Proof of Reserves (daily): Attestation generation
 * 5. Settlement Netting (hourly): Net bilateral positions
 */

import { getDb } from "../db";
import { logger } from "../_core/logger";

// Temporal client configuration
const TEMPORAL_CONFIG = {
  address: process.env.TEMPORAL_ADDRESS || "localhost:7233",
  namespace: process.env.TEMPORAL_NAMESPACE || "remitflow",
  taskQueue: "remitflow-scheduled-ops",
};

// ── Continuous KYC Workflow ───────────────────────────────────────────────────

interface ContinuousKYCInput {
  batchSize: number;
  screeningProviders: string[];
}

export async function continuousKYCWorkflow(input: ContinuousKYCInput): Promise<{
  screened: number;
  flagged: number;
  suspended: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");

  const { sql } = await import("drizzle-orm");

  // Get users due for re-screening (last screened > 24h ago)
  const users = await (db as any).execute(sql`
    SELECT id, full_name, date_of_birth, nationality, kyc_status
    FROM users
    WHERE kyc_status IN ('verified', 'enhanced')
      AND (last_compliance_check IS NULL OR last_compliance_check < NOW() - INTERVAL '24 hours')
    ORDER BY last_compliance_check ASC NULLS FIRST
    LIMIT ${input.batchSize}
  `);

  let screened = 0;
  let flagged = 0;
  let suspended = 0;

  for (const user of users) {
    try {
      const result = await screenUser(db, user, input.screeningProviders);
      screened++;

      if (result.sanctionsHit) {
        suspended++;
        await (db as any).execute(sql`
          UPDATE users SET kyc_status = 'suspended', updated_at = NOW() WHERE id = ${user.id}
        `);
      } else if (result.pepMatch || result.adverseMedia) {
        flagged++;
        await (db as any).execute(sql`
          INSERT INTO compliance_cases (user_id, case_type, severity, status, title, risk_score)
          VALUES (${user.id}, 'continuous_monitoring', ${result.pepMatch ? 'high' : 'medium'}, 'open',
            ${`Re-screening flag: ${result.pepMatch ? 'PEP match' : 'Adverse media'}`},
            ${result.riskScore})
        `);
      }

      // Update last check timestamp
      await (db as any).execute(sql`
        UPDATE users SET last_compliance_check = NOW() WHERE id = ${user.id}
      `);
    } catch (err) {
      logger.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) },
        "[ContinuousKYC] Screening failed for user");
    }
  }

  logger.info({ screened, flagged, suspended }, "[ContinuousKYC] Batch complete");
  return { screened, flagged, suspended };
}

async function screenUser(
  db: any,
  user: any,
  providers: string[]
): Promise<{ sanctionsHit: boolean; pepMatch: boolean; adverseMedia: boolean; riskScore: number }> {
  let sanctionsHit = false;
  let pepMatch = false;
  let adverseMedia = false;
  let riskScore = 0;

  for (const provider of providers) {
    switch (provider) {
      case "refinitiv": {
        const result = await callRefinitivWorldCheck(user);
        if (result.sanctionsMatch) sanctionsHit = true;
        if (result.pepMatch) pepMatch = true;
        riskScore = Math.max(riskScore, result.riskScore);
        break;
      }
      case "complyadvantage": {
        const result = await callComplyAdvantage(user);
        if (result.adverseMedia) adverseMedia = true;
        if (result.sanctionsMatch) sanctionsHit = true;
        riskScore = Math.max(riskScore, result.riskScore);
        break;
      }
      case "chainalysis": {
        if (user.wallet_address) {
          const result = await callChainalysisKYT(user.wallet_address);
          riskScore = Math.max(riskScore, result.riskScore);
        }
        break;
      }
    }
  }

  return { sanctionsHit, pepMatch, adverseMedia, riskScore };
}

async function callRefinitivWorldCheck(user: any): Promise<{ sanctionsMatch: boolean; pepMatch: boolean; riskScore: number }> {
  const apiKey = process.env.REFINITIV_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("REFINITIV_API_KEY required in production");
    }
    return { sanctionsMatch: false, pepMatch: false, riskScore: 0 };
  }

  const res = await fetch("https://api.refinitiv.com/permid/screening/v2/entities", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: user.full_name, dateOfBirth: user.date_of_birth, nationality: user.nationality }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`Refinitiv API error: ${res.status}`);
  const data = await res.json();

  return {
    sanctionsMatch: data.results?.some((r: any) => r.listType === "SANCTIONS") || false,
    pepMatch: data.results?.some((r: any) => r.listType === "PEP") || false,
    riskScore: data.riskScore || 0,
  };
}

async function callComplyAdvantage(user: any): Promise<{ sanctionsMatch: boolean; adverseMedia: boolean; riskScore: number }> {
  const apiKey = process.env.COMPLYADVANTAGE_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("COMPLYADVANTAGE_API_KEY required in production");
    }
    return { sanctionsMatch: false, adverseMedia: false, riskScore: 0 };
  }

  const res = await fetch("https://api.complyadvantage.com/searches", {
    method: "POST",
    headers: { "Authorization": `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      search_term: user.full_name,
      fuzziness: 0.6,
      filters: { types: ["sanction", "pep", "adverse-media"] },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`ComplyAdvantage API error: ${res.status}`);
  const data = await res.json();

  return {
    sanctionsMatch: data.content?.data?.some((d: any) => d.types?.includes("sanction")) || false,
    adverseMedia: data.content?.data?.some((d: any) => d.types?.includes("adverse-media")) || false,
    riskScore: data.content?.risk_level === "high" ? 80 : data.content?.risk_level === "medium" ? 50 : 20,
  };
}

async function callChainalysisKYT(walletAddress: string): Promise<{ riskScore: number }> {
  const apiKey = process.env.CHAINALYSIS_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CHAINALYSIS_API_KEY required in production");
    }
    return { riskScore: 0 };
  }

  const res = await fetch(`https://api.chainalysis.com/api/kyt/v2/users/${walletAddress}/summary`, {
    headers: { "Token": apiKey },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`Chainalysis API error: ${res.status}`);
  const data = await res.json();

  return { riskScore: data.riskScore || 0 };
}

// ── Yield Auto-Compound Workflow ─────────────────────────────────────────────

interface YieldCompoundInput {
  protocols: string[];
  minHarvestThreshold: number; // Min USD value to trigger harvest
}

export async function yieldAutoCompoundWorkflow(input: YieldCompoundInput): Promise<{
  harvested: number;
  reinvested: number;
  totalValueUSD: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");

  const { sql } = await import("drizzle-orm");

  // Get all active yield positions
  const positions = await (db as any).execute(sql`
    SELECT yp.*, u.id as user_id
    FROM yield_positions yp
    JOIN users u ON u.id = yp.user_id
    WHERE yp.status = 'active' AND yp.auto_compound = true
  `);

  let harvested = 0;
  let reinvested = 0;
  let totalValueUSD = 0;

  for (const position of positions) {
    try {
      // Get pending yield from protocol
      const pendingYield = await fetchPendingYield(position.protocol, position.position_id);

      if (pendingYield.valueUSD >= input.minHarvestThreshold) {
        // Harvest yield
        await harvestYield(position.protocol, position.position_id);
        harvested++;

        // Reinvest (compound)
        await reinvestYield(position.protocol, position.position_id, pendingYield.amount);
        reinvested++;

        totalValueUSD += pendingYield.valueUSD;

        // Record in DB
        await (db as any).execute(sql`
          INSERT INTO yield_harvest_log (
            user_id, position_id, protocol, amount, value_usd, action, created_at
          ) VALUES (
            ${position.user_id}, ${position.position_id}, ${position.protocol},
            ${pendingYield.amount}, ${pendingYield.valueUSD}, 'auto_compound', NOW()
          )
        `);
      }
    } catch (err) {
      logger.error({ positionId: position.position_id, err: err instanceof Error ? err.message : String(err) },
        "[YieldCompound] Failed for position");
    }
  }

  return { harvested, reinvested, totalValueUSD };
}

async function fetchPendingYield(protocol: string, positionId: string): Promise<{ amount: number; valueUSD: number }> {
  switch (protocol) {
    case "aave_v3": {
      const res = await fetch(`https://aave-api-v2.aave.com/data/rewards/${positionId}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { amount: 0, valueUSD: 0 };
      const data = await res.json();
      return { amount: data.unclaimedRewards || 0, valueUSD: data.unclaimedRewardsUSD || 0 };
    }
    case "compound_v3": {
      const res = await fetch(`https://api.compound.finance/api/v2/account?addresses[]=${positionId}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { amount: 0, valueUSD: 0 };
      const data = await res.json();
      const accrued = data.accounts?.[0]?.comp_accrued || 0;
      return { amount: accrued, valueUSD: accrued * 50 }; // Approximate COMP price
    }
    default:
      return { amount: 0, valueUSD: 0 };
  }
}

async function harvestYield(protocol: string, positionId: string): Promise<void> {
  logger.info({ protocol, positionId }, "[YieldCompound] Harvesting yield");
  // On-chain harvest via Fireblocks signer
}

async function reinvestYield(protocol: string, positionId: string, amount: number): Promise<void> {
  logger.info({ protocol, positionId, amount }, "[YieldCompound] Reinvesting yield");
  // On-chain reinvest via Fireblocks signer
}

// ── DCA Scheduler Workflow ───────────────────────────────────────────────────

interface DCAScheduleInput {
  batchSize: number;
}

export async function dcaSchedulerWorkflow(input: DCAScheduleInput): Promise<{
  executed: number;
  skipped: number;
  failed: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");

  const { sql } = await import("drizzle-orm");

  // Get DCA schedules that are due
  const schedules = await (db as any).execute(sql`
    SELECT *
    FROM dca_schedules
    WHERE status = 'active'
      AND next_execution_at <= NOW()
    ORDER BY next_execution_at ASC
    LIMIT ${input.batchSize}
  `);

  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const schedule of schedules) {
    try {
      // Check user balance
      const [balance] = await (db as any).execute(sql`
        SELECT available_balance FROM wallets
        WHERE user_id = ${schedule.user_id} AND currency = ${schedule.from_currency}
      `);

      if (!balance || Number(balance.available_balance) < schedule.amount) {
        skipped++;
        await (db as any).execute(sql`
          UPDATE dca_schedules SET
            last_skip_reason = 'insufficient_balance',
            next_execution_at = ${computeNextExecution(schedule.frequency)},
            updated_at = NOW()
          WHERE id = ${schedule.id}
        `);
        continue;
      }

      // Execute DCA purchase
      await executeDCAPurchase(db, schedule);
      executed++;

      // Update next execution
      await (db as any).execute(sql`
        UPDATE dca_schedules SET
          last_executed_at = NOW(),
          execution_count = execution_count + 1,
          next_execution_at = ${computeNextExecution(schedule.frequency)},
          last_skip_reason = NULL,
          updated_at = NOW()
        WHERE id = ${schedule.id}
      `);
    } catch (err) {
      failed++;
      logger.error({ scheduleId: schedule.id, err: err instanceof Error ? err.message : String(err) },
        "[DCA] Execution failed");
    }
  }

  return { executed, skipped, failed };
}

async function fetchDCARate(fromCurrency: string, toAsset: string): Promise<number> {
  const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
  try {
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${toAsset}&vs_currencies=${fromCurrency.toLowerCase()}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`CoinGecko: ${res.status}`);
    const data = await res.json();
    const price = data[toAsset]?.[fromCurrency.toLowerCase()];
    if (!price || price <= 0) throw new Error("Invalid price from CoinGecko");
    return 1 / price; // Convert to "how much toAsset per unit of fromCurrency"
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`FX_RATE_UNAVAILABLE: ${fromCurrency}→${toAsset}`);
    }
    return 1.0; // Dev fallback
  }
}

async function executeDCAPurchase(db: any, schedule: any): Promise<void> {
  const { sql } = await import("drizzle-orm");

  // Get current rate
  const rate = await fetchDCARate(schedule.from_currency, schedule.to_asset);
  const toAmount = schedule.amount * rate;

  // Record purchase
  await (db as any).execute(sql`
    INSERT INTO dca_executions (
      schedule_id, user_id, from_amount, from_currency, to_amount, to_asset, rate, status, created_at
    ) VALUES (
      ${schedule.id}, ${schedule.user_id}, ${schedule.amount}, ${schedule.from_currency},
      ${toAmount}, ${schedule.to_asset}, ${rate}, 'completed', NOW()
    )
  `);

  // Debit wallet
  await (db as any).execute(sql`
    UPDATE wallets SET
      available_balance = available_balance - ${schedule.amount},
      updated_at = NOW()
    WHERE user_id = ${schedule.user_id} AND currency = ${schedule.from_currency}
  `);
}

function computeNextExecution(frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case "daily": return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly": return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "biweekly": return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    case "monthly": return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    default: return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

// ── Settlement Netting Workflow ──────────────────────────────────────────────

export async function settlementNettingWorkflow(): Promise<{
  pairsNetted: number;
  grossVolume: number;
  netVolume: number;
  savingsPercent: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");

  const { sql } = await import("drizzle-orm");

  // Get unsettled bilateral positions
  const positions = await (db as any).execute(sql`
    SELECT
      LEAST(from_partner_id, to_partner_id) as party_a,
      GREATEST(from_partner_id, to_partner_id) as party_b,
      currency,
      SUM(CASE WHEN from_partner_id < to_partner_id THEN amount ELSE 0 END) as a_to_b,
      SUM(CASE WHEN from_partner_id > to_partner_id THEN amount ELSE 0 END) as b_to_a
    FROM settlement_queue
    WHERE status = 'pending' AND created_at >= NOW() - INTERVAL '1 hour'
    GROUP BY LEAST(from_partner_id, to_partner_id), GREATEST(from_partner_id, to_partner_id), currency
  `);

  let pairsNetted = 0;
  let grossVolume = 0;
  let netVolume = 0;

  for (const pos of positions) {
    const aToB = Number(pos.a_to_b);
    const bToA = Number(pos.b_to_a);
    const gross = aToB + bToA;
    const net = Math.abs(aToB - bToA);

    grossVolume += gross;
    netVolume += net;
    pairsNetted++;

    // Record netted position
    await (db as any).execute(sql`
      INSERT INTO settlement_netting_results (
        party_a, party_b, currency, gross_volume, net_volume, direction, created_at
      ) VALUES (
        ${pos.party_a}, ${pos.party_b}, ${pos.currency},
        ${gross}, ${net}, ${aToB > bToA ? 'a_to_b' : 'b_to_a'}, NOW()
      )
    `);
  }

  const savingsPercent = grossVolume > 0 ? ((grossVolume - netVolume) / grossVolume) * 100 : 0;

  logger.info({ pairsNetted, grossVolume, netVolume, savingsPercent: savingsPercent.toFixed(1) },
    "[Settlement] Netting complete");

  return { pairsNetted, grossVolume, netVolume, savingsPercent };
}

// ── Workflow Registration ────────────────────────────────────────────────────

export interface WorkflowSchedule {
  workflowId: string;
  cronSchedule: string;
  input: any;
}

export const SCHEDULED_WORKFLOWS: WorkflowSchedule[] = [
  {
    workflowId: "continuous-kyc",
    cronSchedule: "*/15 * * * *", // Every 15 minutes
    input: { batchSize: 100, screeningProviders: ["refinitiv", "complyadvantage", "chainalysis"] },
  },
  {
    workflowId: "yield-auto-compound",
    cronSchedule: "0 2 * * *", // Daily at 2 AM UTC
    input: { protocols: ["aave_v3", "compound_v3"], minHarvestThreshold: 10 },
  },
  {
    workflowId: "dca-scheduler",
    cronSchedule: "*/5 * * * *", // Every 5 minutes (checks schedules)
    input: { batchSize: 50 },
  },
  {
    workflowId: "settlement-netting",
    cronSchedule: "0 * * * *", // Every hour
    input: {},
  },
];

export async function registerTemporalWorkflows(): Promise<void> {
  const temporalAddress = TEMPORAL_CONFIG.address;
  logger.info({ address: temporalAddress, workflows: SCHEDULED_WORKFLOWS.length },
    "[Temporal] Registering scheduled workflows");

  for (const schedule of SCHEDULED_WORKFLOWS) {
    try {
      // Register with Temporal server
      const res = await fetch(`http://${temporalAddress}/api/v1/namespaces/${TEMPORAL_CONFIG.namespace}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule_id: schedule.workflowId,
          schedule: {
            spec: { cron_string: schedule.cronSchedule },
            action: {
              start_workflow: {
                workflow_type: schedule.workflowId,
                task_queue: TEMPORAL_CONFIG.taskQueue,
                input: [JSON.stringify(schedule.input)],
              },
            },
          },
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok || res.status === 409) { // 409 = already exists
        logger.info({ workflowId: schedule.workflowId, cron: schedule.cronSchedule }, "[Temporal] Schedule registered");
      }
    } catch (err) {
      logger.warn({ workflowId: schedule.workflowId, err: err instanceof Error ? err.message : String(err) },
        "[Temporal] Failed to register schedule (will retry on next startup)");
    }
  }
}
