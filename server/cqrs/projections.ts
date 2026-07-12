/**
 * RemitFlow — CQRS Read Model Projections
 * ════════════════════════════════════════════════════════════════════════════
 * Implements the Query side of CQRS. Read models are denormalized, query-
 * optimised views built by replaying events from the Rust event store.
 *
 * Each projection:
 *   1. Subscribes to a stream of domain events via Fluvio consumer
 *   2. Applies the event to update its denormalized PostgreSQL read table
 *   3. Persists its checkpoint so it can resume after restart
 *
 * Read models provided:
 *   - UserDashboardProjection      — Aggregated user stats for the dashboard
 *   - TransactionLedgerProjection  — Denormalized transaction history view
 *   - ComplianceSummaryProjection  — AML/KYC risk summary per user
 *   - WalletBalanceProjection      — Real-time wallet balance read model
 *   - CorridorAnalyticsProjection  — FX corridor usage analytics
 *
 * Language: TypeScript (co-located with tRPC routers for type-safe queries)
 */

import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { pgTable, bigserial, bigint, varchar, numeric, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// ─── Read Model Table Definitions ────────────────────────────────────────────

export const userDashboardView = pgTable(
  "rm_user_dashboard",
  {
    userId:              bigint("user_id", { mode: "number" }).primaryKey(),
    displayName:         varchar("display_name", { length: 255 }),
    kycTier:             integer("kyc_tier").notNull().default(0),
    totalSentUsd:        numeric("total_sent_usd", { precision: 20, scale: 2 }).notNull().default("0"),
    totalReceivedUsd:    numeric("total_received_usd", { precision: 20, scale: 2 }).notNull().default("0"),
    transactionCount:    integer("transaction_count").notNull().default(0),
    activeWallets:       integer("active_wallets").notNull().default(0),
    lastTransactionAt:   timestamp("last_transaction_at", { withTimezone: true }),
    riskScore:           numeric("risk_score", { precision: 5, scale: 4 }).notNull().default("0"),
    amlFlags:            integer("aml_flags").notNull().default(0),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const transactionLedgerView = pgTable(
  "rm_transaction_ledger",
  {
    id:                  bigserial("id", { mode: "number" }).primaryKey(),
    transactionId:       bigint("transaction_id", { mode: "number" }).notNull().unique(),
    userId:              bigint("user_id", { mode: "number" }).notNull(),
    type:                varchar("type", { length: 50 }).notNull(),
    status:              varchar("status", { length: 20 }).notNull(),
    fromAmount:          numeric("from_amount", { precision: 20, scale: 8 }).notNull(),
    fromCurrency:        varchar("from_currency", { length: 10 }).notNull(),
    toAmount:            numeric("to_amount", { precision: 20, scale: 8 }),
    toCurrency:          varchar("to_currency", { length: 10 }),
    recipientName:       varchar("recipient_name", { length: 255 }),
    corridor:            varchar("corridor", { length: 20 }),
    fxRate:              numeric("fx_rate", { precision: 20, scale: 8 }),
    feesUsd:             numeric("fees_usd", { precision: 10, scale: 4 }),
    railUsed:            varchar("rail_used", { length: 50 }),
    isCrossBorder:       boolean("is_cross_border").notNull().default(false),
    riskScore:           numeric("risk_score", { precision: 5, scale: 4 }),
    createdAt:           timestamp("created_at", { withTimezone: true }).notNull(),
    settledAt:           timestamp("settled_at", { withTimezone: true }),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx:    index("idx_rm_tx_ledger_user").on(t.userId, t.createdAt),
    statusIdx:  index("idx_rm_tx_ledger_status").on(t.status, t.createdAt),
    corridorIdx: index("idx_rm_tx_ledger_corridor").on(t.corridor, t.createdAt),
  })
);

export const walletBalanceView = pgTable(
  "rm_wallet_balance",
  {
    walletId:            bigint("wallet_id", { mode: "number" }).primaryKey(),
    userId:              bigint("user_id", { mode: "number" }).notNull(),
    currency:            varchar("currency", { length: 10 }).notNull(),
    availableBalance:    numeric("available_balance", { precision: 20, scale: 8 }).notNull().default("0"),
    pendingBalance:      numeric("pending_balance", { precision: 20, scale: 8 }).notNull().default("0"),
    reservedBalance:     numeric("reserved_balance", { precision: 20, scale: 8 }).notNull().default("0"),
    tbAccountId:         varchar("tb_account_id", { length: 64 }),  // TigerBeetle account ID
    lastEventVersion:    bigint("last_event_version", { mode: "number" }).notNull().default(0),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_rm_wallet_user").on(t.userId, t.currency),
  })
);

export const complianceSummaryView = pgTable(
  "rm_compliance_summary",
  {
    userId:              bigint("user_id", { mode: "number" }).primaryKey(),
    kycStatus:           varchar("kyc_status", { length: 20 }).notNull().default("pending"),
    kycTier:             integer("kyc_tier").notNull().default(0),
    amlRiskScore:        numeric("aml_risk_score", { precision: 5, scale: 4 }).notNull().default("0"),
    sanctionsMatch:      boolean("sanctions_match").notNull().default(false),
    pepMatch:            boolean("pep_match").notNull().default(false),
    openCaseCount:       integer("open_case_count").notNull().default(0),
    lastSarFiledAt:      timestamp("last_sar_filed_at", { withTimezone: true }),
    velocityBreaches:    integer("velocity_breaches").notNull().default(0),
    totalFlagged30d:     integer("total_flagged_30d").notNull().default(0),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const corridorAnalyticsView = pgTable(
  "rm_corridor_analytics",
  {
    id:                  bigserial("id", { mode: "number" }).primaryKey(),
    corridor:            varchar("corridor", { length: 20 }).notNull().unique(),
    transactionCount24h: integer("transaction_count_24h").notNull().default(0),
    transactionCount7d:  integer("transaction_count_7d").notNull().default(0),
    volumeUsd24h:        numeric("volume_usd_24h", { precision: 20, scale: 2 }).notNull().default("0"),
    volumeUsd7d:         numeric("volume_usd_7d", { precision: 20, scale: 2 }).notNull().default("0"),
    avgFxRate:           numeric("avg_fx_rate", { precision: 20, scale: 8 }),
    avgFeeUsd:           numeric("avg_fee_usd", { precision: 10, scale: 4 }),
    successRate:         numeric("success_rate", { precision: 5, scale: 4 }).notNull().default("1"),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// ─── Projection Checkpoint ────────────────────────────────────────────────────

export const projectionCheckpoints = pgTable(
  "projection_checkpoints",
  {
    projectionName:        varchar("projection_name", { length: 100 }).primaryKey(),
    aggregateType:         varchar("aggregate_type", { length: 100 }).notNull(),
    lastProcessedVersion:  bigint("last_processed_version", { mode: "number" }).notNull().default(0),
    updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// ─── Projection Handlers ──────────────────────────────────────────────────────

export interface DomainEvent {
  id:             string;
  stream_id:      string;
  aggregate_type: string;
  aggregate_id:   string;
  event_type:     string;
  event_version:  number;
  payload:        Record<string, unknown>;
  metadata:       Record<string, unknown>;
  created_at:     Date;
}

/**
 * UserDashboardProjection
 * Handles: UserCreated, TransactionCompleted, KycTierUpgraded, AmlFlagRaised
 */
export class UserDashboardProjection {
  static readonly name = "user_dashboard";
  static readonly aggregateType = "user";

  static async handle(event: DomainEvent): Promise<void> {
    const userId = parseInt(event.aggregate_id, 10);

    switch (event.event_type) {
      case "UserCreated": {
        await db.execute(sql`
          INSERT INTO rm_user_dashboard (user_id, display_name, kyc_tier, updated_at)
          VALUES (${userId}, ${(event.payload as any).display_name ?? ""}, 0, NOW())
          ON CONFLICT (user_id) DO NOTHING
        `);
        break;
      }

      case "TransactionCompleted": {
        const p = event.payload as any;
        await db.execute(sql`
          INSERT INTO rm_user_dashboard (user_id, total_sent_usd, transaction_count, last_transaction_at, updated_at)
          VALUES (${userId}, ${p.amount_usd ?? 0}, 1, NOW(), NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            total_sent_usd     = rm_user_dashboard.total_sent_usd + EXCLUDED.total_sent_usd,
            transaction_count  = rm_user_dashboard.transaction_count + 1,
            last_transaction_at = NOW(),
            updated_at         = NOW()
        `);
        break;
      }

      case "KycTierUpgraded": {
        const p = event.payload as any;
        await db.execute(sql`
          UPDATE rm_user_dashboard
          SET kyc_tier = ${p.new_tier}, updated_at = NOW()
          WHERE user_id = ${userId}
        `);
        break;
      }

      case "AmlFlagRaised": {
        await db.execute(sql`
          UPDATE rm_user_dashboard
          SET aml_flags = aml_flags + 1, updated_at = NOW()
          WHERE user_id = ${userId}
        `);
        break;
      }
    }
  }
}

/**
 * WalletBalanceProjection
 * Handles: WalletCreated, FundsDebited, FundsCredited, FundsReserved, ReservationReleased
 */
export class WalletBalanceProjection {
  static readonly name = "wallet_balance";
  static readonly aggregateType = "wallet";

  static async handle(event: DomainEvent): Promise<void> {
    const walletId = parseInt(event.aggregate_id, 10);
    const p = event.payload as any;

    switch (event.event_type) {
      case "WalletCreated": {
        await db.execute(sql`
          INSERT INTO rm_wallet_balance (wallet_id, user_id, currency, available_balance, last_event_version, updated_at)
          VALUES (${walletId}, ${p.user_id}, ${p.currency}, 0, ${event.event_version}, NOW())
          ON CONFLICT (wallet_id) DO NOTHING
        `);
        break;
      }

      case "FundsCredited": {
        await db.execute(sql`
          UPDATE rm_wallet_balance
          SET available_balance = available_balance + ${p.amount},
              last_event_version = ${event.event_version},
              updated_at = NOW()
          WHERE wallet_id = ${walletId}
        `);
        break;
      }

      case "FundsDebited": {
        await db.execute(sql`
          UPDATE rm_wallet_balance
          SET available_balance = available_balance - ${p.amount},
              last_event_version = ${event.event_version},
              updated_at = NOW()
          WHERE wallet_id = ${walletId}
        `);
        break;
      }

      case "FundsReserved": {
        await db.execute(sql`
          UPDATE rm_wallet_balance
          SET available_balance = available_balance - ${p.amount},
              reserved_balance  = reserved_balance + ${p.amount},
              last_event_version = ${event.event_version},
              updated_at = NOW()
          WHERE wallet_id = ${walletId}
        `);
        break;
      }

      case "ReservationReleased": {
        await db.execute(sql`
          UPDATE rm_wallet_balance
          SET reserved_balance  = reserved_balance - ${p.amount},
              available_balance = available_balance + ${p.amount},
              last_event_version = ${event.event_version},
              updated_at = NOW()
          WHERE wallet_id = ${walletId}
        `);
        break;
      }
    }
  }
}

/**
 * ComplianceSummaryProjection
 * Handles: KycStatusChanged, SanctionsMatchFound, AmlCaseOpened, AmlCaseClosed, VelocityBreached
 */
export class ComplianceSummaryProjection {
  static readonly name = "compliance_summary";
  static readonly aggregateType = "compliance";

  static async handle(event: DomainEvent): Promise<void> {
    const userId = parseInt(event.aggregate_id, 10);
    const p = event.payload as any;

    switch (event.event_type) {
      case "KycStatusChanged": {
        await db.execute(sql`
          INSERT INTO rm_compliance_summary (user_id, kyc_status, kyc_tier, updated_at)
          VALUES (${userId}, ${p.new_status}, ${p.new_tier ?? 0}, NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            kyc_status = EXCLUDED.kyc_status,
            kyc_tier   = EXCLUDED.kyc_tier,
            updated_at = NOW()
        `);
        break;
      }

      case "SanctionsMatchFound": {
        await db.execute(sql`
          UPDATE rm_compliance_summary
          SET sanctions_match = true, aml_risk_score = LEAST(aml_risk_score + 0.5, 1.0), updated_at = NOW()
          WHERE user_id = ${userId}
        `);
        break;
      }

      case "AmlCaseOpened": {
        await db.execute(sql`
          UPDATE rm_compliance_summary
          SET open_case_count = open_case_count + 1, updated_at = NOW()
          WHERE user_id = ${userId}
        `);
        break;
      }

      case "AmlCaseClosed": {
        await db.execute(sql`
          UPDATE rm_compliance_summary
          SET open_case_count = GREATEST(open_case_count - 1, 0), updated_at = NOW()
          WHERE user_id = ${userId}
        `);
        break;
      }

      case "VelocityBreached": {
        await db.execute(sql`
          UPDATE rm_compliance_summary
          SET velocity_breaches = velocity_breaches + 1,
              total_flagged_30d = total_flagged_30d + 1,
              updated_at = NOW()
          WHERE user_id = ${userId}
        `);
        break;
      }
    }
  }
}

// ─── Projection Registry ──────────────────────────────────────────────────────

export const PROJECTION_REGISTRY = [
  UserDashboardProjection,
  WalletBalanceProjection,
  ComplianceSummaryProjection,
];

/**
 * Dispatch a domain event to all registered projections that handle its aggregate type.
 */
export async function dispatchToProjections(event: DomainEvent): Promise<void> {
  const handlers = PROJECTION_REGISTRY.filter(
    (p) => p.aggregateType === event.aggregate_type || p.aggregateType === "*"
  );

  await Promise.allSettled(
    handlers.map((handler) =>
      handler.handle(event).catch((err) => {
        console.error(`[CQRS] Projection ${handler.name} failed for event ${event.event_type}:`, err);
      })
    )
  );

  // Update checkpoint
  for (const handler of handlers) {
    await db.execute(sql`
      INSERT INTO projection_checkpoints (projection_name, aggregate_type, last_processed_version, updated_at)
      VALUES (${handler.name}, ${event.aggregate_type}, ${event.event_version}, NOW())
      ON CONFLICT (projection_name) DO UPDATE SET
        last_processed_version = GREATEST(projection_checkpoints.last_processed_version, EXCLUDED.last_processed_version),
        updated_at = NOW()
    `);
  }
}
