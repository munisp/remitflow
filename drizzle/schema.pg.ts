/**
 * RemitFlow — PostgreSQL Schema (self-hosted / enterprise deployment path)
 *
 * This is the PostgreSQL-compatible variant of drizzle/schema.ts.
 * The Manus-hosted app uses the MySQL schema (schema.ts) with the platform-injected DATABASE_URL.
 * Self-hosted / Docker Compose deployments use this schema with POSTGRES_URL.
 *
 * Key differences from MySQL schema:
 *   - mysqlTable  → pgTable
 *   - mysqlEnum   → pgEnum (declared separately, then referenced)
 *   - int().autoincrement() → serial()
 *   - timestamp().onUpdateNow() → timestamp() (PG has no built-in onUpdate; use triggers)
 *   - decimal() precision/scale syntax is identical
 *   - json() is identical
 *   - boolean() is identical
 *   - text() / varchar() are identical
 */

import {
  boolean,
  decimal,
  integer,
  json,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  date,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleEnum           = pgEnum("role",            ["admin", "user"]);
export const kycTierEnum        = pgEnum("kyc_tier",        ["tier0", "tier1", "tier2", "tier3"]);
export const walletStatusEnum   = pgEnum("wallet_status",   ["active", "suspended", "closed"]);
export const txTypeEnum         = pgEnum("tx_type",         ["send", "receive", "exchange", "topup", "withdrawal", "fee", "refund", "airtime", "bill", "savings", "card"]);
export const txStatusEnum       = pgEnum("tx_status",       ["pending", "processing", "completed", "failed", "cancelled", "reversed"]);
export const cardTypeEnum       = pgEnum("card_type",       ["virtual", "physical"]);
export const cardBrandEnum      = pgEnum("card_brand",      ["visa", "mastercard", "verve"]);
export const cardStatusEnum     = pgEnum("card_status",     ["active", "frozen", "expired", "cancelled"]);
export const savingsStatusEnum  = pgEnum("savings_status",  ["active", "completed", "paused"]);
export const fxDirectionEnum    = pgEnum("fx_direction",    ["above", "below"]);
export const kycDocTypeEnum     = pgEnum("kyc_doc_type",    ["passport", "national_id", "drivers_license", "utility_bill", "bank_statement", "selfie", "proof_of_address"]);
export const kycDocStatusEnum   = pgEnum("kyc_doc_status",  ["pending", "under_review", "approved", "rejected"]);
export const notifTypeEnum      = pgEnum("notif_type",      ["transaction", "security", "kyc", "system", "promotion", "fx_alert"]);
export const auditSeverityEnum  = pgEnum("audit_severity",  ["info", "warning", "critical"]);
export const vaStatusEnum       = pgEnum("va_status",       ["active", "inactive"]);
export const recurFreqEnum      = pgEnum("recur_freq",      ["daily", "weekly", "monthly", "quarterly", "yearly"]);
export const recurStatusEnum    = pgEnum("recur_status",    ["active", "paused", "cancelled"]);
export const batchStatusEnum    = pgEnum("batch_status",    ["draft", "processing", "completed", "failed", "partial"]);
export const referralStatusEnum = pgEnum("referral_status", ["pending", "completed", "rewarded"]);
export const disputeTypeEnum    = pgEnum("dispute_type",    ["unauthorized", "duplicate", "not_received", "wrong_amount", "other"]);
export const disputeStatusEnum  = pgEnum("dispute_status",  ["open", "under_review", "resolved", "closed"]);
export const ticketStatusEnum   = pgEnum("ticket_status",   ["open", "in_progress", "resolved", "closed"]);
export const ticketPriorityEnum = pgEnum("ticket_priority", ["low", "medium", "high", "critical"]);
export const rateLockStatusEnum = pgEnum("rate_lock_status",["active", "used", "expired"]);
export const ddFreqEnum         = pgEnum("dd_freq",         ["weekly", "monthly", "quarterly", "annually"]);
export const ddStatusEnum       = pgEnum("dd_status",       ["active", "paused", "cancelled"]);

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:               serial("id").primaryKey(),
  openId:           varchar("open_id",          { length: 128 }).unique().notNull(),
  email:            varchar("email",            { length: 320 }),
  name:             varchar("name",             { length: 128 }),
  phone:            varchar("phone",            { length: 32 }),
  avatar:           text("avatar"),
  loginMethod:      varchar("login_method",     { length: 32 }),
  role:             roleEnum("role").default("user"),
  kycTier:          kycTierEnum("kyc_tier").default("tier0"),
  referralCode:     varchar("referral_code",    { length: 16 }),
  referredBy:       integer("referred_by"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret:  varchar("two_factor_secret",{ length: 64 }),
  address:          varchar("address",          { length: 256 }),
  dateOfBirth:      date("date_of_birth"),
  defaultCurrency:  varchar("default_currency", { length: 8 }).default("NGN"),
  lastSignedIn:     timestamp("last_signed_in"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});

// ─── Wallets ──────────────────────────────────────────────────────────────────
export const wallets = pgTable("wallets", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull(),
  currency:      varchar("currency",       { length: 8 }).notNull(),
  balance:       decimal("balance",        { precision: 18, scale: 2 }).default("0.00").notNull(),
  lockedBalance: decimal("locked_balance", { precision: 18, scale: 2 }).default("0.00"),
  isDefault:     boolean("is_default").default(false),
  status:        walletStatusEnum("status").default("active"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});

// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  type:             txTypeEnum("type").notNull(),
  status:           txStatusEnum("status").default("pending"),
  fromCurrency:     varchar("from_currency",    { length: 8 }).notNull(),
  fromAmount:       decimal("from_amount",      { precision: 18, scale: 2 }).notNull(),
  toCurrency:       varchar("to_currency",      { length: 8 }),
  toAmount:         decimal("to_amount",        { precision: 18, scale: 2 }),
  fee:              decimal("fee",              { precision: 18, scale: 2 }).default("0.00"),
  fxRate:           decimal("fx_rate",          { precision: 18, scale: 6 }),
  reference:        varchar("reference",        { length: 64 }),
  description:      text("description"),
  recipientName:    varchar("recipient_name",   { length: 128 }),
  recipientAccount: varchar("recipient_account",{ length: 64 }),
  recipientBank:    varchar("recipient_bank",   { length: 128 }),
  recipientCountry: varchar("recipient_country",{ length: 64 }),
  channel:          varchar("channel",          { length: 32 }),
  metadata:         json("metadata"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});

// ─── Beneficiaries ────────────────────────────────────────────────────────────
export const beneficiaries = pgTable("beneficiaries", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull(),
  name:          varchar("name",           { length: 128 }).notNull(),
  accountNumber: varchar("account_number", { length: 64 }),
  bankName:      varchar("bank_name",      { length: 128 }),
  bankCode:      varchar("bank_code",      { length: 16 }),
  currency:      varchar("currency",       { length: 8 }).default("NGN"),
  country:       varchar("country",        { length: 64 }),
  phone:         varchar("phone",          { length: 32 }),
  email:         varchar("email",          { length: 320 }),
  isFavorite:    boolean("is_favorite").default(false),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

// ─── Cards ────────────────────────────────────────────────────────────────────
export const cards = pgTable("cards", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull(),
  type:           cardTypeEnum("type").notNull(),
  brand:          cardBrandEnum("brand").notNull(),
  last4:          varchar("last4",           { length: 4 }).notNull(),
  expiryMonth:    varchar("expiry_month",    { length: 2 }).notNull(),
  expiryYear:     varchar("expiry_year",     { length: 4 }).notNull(),
  status:         cardStatusEnum("status").default("active"),
  currency:       varchar("currency",        { length: 8 }).default("USD"),
  spendLimit:     decimal("spend_limit",     { precision: 18, scale: 2 }),
  cardholderName: varchar("cardholder_name", { length: 128 }),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
});

// ─── Savings Goals ────────────────────────────────────────────────────────────
export const savingsGoals = pgTable("savings_goals", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull(),
  name:           varchar("name",           { length: 128 }).notNull(),
  emoji:          varchar("emoji",          { length: 8 }).default("🎯"),
  targetAmount:   decimal("target_amount",  { precision: 18, scale: 2 }).notNull(),
  currentAmount:  decimal("current_amount", { precision: 18, scale: 2 }).default("0.00"),
  currency:       varchar("currency",       { length: 8 }).default("NGN"),
  targetDate:     timestamp("target_date"),
  autoSave:       boolean("auto_save").default(false),
  autoSaveAmount: decimal("auto_save_amount",{ precision: 18, scale: 2 }),
  status:         savingsStatusEnum("status").default("active"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
});

// ─── FX Alerts ────────────────────────────────────────────────────────────────
export const fxAlerts = pgTable("fx_alerts", {
  id:              serial("id").primaryKey(),
  userId:          integer("user_id").notNull(),
  fromCurrency:    varchar("from_currency",    { length: 8 }).notNull(),
  toCurrency:      varchar("to_currency",      { length: 8 }).notNull(),
  targetRate:      decimal("target_rate",      { precision: 18, scale: 6 }).notNull(),
  direction:       fxDirectionEnum("direction").notNull(),
  isActive:        boolean("is_active").default(true),
  triggered:       boolean("triggered").default(false),
  triggeredAt:     timestamp("triggered_at"),
  lastCheckedRate: decimal("last_checked_rate",{ precision: 18, scale: 6 }),
  lastCheckedAt:   timestamp("last_checked_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

// ─── KYC Documents ────────────────────────────────────────────────────────────
export const kycDocuments = pgTable("kyc_documents", {
  id:              serial("id").primaryKey(),
  userId:          integer("user_id").notNull(),
  docType:         kycDocTypeEnum("doc_type").notNull(),
  status:          kycDocStatusEnum("status").default("pending"),
  fileUrl:         text("file_url"),
  fileKey:         text("file_key"),
  rejectionReason: text("rejection_reason"),
  reviewedAt:      timestamp("reviewed_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

// ─── Notifications ────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull(),
  title:     varchar("title",   { length: 256 }).notNull(),
  message:   text("message").notNull(),
  type:      notifTypeEnum("type").default("system"),
  isRead:    boolean("is_read").default(false),
  actionUrl: varchar("action_url", { length: 256 }),
  metadata:  json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull(),
  action:      varchar("action",     { length: 64 }).notNull(),
  description: text("description"),
  ipAddress:   varchar("ip_address", { length: 64 }),
  userAgent:   text("user_agent"),
  severity:    auditSeverityEnum("severity").default("info"),
  metadata:    json("metadata"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── Virtual Accounts ─────────────────────────────────────────────────────────
export const virtualAccounts = pgTable("virtual_accounts", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull(),
  currency:      varchar("currency",       { length: 8 }).notNull(),
  bank:          varchar("bank",           { length: 128 }).notNull(),
  accountNumber: varchar("account_number", { length: 32 }).notNull(),
  accountName:   varchar("account_name",   { length: 128 }).notNull(),
  routingNumber: varchar("routing_number", { length: 32 }),
  sortCode:      varchar("sort_code",      { length: 16 }),
  iban:          varchar("iban",           { length: 64 }),
  swiftCode:     varchar("swift_code",     { length: 16 }),
  status:        vaStatusEnum("status").default("active"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

// ─── Recurring Payments ───────────────────────────────────────────────────────
export const recurringPayments = pgTable("recurring_payments", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  name:             varchar("name",             { length: 128 }).notNull(),
  recipientName:    varchar("recipient_name",   { length: 128 }),
  recipientAccount: varchar("recipient_account",{ length: 64 }),
  recipientBank:    varchar("recipient_bank",   { length: 128 }),
  amount:           decimal("amount",           { precision: 18, scale: 2 }).notNull(),
  currency:         varchar("currency",         { length: 8 }).default("NGN"),
  frequency:        recurFreqEnum("frequency").notNull(),
  nextRunAt:        timestamp("next_run_at"),
  lastRunAt:        timestamp("last_run_at"),
  status:           recurStatusEnum("status").default("active"),
  lastRunStatus:    varchar("last_run_status",  { length: 16 }),
  failureCount:     integer("failure_count").default(0),
  executionCount:   integer("execution_count").default(0),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});

// ─── Batch Payments ───────────────────────────────────────────────────────────
export const batchPayments = pgTable("batch_payments", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  name:             varchar("name",      { length: 128 }).notNull(),
  totalAmount:      decimal("total_amount",   { precision: 18, scale: 2 }),
  currency:         varchar("currency",       { length: 8 }).default("NGN"),
  totalRecipients:  integer("total_recipients").default(0),
  successCount:     integer("success_count").default(0),
  failedCount:      integer("failed_count").default(0),
  status:           batchStatusEnum("status").default("draft"),
  payments:         json("payments"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});

// ─── Referrals ────────────────────────────────────────────────────────────────
export const referrals = pgTable("referrals", {
  id:             serial("id").primaryKey(),
  referrerId:     integer("referrer_id").notNull(),
  referredId:     integer("referred_id").notNull(),
  status:         referralStatusEnum("status").default("pending"),
  rewardAmount:   decimal("reward_amount",  { precision: 18, scale: 2 }).default("500.00"),
  rewardCurrency: varchar("reward_currency",{ length: 8 }).default("NGN"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// ─── Disputes ─────────────────────────────────────────────────────────────────
export const disputes = pgTable("disputes", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull(),
  transactionId: integer("transaction_id"),
  type:          disputeTypeEnum("type").notNull(),
  description:   text("description").notNull(),
  status:        disputeStatusEnum("status").default("open"),
  resolution:    text("resolution"),
  fileUrl:       text("file_url"),
  fileKey:       text("file_key"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});

// ─── FX Rate Cache ────────────────────────────────────────────────────────────
export const fxRateCache = pgTable("fx_rate_cache", {
  id:           serial("id").primaryKey(),
  baseCurrency: varchar("base_currency", { length: 8 }).notNull(),
  rates:        json("rates").notNull(),
  fetchedAt:    timestamp("fetched_at").defaultNow().notNull(),
});

// ─── Support Tickets ──────────────────────────────────────────────────────────
export const supportTickets = pgTable("support_tickets", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull(),
  subject:    varchar("subject",  { length: 255 }).notNull(),
  message:    text("message").notNull(),
  status:     ticketStatusEnum("status").default("open"),
  priority:   ticketPriorityEnum("priority").default("medium"),
  category:   varchar("category", { length: 100 }),
  agentId:    integer("agent_id"),
  resolution: text("resolution"),
  createdAt:  timestamp("created_at").defaultNow(),
  updatedAt:  timestamp("updated_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── Rate Locks ───────────────────────────────────────────────────────────────
export const rateLocks = pgTable("rate_locks", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull(),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency:   varchar("to_currency",   { length: 10 }).notNull(),
  lockedRate:   decimal("locked_rate",   { precision: 18, scale: 8 }).notNull(),
  amount:       decimal("amount",        { precision: 18, scale: 2 }).notNull(),
  expiresAt:    timestamp("expires_at").notNull(),
  status:       rateLockStatusEnum("status").default("active"),
  createdAt:    timestamp("created_at").defaultNow(),
});

// ─── Direct Debit Mandates ────────────────────────────────────────────────────
export const directDebitMandates = pgTable("direct_debit_mandates", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull(),
  creditor:       varchar("creditor",         { length: 255 }).notNull(),
  creditorAccount:varchar("creditor_account", { length: 100 }),
  amount:         decimal("amount",           { precision: 18, scale: 2 }).notNull(),
  currency:       varchar("currency",         { length: 10 }).default("NGN"),
  frequency:      ddFreqEnum("frequency").default("monthly"),
  status:         ddStatusEnum("status").default("active"),
  nextDebitDate:  timestamp("next_debit_date"),
  lastDebitDate:  timestamp("last_debit_date"),
  mandateRef:     varchar("mandate_ref",      { length: 100 }),
  createdAt:      timestamp("created_at").defaultNow(),
});

// ─── Consent Records ──────────────────────────────────────────────────────────
export const consentRecords = pgTable("consent_records", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull(),
  consentType: varchar("consent_type", { length: 100 }).notNull(),
  granted:     boolean("granted").default(false),
  version:     varchar("version",      { length: 20 }).default("1.0"),
  ipAddress:   varchar("ip_address",   { length: 45 }),
  grantedAt:   timestamp("granted_at"),
  revokedAt:   timestamp("revoked_at"),
  createdAt:   timestamp("created_at").defaultNow(),
});

// ─── Payment Performance Metrics ─────────────────────────────────────────────
export const paymentMetrics = pgTable("payment_metrics", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  corridor:         varchar("corridor",          { length: 20 }).notNull(),
  successCount:     integer("success_count").default(0),
  failureCount:     integer("failure_count").default(0),
  avgProcessingMs:  integer("avg_processing_ms").default(0),
  totalVolume:      decimal("total_volume",       { precision: 18, scale: 2 }).default("0.00"),
  period:           varchar("period",             { length: 20 }).notNull(),
  createdAt:        timestamp("created_at").defaultNow(),
});

// ─── BNPL Plans ───────────────────────────────────────────────────────────────
export const bnplPlans = pgTable("bnpl_plans", {
  id:                serial("id").primaryKey(),
  userId:            integer("user_id").notNull(),
  merchant:          varchar("merchant",           { length: 200 }).notNull(),
  description:       varchar("description",        { length: 500 }),
  totalAmount:       decimal("total_amount",        { precision: 18, scale: 2 }).notNull(),
  paidAmount:        decimal("paid_amount",         { precision: 18, scale: 2 }).default("0.00"),
  currency:          varchar("currency",            { length: 10 }).default("NGN"),
  installments:      integer("installments").default(4),
  installmentAmount: decimal("installment_amount",  { precision: 18, scale: 2 }),
  interestRate:      decimal("interest_rate",       { precision: 5, scale: 2 }).default("2.50"),
  status:            varchar("status",              { length: 20 }).default("active"),
  nextDueDate:       timestamp("next_due_date"),
  completedAt:       timestamp("completed_at"),
  createdAt:         timestamp("created_at").defaultNow(),
  updatedAt:         timestamp("updated_at").defaultNow(),
});

// ─── CBDC Wallets ─────────────────────────────────────────────────────────────
export const cbdcWallets = pgTable("cbdc_wallets", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull(),
  currency:      varchar("currency",       { length: 10 }).notNull(),
  balance:       decimal("balance",        { precision: 18, scale: 2 }).default("0.00"),
  walletAddress: varchar("wallet_address", { length: 100 }),
  issuer:        varchar("issuer",         { length: 200 }).default("Central Bank"),
  walletType:    varchar("wallet_type",    { length: 20 }).default("retail"),
  status:        varchar("status",         { length: 20 }).default("active"),
  createdAt:     timestamp("created_at").defaultNow(),
  updatedAt:     timestamp("updated_at").defaultNow(),
});

// ─── Stablecoin Wallets ───────────────────────────────────────────────────────
export const stablecoinWallets = pgTable("stablecoin_wallets", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull(),
  symbol:        varchar("symbol",         { length: 10 }).notNull(),
  balance:       decimal("balance",        { precision: 18, scale: 8 }).default("0.00000000"),
  walletAddress: varchar("wallet_address", { length: 200 }),
  network:       varchar("network",        { length: 50 }).default("Ethereum"),
  protocol:      varchar("protocol",       { length: 50 }).default("ERC-20"),
  status:        varchar("status",         { length: 20 }).default("active"),
  createdAt:     timestamp("created_at").defaultNow(),
  updatedAt:     timestamp("updated_at").defaultNow(),
});

// ─── Mojaloop Transfers ───────────────────────────────────────────────────────
export const mojaloopTransfers = pgTable("mojaloop_transfers", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  transferId:       varchar("transfer_id",       { length: 100 }),
  quoteId:          varchar("quote_id",          { length: 100 }),
  transactionId:    varchar("transaction_id",    { length: 100 }),
  payerFsp:         varchar("payer_fsp",         { length: 100 }),
  payeeFsp:         varchar("payee_fsp",         { length: 100 }),
  payerIdentifier:  varchar("payer_identifier",  { length: 200 }),
  payeeIdentifier:  varchar("payee_identifier",  { length: 200 }),
  amount:           decimal("amount",            { precision: 18, scale: 2 }).notNull(),
  currency:         varchar("currency",          { length: 10 }).notNull(),
  ilpPacket:        text("ilp_packet"),
  condition:        varchar("condition",         { length: 200 }),
  fulfilment:       varchar("fulfilment",        { length: 200 }),
  status:           varchar("status",            { length: 30 }).default("PENDING"),
  errorCode:        varchar("error_code",        { length: 10 }),
  errorDescription: varchar("error_description", { length: 500 }),
  expirationDate:   timestamp("expiration_date"),
  completedAt:      timestamp("completed_at"),
  createdAt:        timestamp("created_at").defaultNow(),
});

// ─── POS Terminals ────────────────────────────────────────────────────────────
export const posTerminals = pgTable("pos_terminals", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  terminalId:       varchar("terminal_id",       { length: 50 }).notNull(),
  merchantName:     varchar("merchant_name",     { length: 200 }).notNull(),
  merchantCategory: varchar("merchant_category", { length: 100 }),
  location:         varchar("location",          { length: 300 }),
  status:           varchar("status",            { length: 20 }).default("active"),
  serialNumber:     varchar("serial_number",     { length: 100 }),
  model:            varchar("model",             { length: 100 }),
  lastSeen:         timestamp("last_seen"),
  dailyLimit:       decimal("daily_limit",       { precision: 18, scale: 2 }).default("500000.00"),
  totalTransactions:integer("total_transactions").default(0),
  totalVolume:      decimal("total_volume",      { precision: 18, scale: 2 }).default("0.00"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

// ─── Agent Accounts ───────────────────────────────────────────────────────────
export const agentAccounts = pgTable("agent_accounts", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  agentCode:        varchar("agent_code",    { length: 20 }).notNull(),
  businessName:     varchar("business_name", { length: 200 }),
  location:         varchar("location",      { length: 300 }),
  phone:            varchar("phone",         { length: 20 }),
  status:           varchar("status",        { length: 20 }).default("active"),
  tier:             varchar("tier",          { length: 20 }).default("basic"),
  commissionRate:   decimal("commission_rate",{ precision: 5, scale: 2 }).default("1.50"),
  dailyLimit:       decimal("daily_limit",   { precision: 18, scale: 2 }).default("1000000.00"),
  totalTransactions:integer("total_transactions").default(0),
  totalVolume:      decimal("total_volume",  { precision: 18, scale: 2 }).default("0.00"),
  rating:           decimal("rating",        { precision: 3, scale: 2 }).default("5.00"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

// ─── KYB Records ─────────────────────────────────────────────────────────────
export const kybRecords = pgTable("kyb_records", {
  id:                 serial("id").primaryKey(),
  userId:             integer("user_id").notNull(),
  businessName:       varchar("business_name",      { length: 300 }).notNull(),
  registrationNumber: varchar("registration_number",{ length: 100 }),
  taxId:              varchar("tax_id",              { length: 100 }),
  incorporationDate:  varchar("incorporation_date",  { length: 20 }),
  country:            varchar("country",             { length: 10 }),
  industry:           varchar("industry",            { length: 100 }),
  website:            varchar("website",             { length: 300 }),
  annualRevenue:      decimal("annual_revenue",      { precision: 18, scale: 2 }),
  employeeCount:      integer("employee_count"),
  uboName:            varchar("ubo_name",            { length: 200 }),
  uboOwnership:       decimal("ubo_ownership",       { precision: 5, scale: 2 }),
  status:             varchar("status",              { length: 30 }).default("pending"),
  riskRating:         varchar("risk_rating",         { length: 20 }).default("medium"),
  reviewedBy:         varchar("reviewed_by",         { length: 100 }),
  reviewedAt:         timestamp("reviewed_at"),
  rejectionReason:    text("rejection_reason"),
  createdAt:          timestamp("created_at").defaultNow(),
  updatedAt:          timestamp("updated_at").defaultNow(),
});

// ─── Idempotency Keys ─────────────────────────────────────────────────────────
export const idempotencyKeys = pgTable("idempotency_keys", {
  id:             serial("id").primaryKey(),
  key:            varchar("key",       { length: 200 }).notNull(),
  userId:         integer("user_id"),
  operation:      varchar("operation", { length: 100 }).notNull(),
  responseStatus: integer("response_status"),
  responseBody:   text("response_body"),
  expiresAt:      timestamp("expires_at").notNull(),
  createdAt:      timestamp("created_at").defaultNow(),
});

// ─── Outbox Events ────────────────────────────────────────────────────────────
export const outboxEvents = pgTable("outbox_events", {
  id:            serial("id").primaryKey(),
  aggregateId:   varchar("aggregate_id",   { length: 100 }).notNull(),
  aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
  eventType:     varchar("event_type",     { length: 100 }).notNull(),
  payload:       text("payload").notNull(),
  status:        varchar("status",         { length: 20 }).default("pending"),
  retryCount:    integer("retry_count").default(0),
  maxRetries:    integer("max_retries").default(3),
  publishedAt:   timestamp("published_at"),
  failedAt:      timestamp("failed_at"),
  errorMessage:  text("error_message"),
  createdAt:     timestamp("created_at").defaultNow(),
});

// ─── GDPR Erasure Requests ────────────────────────────────────────────────────
export const erasureRequests = pgTable("erasure_requests", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  requestedAt:      timestamp("requested_at").defaultNow(),
  scheduledAt:      timestamp("scheduled_at").notNull(),
  executedAt:       timestamp("executed_at"),
  cancelledAt:      timestamp("cancelled_at"),
  status:           varchar("status",            { length: 30 }).default("pending"),
  reason:           varchar("reason",            { length: 500 }),
  ipAddress:        varchar("ip_address",        { length: 45 }),
  anonymizedFields: text("anonymized_fields"),
  retainedRecords:  text("retained_records"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

// ─── Fraud Alerts ─────────────────────────────────────────────────────────────
export const fraudAlerts = pgTable("fraud_alerts", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull(),
  riskLevel:      varchar("risk_level",     { length: 20 }).notNull(),
  flags:          json("flags"),
  status:         varchar("status",         { length: 20 }).default("pending"),
  riskScore:      integer("risk_score").default(0),
  reviewerNotes:  text("reviewer_notes"),
  createdAt:      timestamp("created_at").defaultNow(),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type User              = typeof users.$inferSelect;
export type InsertUser        = typeof users.$inferInsert;
export type Transaction       = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;
export type Wallet            = typeof wallets.$inferSelect;
export type InsertWallet      = typeof wallets.$inferInsert;
export type Beneficiary       = typeof beneficiaries.$inferSelect;
export type InsertBeneficiary = typeof beneficiaries.$inferInsert;
export type Card              = typeof cards.$inferSelect;
export type InsertCard        = typeof cards.$inferInsert;
export type SavingsGoal       = typeof savingsGoals.$inferSelect;
export type InsertSavingsGoal = typeof savingsGoals.$inferInsert;
export type FxAlert           = typeof fxAlerts.$inferSelect;
export type InsertFxAlert     = typeof fxAlerts.$inferInsert;
export type KycDocument       = typeof kycDocuments.$inferSelect;
export type InsertKycDocument = typeof kycDocuments.$inferInsert;
export type Notification      = typeof notifications.$inferSelect;
export type InsertNotification= typeof notifications.$inferInsert;
export type AuditLog          = typeof auditLogs.$inferSelect;
export type VirtualAccount    = typeof virtualAccounts.$inferSelect;
export type RecurringPayment  = typeof recurringPayments.$inferSelect;
export type BatchPayment      = typeof batchPayments.$inferSelect;
export type Referral          = typeof referrals.$inferSelect;
export type Dispute           = typeof disputes.$inferSelect;
export type BnplPlan          = typeof bnplPlans.$inferSelect;
export type CbdcWallet        = typeof cbdcWallets.$inferSelect;
export type StablecoinWallet  = typeof stablecoinWallets.$inferSelect;
export type MojaloopTransfer  = typeof mojaloopTransfers.$inferSelect;
export type PosTerminal       = typeof posTerminals.$inferSelect;
export type AgentAccount      = typeof agentAccounts.$inferSelect;
export type KybRecord         = typeof kybRecords.$inferSelect;
export type IdempotencyKey    = typeof idempotencyKeys.$inferSelect;
export type OutboxEvent       = typeof outboxEvents.$inferSelect;
export type ErasureRequest    = typeof erasureRequests.$inferSelect;
export type FraudAlert        = typeof fraudAlerts.$inferSelect;
