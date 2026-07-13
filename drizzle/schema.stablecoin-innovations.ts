/**
 * RemitFlow — Stablecoin Innovation Schema Extensions
 *
 * New tables for:
 *   - DeFi yield positions (Aave/Compound/Yearn/Morpho)
 *   - Multi-chain bridge transactions (LayerZero/Wormhole/CCTP/Axelar)
 *   - AMM liquidity positions (Uniswap v3/Curve/Balancer)
 *   - CBDC wallet balances and transactions
 *   - Price oracle snapshots and TWAP history
 *   - Programmable CBDC conditions
 *   - mBridge cross-border settlements
 *   - Depeg circuit breaker events
 *   - Yield auto-compound audit log
 *   - Swap execution audit log
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── Enums ─────────────────────────────────────────────────────────────────────
export const yieldPositionStatusEnum = pgEnum("yield_position_status", [
  "active", "withdrawn", "emergency_exit", "liquidated",
]);

export const bridgeTxStatusEnum = pgEnum("bridge_tx_status", [
  "pending", "source_confirmed", "bridge_in_flight",
  "dest_confirmed", "completed", "failed", "refunded",
]);

export const cbdcTxTypeEnum = pgEnum("cbdc_tx_type", [
  "transfer", "swap", "mbridge_transfer", "mint", "burn",
  "programmable_lock", "programmable_release",
]);

export const programmableConditionTypeEnum = pgEnum("programmable_condition_type", [
  "time_lock", "escrow", "conditional_release", "multi_sig",
]);

export const circuitBreakerSeverityEnum = pgEnum("circuit_breaker_severity", [
  "ok", "warning", "critical", "suspended",
]);

export const ammProtocolEnum = pgEnum("amm_protocol", [
  "uniswap-v2", "uniswap-v3", "curve", "balancer", "pancakeswap", "quickswap",
]);

// ── DeFi Yield Positions ──────────────────────────────────────────────────────
export const defiYieldPositions = pgTable("defi_yield_positions", {
  id:              text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:          integer("user_id").notNull(),
  protocolId:      text("protocol_id").notNull(),
  protocolName:    text("protocol_name").notNull(),
  chain:           text("chain").notNull(),
  symbol:          text("symbol").notNull(),
  principal:       numeric("principal", { precision: 28, scale: 8 }).notNull(),
  currentValue:    numeric("current_value", { precision: 28, scale: 8 }).notNull(),
  accruedYield:    numeric("accrued_yield", { precision: 28, scale: 8 }).notNull().default("0"),
  apy:             numeric("apy", { precision: 10, scale: 4 }).notNull(),
  riskScore:       numeric("risk_score", { precision: 5, scale: 2 }),
  autoCompound:    boolean("auto_compound").notNull().default(false),
  lastCompoundAt:  timestamp("last_compound_at"),
  status:          yieldPositionStatusEnum("status").notNull().default("active"),
  enteredAt:       timestamp("entered_at").notNull().defaultNow(),
  exitedAt:        timestamp("exited_at"),
  metadata:        jsonb("metadata"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:     index("defi_yield_user_idx").on(t.userId),
  protocolIdx: index("defi_yield_protocol_idx").on(t.protocolId),
  statusIdx:   index("defi_yield_status_idx").on(t.status),
  symbolIdx:   index("defi_yield_symbol_idx").on(t.symbol),
}));

export type DefiYieldPosition = typeof defiYieldPositions.$inferSelect;
export type NewDefiYieldPosition = typeof defiYieldPositions.$inferInsert;

// ── Yield Auto-Compound Audit Log ─────────────────────────────────────────────
export const yieldCompoundLog = pgTable("yield_compound_log", {
  id:           text("id").primaryKey().default(sql`gen_random_uuid()`),
  positionId:   text("position_id").notNull(),
  userId:       integer("user_id").notNull(),
  yieldEarned:  numeric("yield_earned", { precision: 28, scale: 8 }).notNull(),
  newValue:     numeric("new_value", { precision: 28, scale: 8 }).notNull(),
  apyAtTime:    numeric("apy_at_time", { precision: 10, scale: 4 }),
  compoundedAt: timestamp("compounded_at").notNull().defaultNow(),
}, (t) => ({
  positionIdx: index("yield_compound_position_idx").on(t.positionId),
  userIdx:     index("yield_compound_user_idx").on(t.userId),
}));

export type YieldCompoundLog = typeof yieldCompoundLog.$inferSelect;
export type NewYieldCompoundLog = typeof yieldCompoundLog.$inferInsert;

// ── Multi-Chain Bridge Transactions ───────────────────────────────────────────
export const chainBridgeTransactions = pgTable("chain_bridge_transactions", {
  id:             text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:         integer("user_id").notNull(),
  protocolId:     text("protocol_id").notNull(),   // layerzero | wormhole | cctp | axelar | stargate
  protocolName:   text("protocol_name").notNull(),
  fromChain:      text("from_chain").notNull(),
  toChain:        text("to_chain").notNull(),
  token:          text("token").notNull(),
  amount:         numeric("amount", { precision: 28, scale: 8 }).notNull(),
  feeUsd:         numeric("fee_usd", { precision: 14, scale: 4 }),
  gasUsd:         numeric("gas_usd", { precision: 14, scale: 4 }),
  recipient:      text("recipient").notNull(),
  srcTxHash:      text("src_tx_hash"),
  dstTxHash:      text("dst_tx_hash"),
  htlcHash:       text("htlc_hash"),
  status:         bridgeTxStatusEnum("status").notNull().default("pending"),
  retryCount:     integer("retry_count").notNull().default(0),
  webhookUrl:     text("webhook_url"),
  errorMessage:   text("error_message"),
  completedAt:    timestamp("completed_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:      index("bridge_tx_user_idx").on(t.userId),
  statusIdx:    index("bridge_tx_status_idx").on(t.status),
  fromChainIdx: index("bridge_tx_from_chain_idx").on(t.fromChain),
  toChainIdx:   index("bridge_tx_to_chain_idx").on(t.toChain),
  srcHashIdx:   index("bridge_tx_src_hash_idx").on(t.srcTxHash),
}));

export type ChainBridgeTransaction = typeof chainBridgeTransactions.$inferSelect;
export type NewChainBridgeTransaction = typeof chainBridgeTransactions.$inferInsert;

// ── AMM Swap Execution Log ────────────────────────────────────────────────────
export const ammSwapLog = pgTable("amm_swap_log", {
  id:              text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:          integer("user_id").notNull(),
  poolId:          text("pool_id").notNull(),
  protocol:        ammProtocolEnum("protocol").notNull(),
  chain:           text("chain").notNull(),
  tokenIn:         text("token_in").notNull(),
  tokenOut:        text("token_out").notNull(),
  amountIn:        numeric("amount_in", { precision: 28, scale: 8 }).notNull(),
  amountOut:       numeric("amount_out", { precision: 28, scale: 8 }).notNull(),
  priceImpactPct:  numeric("price_impact_pct", { precision: 8, scale: 4 }),
  feePaid:         numeric("fee_paid", { precision: 14, scale: 8 }),
  slippagePct:     numeric("slippage_pct", { precision: 8, scale: 4 }),
  mevProtected:    boolean("mev_protected").notNull().default(false),
  splitRouting:    boolean("split_routing").notNull().default(false),
  txHash:          text("tx_hash"),
  executedAt:      timestamp("executed_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:    index("amm_swap_user_idx").on(t.userId),
  poolIdx:    index("amm_swap_pool_idx").on(t.poolId),
  chainIdx:   index("amm_swap_chain_idx").on(t.chain),
}));

export type AmmSwapLog = typeof ammSwapLog.$inferSelect;
export type NewAmmSwapLog = typeof ammSwapLog.$inferInsert;

// ── AMM Liquidity Positions ───────────────────────────────────────────────────
export const ammLiquidityPositions = pgTable("amm_liquidity_positions", {
  id:            text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:        integer("user_id").notNull(),
  poolId:        text("pool_id").notNull(),
  protocol:      ammProtocolEnum("protocol").notNull(),
  chain:         text("chain").notNull(),
  tokenA:        text("token_a").notNull(),
  tokenB:        text("token_b").notNull(),
  amountA:       numeric("amount_a", { precision: 28, scale: 8 }).notNull(),
  amountB:       numeric("amount_b", { precision: 28, scale: 8 }).notNull(),
  sharePct:      numeric("share_pct", { precision: 10, scale: 6 }),
  feesEarned:    numeric("fees_earned", { precision: 28, scale: 8 }).notNull().default("0"),
  inRange:       boolean("in_range").notNull().default(true),
  tickLower:     integer("tick_lower"),
  tickUpper:     integer("tick_upper"),
  lastRebalAt:   timestamp("last_rebalanced_at"),
  enteredAt:     timestamp("entered_at").notNull().defaultNow(),
  exitedAt:      timestamp("exited_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:  index("amm_lp_user_idx").on(t.userId),
  poolIdx:  index("amm_lp_pool_idx").on(t.poolId),
}));

export type AmmLiquidityPosition = typeof ammLiquidityPositions.$inferSelect;
export type NewAmmLiquidityPosition = typeof ammLiquidityPositions.$inferInsert;

// ── CBDC Wallet Balances ──────────────────────────────────────────────────────
export const cbdcWalletBalances = pgTable("cbdc_wallet_balances", {
  id:        text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:    integer("user_id").notNull(),
  cbdcCode:  text("cbdc_code").notNull(),
  cbdcName:  text("cbdc_name").notNull(),
  country:   text("country").notNull(),
  currency:  text("currency").notNull(),
  balance:   numeric("balance", { precision: 28, scale: 8 }).notNull().default("0"),
  usdValue:  numeric("usd_value", { precision: 14, scale: 4 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:     index("cbdc_wallet_user_idx").on(t.userId),
  uniqueWallet: uniqueIndex("cbdc_wallet_unique").on(t.userId, t.cbdcCode),
}));

export type CbdcWalletBalance = typeof cbdcWalletBalances.$inferSelect;
export type NewCbdcWalletBalance = typeof cbdcWalletBalances.$inferInsert;

// ── CBDC Transactions ─────────────────────────────────────────────────────────
export const cbdcTransactionLog = pgTable("cbdc_transaction_log", {
  id:           text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:       integer("user_id").notNull(),
  txType:       cbdcTxTypeEnum("tx_type").notNull(),
  fromCbdc:     text("from_cbdc"),
  toCbdc:       text("to_cbdc"),
  fromAsset:    text("from_asset"),
  toAsset:      text("to_asset"),
  amountIn:     numeric("amount_in", { precision: 28, scale: 8 }).notNull(),
  amountOut:    numeric("amount_out", { precision: 28, scale: 8 }),
  usdValue:     numeric("usd_value", { precision: 14, scale: 4 }),
  recipient:    text("recipient"),
  protocol:     text("protocol"),
  txHash:       text("tx_hash"),
  status:       text("status").notNull().default("completed"),
  metadata:     jsonb("metadata"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:   index("cbdc_tx_user_idx").on(t.userId),
  typeIdx:   index("cbdc_tx_type_idx").on(t.txType),
  statusIdx: index("cbdc_tx_status_idx").on(t.status),
}));

export type CbdcTransactionLog = typeof cbdcTransactionLog.$inferSelect;
export type NewCbdcTransactionLog = typeof cbdcTransactionLog.$inferInsert;

// ── Programmable CBDC Conditions ──────────────────────────────────────────────
export const programmableCbdcConditions = pgTable("programmable_cbdc_conditions", {
  id:             text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:         integer("user_id").notNull(),
  cbdcCode:       text("cbdc_code").notNull(),
  amount:         numeric("amount", { precision: 28, scale: 8 }).notNull(),
  conditionType:  programmableConditionTypeEnum("condition_type").notNull(),
  unlockAt:       timestamp("unlock_at"),
  conditionData:  jsonb("condition_data"),
  status:         text("status").notNull().default("locked"),
  releasedAt:     timestamp("released_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:   index("prog_cbdc_user_idx").on(t.userId),
  statusIdx: index("prog_cbdc_status_idx").on(t.status),
}));

export type ProgrammableCbdcCondition = typeof programmableCbdcConditions.$inferSelect;
export type NewProgrammableCbdcCondition = typeof programmableCbdcConditions.$inferInsert;

// ── Price Oracle Snapshots ────────────────────────────────────────────────────
export const priceOracleSnapshots = pgTable("price_oracle_snapshots", {
  id:            bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  symbol:        text("symbol").notNull(),
  price:         numeric("price", { precision: 28, scale: 12 }).notNull(),
  twap1h:        numeric("twap_1h", { precision: 28, scale: 12 }),
  twap4h:        numeric("twap_4h", { precision: 28, scale: 12 }),
  twap24h:       numeric("twap_24h", { precision: 28, scale: 12 }),
  deviationPct:  numeric("deviation_pct", { precision: 8, scale: 4 }),
  severity:      circuitBreakerSeverityEnum("severity").notNull().default("ok"),
  circuitBreaker: boolean("circuit_breaker").notNull().default(false),
  sourceCount:   integer("source_count").notNull().default(3),
  sources:       jsonb("sources"),
  snapshotAt:    timestamp("snapshot_at").notNull().defaultNow(),
}, (t) => ({
  symbolIdx:    index("oracle_snapshot_symbol_idx").on(t.symbol),
  snapshotIdx:  index("oracle_snapshot_time_idx").on(t.snapshotAt),
  severityIdx:  index("oracle_snapshot_severity_idx").on(t.severity),
}));

export type PriceOracleSnapshot = typeof priceOracleSnapshots.$inferSelect;
export type NewPriceOracleSnapshot = typeof priceOracleSnapshots.$inferInsert;

// ── Depeg Circuit Breaker Events ──────────────────────────────────────────────
export const depegCircuitBreakerEvents = pgTable("depeg_circuit_breaker_events", {
  id:            text("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol:        text("symbol").notNull(),
  eventType:     text("event_type").notNull(), // "tripped" | "auto_reset" | "manual_reset"
  deviationPct:  numeric("deviation_pct", { precision: 8, scale: 4 }),
  priceAtEvent:  numeric("price_at_event", { precision: 28, scale: 12 }),
  severity:      circuitBreakerSeverityEnum("severity").notNull(),
  reason:        text("reason"),
  autoResetAt:   timestamp("auto_reset_at"),
  resolvedAt:    timestamp("resolved_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  symbolIdx: index("depeg_cb_symbol_idx").on(t.symbol),
  typeIdx:   index("depeg_cb_type_idx").on(t.eventType),
}));

export type DepegCircuitBreakerEvent = typeof depegCircuitBreakerEvents.$inferSelect;
export type NewDepegCircuitBreakerEvent = typeof depegCircuitBreakerEvents.$inferInsert;

// ── mBridge Cross-Border Settlement Log ──────────────────────────────────────
export const mbridgeSettlementLog = pgTable("mbridge_settlement_log", {
  id:           text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:       integer("user_id").notNull(),
  fromCbdc:     text("from_cbdc").notNull(),
  toCbdc:       text("to_cbdc").notNull(),
  amountIn:     numeric("amount_in", { precision: 28, scale: 8 }).notNull(),
  amountOut:    numeric("amount_out", { precision: 28, scale: 8 }).notNull(),
  usdValue:     numeric("usd_value", { precision: 14, scale: 4 }),
  recipient:    text("recipient").notNull(),
  purpose:      text("purpose"),
  txHash:       text("tx_hash"),
  status:       text("status").notNull().default("completed"),
  settledAt:    timestamp("settled_at").notNull().defaultNow(),
}, (t) => ({
  userIdx:     index("mbridge_user_idx").on(t.userId),
  fromCbdcIdx: index("mbridge_from_cbdc_idx").on(t.fromCbdc),
  toCbdcIdx:   index("mbridge_to_cbdc_idx").on(t.toCbdc),
}));

export type MbridgeSettlementLog = typeof mbridgeSettlementLog.$inferSelect;
export type NewMbridgeSettlementLog = typeof mbridgeSettlementLog.$inferInsert;

// ── ML Depeg Predictions ──────────────────────────────────────────────────────
export const mlDepegPredictions = pgTable("ml_depeg_predictions", {
  id:               text("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol:           text("symbol").notNull(),
  modelVersion:     text("model_version").notNull(),
  predictionHorizon: integer("prediction_horizon_minutes").notNull(),
  predictedPrice:   numeric("predicted_price", { precision: 28, scale: 12 }),
  predictedDeviation: numeric("predicted_deviation_pct", { precision: 8, scale: 4 }),
  depegProbability: numeric("depeg_probability", { precision: 5, scale: 4 }),
  confidence:       numeric("confidence", { precision: 5, scale: 4 }),
  features:         jsonb("features"),
  predictedAt:      timestamp("predicted_at").notNull().defaultNow(),
  validUntil:       timestamp("valid_until"),
}, (t) => ({
  symbolIdx:    index("ml_depeg_symbol_idx").on(t.symbol),
  predictedIdx: index("ml_depeg_predicted_idx").on(t.predictedAt),
}));

export type MlDepegPrediction = typeof mlDepegPredictions.$inferSelect;
export type NewMlDepegPrediction = typeof mlDepegPredictions.$inferInsert;

// ── Relations ─────────────────────────────────────────────────────────────────
export const defiYieldPositionsRelations = relations(defiYieldPositions, ({ many }) => ({
  compoundLog: many(yieldCompoundLog),
}));

export const yieldCompoundLogRelations = relations(yieldCompoundLog, ({ one }) => ({
  position: one(defiYieldPositions, {
    fields: [yieldCompoundLog.positionId],
    references: [defiYieldPositions.id],
  }),
}));

export const cbdcWalletBalancesRelations = relations(cbdcWalletBalances, ({ many }) => ({
  transactions: many(cbdcTransactionLog),
}));
