import {
  boolean,
  char,
  date,
  decimal,
  integer,
  json,
  jsonb,
  bigint,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  numeric,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum("role", ["admin", "user", "partner"]);
export const kycTierEnum = pgEnum("kycTier", ["tier0", "tier1", "tier2", "tier3"]);
export const walletStatusEnum = pgEnum("wallet_status", ["active", "suspended", "closed"]);
export const txTypeEnum = pgEnum("tx_type", ["send", "receive", "exchange", "topup", "withdrawal", "fee", "refund", "airtime", "bill", "savings", "card"]);
export const txStatusEnum = pgEnum("tx_status", ["initiated", "pending", "processing", "completed", "failed", "cancelled", "reversed"]);
export const cardTypeEnum = pgEnum("card_type", ["virtual", "physical"]);
export const cardBrandEnum = pgEnum("card_brand", ["visa", "mastercard", "verve"]);
export const cardStatusEnum = pgEnum("card_status", ["active", "frozen", "expired", "cancelled"]);
export const savingsStatusEnum = pgEnum("savings_status", ["active", "completed", "paused"]);
export const fxDirectionEnum = pgEnum("fx_direction", ["above", "below"]);
export const kycDocTypeEnum = pgEnum("kyc_doc_type", ["passport", "national_id", "drivers_license", "utility_bill", "bank_statement", "selfie", "proof_of_address"]);
export const kycDocStatusEnum = pgEnum("kyc_doc_status", ["pending", "under_review", "approved", "rejected"]);
export const notifTypeEnum = pgEnum("notif_type", ["transaction", "security", "kyc", "system", "promotion", "fx_alert"]);
export const auditSeverityEnum = pgEnum("audit_severity", ["info", "warning", "critical"]);
export const vaStatusEnum = pgEnum("va_status", ["active", "inactive"]);
export const recurringFreqEnum = pgEnum("recurring_freq", ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"]);
export const recurringStatusEnum = pgEnum("recurring_status", ["active", "paused", "cancelled"]);
export const scheduledRunStatusEnum = pgEnum("scheduled_run_status", ["success", "failed", "skipped"]);
export const batchStatusEnum = pgEnum("batch_status", ["draft", "processing", "completed", "failed", "partial"]);
export const referralStatusEnum = pgEnum("referral_status", ["pending", "completed", "rewarded"]);
export const disputeTypeEnum = pgEnum("dispute_type", ["unauthorized", "duplicate", "not_received", "wrong_amount", "other"]);
export const disputeStatusEnum = pgEnum("dispute_status", ["open", "under_review", "resolved", "closed"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "in_progress", "resolved", "closed"]);
export const ticketPriorityEnum = pgEnum("ticket_priority", ["low", "medium", "high", "critical"]);
export const rateLockStatusEnum = pgEnum("rate_lock_status", ["active", "used", "expired"]);
export const ddFreqEnum = pgEnum("dd_freq", ["weekly", "monthly", "quarterly", "annually"]);
export const ddStatusEnum = pgEnum("dd_status", ["active", "paused", "cancelled"]);
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);
export const caseTypeEnum = pgEnum("case_type", ["aml_flag", "fraud_alert", "sanctions_hit", "pep_match", "unusual_activity", "high_risk_corridor"]);
export const caseSeverityEnum = pgEnum("case_severity", ["low", "medium", "high", "critical"]);
export const caseStatusEnum = pgEnum("case_status", ["open", "under_review", "resolved", "escalated", "dismissed"]);

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 128 }).unique().notNull(),
  email: varchar("email", { length: 320 }),
  name: varchar("name", { length: 128 }),
  phone: varchar("phone", { length: 32 }),
  avatar: text("avatar"),
  loginMethod: varchar("loginMethod", { length: 32 }),
  role: roleEnum("role").default("user"),
  kycTier: kycTierEnum("kycTier").default("tier0"),
  referralCode: varchar("referralCode", { length: 16 }),
  referredBy: integer("referredBy"),
  twoFactorEnabled: boolean("twoFactorEnabled").default(false),
  twoFactorSecret: varchar("twoFactorSecret", { length: 64 }),
  address: varchar("address", { length: 256 }),
  dateOfBirth: date("dateOfBirth"),
  defaultCurrency: varchar("defaultCurrency", { length: 8 }).default("NGN"),
  lastSignedIn: timestamp("lastSignedIn"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ─── Wallets ──────────────────────────────────────────────────────────────────
export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  balance: numeric("balance", { precision: 18, scale: 2 }).default("0.00").notNull(),
  lockedBalance: numeric("lockedBalance", { precision: 18, scale: 2 }).default("0.00"),
  isDefault: boolean("isDefault").default(false),
  status: walletStatusEnum("status").default("active"),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("wallets_userId_idx").on(t.userId),
  index("wallets_userId_currency_idx").on(t.userId, t.currency),
]);

// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  type: txTypeEnum("type").notNull(),
  status: txStatusEnum("status").default("pending"),
  fromCurrency: varchar("fromCurrency", { length: 8 }).notNull(),
  fromAmount: numeric("fromAmount", { precision: 18, scale: 2 }).notNull(),
  toCurrency: varchar("toCurrency", { length: 8 }),
  toAmount: numeric("toAmount", { precision: 18, scale: 2 }),
  fee: numeric("fee", { precision: 18, scale: 2 }).default("0.00"),
  fxRate: numeric("fxRate", { precision: 18, scale: 6 }),
  reference: varchar("reference", { length: 64 }),
  description: text("description"),
  recipientName: varchar("recipientName", { length: 128 }),
  recipientAccount: varchar("recipientAccount", { length: 64 }),
  recipientBank: varchar("recipientBank", { length: 128 }),
  recipientCountry: varchar("recipientCountry", { length: 64 }),
  channel: varchar("channel", { length: 32 }),
  metadata: json("metadata"),
  idempotencyKey: varchar("idempotency_key", { length: 200 }),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("transactions_userId_idx").on(t.userId),
  index("transactions_userId_createdAt_idx").on(t.userId, t.createdAt),
  index("transactions_userId_status_idx").on(t.userId, t.status),
  index("transactions_reference_idx").on(t.reference),
  index("transactions_idempotencyKey_idx").on(t.idempotencyKey),
]);

// ─── Beneficiaries ────────────────────────────────────────────────────────────
export const beneficiaries = pgTable("beneficiaries", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  accountNumber: varchar("accountNumber", { length: 64 }),
  bankName: varchar("bankName", { length: 128 }),
  bankCode: varchar("bankCode", { length: 16 }),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  country: varchar("country", { length: 64 }),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  isFavorite: boolean("isFavorite").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("beneficiaries_userId_idx").on(t.userId),
]);

// ─── Cards ────────────────────────────────────────────────────────────────────
export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  type: cardTypeEnum("type").notNull(),
  brand: cardBrandEnum("brand").notNull(),
  last4: varchar("last4", { length: 4 }).notNull(),
  expiryMonth: varchar("expiryMonth", { length: 2 }).notNull(),
  expiryYear: varchar("expiryYear", { length: 4 }).notNull(),
  status: cardStatusEnum("status").default("active"),
  currency: varchar("currency", { length: 8 }).default("USD"),
  spendLimit: numeric("spendLimit", { precision: 18, scale: 2 }),
  cardholderName: varchar("cardholderName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("cards_userId_idx").on(t.userId),
  index("cards_userId_status_idx").on(t.userId, t.status),
]);

// ─── Savings Goals ────────────────────────────────────────────────────────────
export const savingsGoals = pgTable("savingsGoals", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  emoji: varchar("emoji", { length: 8 }).default("🎯"),
  targetAmount: numeric("targetAmount", { precision: 18, scale: 2 }).notNull(),
  currentAmount: numeric("currentAmount", { precision: 18, scale: 2 }).default("0.00"),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  targetDate: timestamp("targetDate"),
  autoSave: boolean("autoSave").default(false),
  autoSaveAmount: numeric("autoSaveAmount", { precision: 18, scale: 2 }),
  purpose: varchar("purpose", { length: 32 }).default("other"),
  status: savingsStatusEnum("status").default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("savingsGoals_userId_idx").on(t.userId),
  index("savingsGoals_userId_status_idx").on(t.userId, t.status),
]);

// ─── FX Alerts ────────────────────────────────────────────────────────────────
export const fxAlerts = pgTable("fxAlerts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  fromCurrency: varchar("fromCurrency", { length: 8 }).notNull(),
  toCurrency: varchar("toCurrency", { length: 8 }).notNull(),
  targetRate: numeric("targetRate", { precision: 18, scale: 6 }).notNull(),
  direction: fxDirectionEnum("direction").notNull(),
  isActive: boolean("isActive").default(true),
  triggered: boolean("triggered").default(false),
  triggeredAt: timestamp("triggeredAt"),
  notifiedAt: timestamp("notifiedAt"),
  lastCheckedRate: numeric("lastCheckedRate", { precision: 18, scale: 6 }),
  lastCheckedAt: timestamp("lastCheckedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── KYC Documents ────────────────────────────────────────────────────────────
export const kycDocuments = pgTable("kycDocuments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  docType: kycDocTypeEnum("docType").notNull(),
  status: kycDocStatusEnum("status").default("pending"),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  rejectionReason: text("rejectionReason"),
  expiresAt: timestamp("expiresAt"),
  reviewedAt: timestamp("reviewedAt"),
  supersededAt: timestamp("supersededAt"),
  extractedData: json("extractedData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("kycDocuments_userId_idx").on(t.userId),
  index("kycDocuments_userId_status_idx").on(t.userId, t.status),
]);

// ─── Notifications ────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  message: text("message").notNull(),
  type: notifTypeEnum("type").default("system"),
  isRead: boolean("isRead").default(false),
  actionUrl: varchar("actionUrl", { length: 256 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("notifications_userId_idx").on(t.userId),
  index("notifications_userId_isRead_idx").on(t.userId, t.isRead),
]);

// ─── Audit Logs ───────────────────────────────────────────────────────────────
export const auditLogs = pgTable("auditLogs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  targetId: integer("targetId"),
  targetType: varchar("targetType", { length: 64 }),
  action: varchar("action", { length: 64 }).notNull(),
  description: text("description"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: text("userAgent"),
  severity: auditSeverityEnum("severity").default("info"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("auditLogs_userId_idx").on(t.userId),
  index("auditLogs_createdAt_idx").on(t.createdAt),
]);

// ─── Virtual Accounts ─────────────────────────────────────────────────────────
export const virtualAccounts = pgTable("virtualAccounts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  bank: varchar("bank", { length: 128 }).notNull(),
  accountNumber: varchar("accountNumber", { length: 32 }).notNull(),
  accountName: varchar("accountName", { length: 128 }).notNull(),
  routingNumber: varchar("routingNumber", { length: 32 }),
  sortCode: varchar("sortCode", { length: 16 }),
  iban: varchar("iban", { length: 64 }),
  swiftCode: varchar("swiftCode", { length: 16 }),
  status: vaStatusEnum("status").default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Recurring Payments ───────────────────────────────────────────────────────
export const recurringPayments = pgTable("recurringPayments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  recipientName: varchar("recipientName", { length: 128 }),
  recipientAccount: varchar("recipientAccount", { length: 64 }),
  recipientBank: varchar("recipientBank", { length: 128 }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  targetCurrency: varchar("targetCurrency", { length: 8 }).default("USD"),
  description: varchar("description", { length: 256 }),
  frequency: recurringFreqEnum("frequency").notNull(),
  timezone: varchar("timezone", { length: 64 }).default("UTC"),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  nextRunAt: timestamp("nextRunAt"),
  lastRunAt: timestamp("lastRunAt"),
  status: recurringStatusEnum("status").default("active"),
  lastRunStatus: varchar("lastRunStatus", { length: 16 }),
  failureCount: integer("failureCount").default(0),
  executionCount: integer("executionCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ─── Scheduled Transfer Runs ─────────────────────────────────────────────────
export const scheduledTransferRuns = pgTable("scheduledTransferRuns", {
  id: serial("id").primaryKey(),
  scheduleId: integer("scheduleId").notNull(),
  userId: integer("userId").notNull(),
  status: scheduledRunStatusEnum("status").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  targetCurrency: varchar("targetCurrency", { length: 8 }),
  fxRate: numeric("fxRate", { precision: 18, scale: 6 }),
  transactionId: integer("transactionId"),
  errorMessage: varchar("errorMessage", { length: 512 }),
  executedAt: timestamp("executedAt").defaultNow().notNull(),
});
export type ScheduledTransferRun = typeof scheduledTransferRuns.$inferSelect;

// ─── Batch Payments ───────────────────────────────────────────────────────────
export const batchPayments = pgTable("batchPayments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  totalAmount: numeric("totalAmount", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  totalRecipients: integer("totalRecipients").default(0),
  successCount: integer("successCount").default(0),
  failedCount: integer("failedCount").default(0),
  status: batchStatusEnum("status").default("draft"),
  payments: json("payments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ─── Referrals ────────────────────────────────────────────────────────────────
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrerId").notNull(),
  referredId: integer("referredId").notNull(),
  status: referralStatusEnum("status").default("pending"),
  rewardAmount: numeric("rewardAmount", { precision: 18, scale: 2 }).default("500.00"),
  rewardCurrency: varchar("rewardCurrency", { length: 8 }).default("NGN"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Disputes ─────────────────────────────────────────────────────────────────
export const disputes = pgTable("disputes", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  transactionId: integer("transactionId"),
  type: disputeTypeEnum("type").notNull(),
  description: text("description").notNull(),
  status: disputeStatusEnum("status").default("open"),
  resolution: text("resolution"),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ─── FX Rate Cache ────────────────────────────────────────────────────────────
export const fxRateCache = pgTable("fxRateCache", {
  id: serial("id").primaryKey(),
  baseCurrency: varchar("baseCurrency", { length: 8 }).notNull(),
  rates: json("rates").notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type InsertWallet = typeof wallets.$inferInsert;
export type Beneficiary = typeof beneficiaries.$inferSelect;
export type InsertBeneficiary = typeof beneficiaries.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type InsertCard = typeof cards.$inferInsert;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type InsertSavingsGoal = typeof savingsGoals.$inferInsert;
export type FxAlert = typeof fxAlerts.$inferSelect;
export type InsertFxAlert = typeof fxAlerts.$inferInsert;
export type KycDocument = typeof kycDocuments.$inferSelect;
export type InsertKycDocument = typeof kycDocuments.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type VirtualAccount = typeof virtualAccounts.$inferSelect;
export type RecurringPayment = typeof recurringPayments.$inferSelect;
export type BatchPayment = typeof batchPayments.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;

// ─── Support Tickets ──────────────────────────────────────────────────────────
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  message: text("message").notNull(),
  status: ticketStatusEnum("status").default("open"),
  priority: ticketPriorityEnum("priority").default("medium"),
  category: varchar("category", { length: 100 }),
  agentId: integer("agent_id"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── Rate Locks ───────────────────────────────────────────────────────────────
export const rateLocks = pgTable("rate_locks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  lockedRate: numeric("locked_rate", { precision: 18, scale: 8 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  status: rateLockStatusEnum("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Direct Debit Mandates ────────────────────────────────────────────────────
export const directDebitMandates = pgTable("direct_debit_mandates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  creditor: varchar("creditor", { length: 255 }).notNull(),
  creditorAccount: varchar("creditor_account", { length: 100 }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("NGN"),
  frequency: ddFreqEnum("frequency").default("monthly"),
  status: ddStatusEnum("status").default("active"),
  nextDebitDate: timestamp("next_debit_date"),
  lastDebitDate: timestamp("last_debit_date"),
  mandateRef: varchar("mandate_ref", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Consent Records ──────────────────────────────────────────────────────────
export const consentRecords = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  consentType: varchar("consent_type", { length: 100 }).notNull(),
  granted: boolean("granted").default(false),
  version: varchar("version", { length: 20 }).default("1.0"),
  ipAddress: varchar("ip_address", { length: 45 }),
  grantedAt: timestamp("granted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Payment Performance Metrics ─────────────────────────────────────────────
export const paymentMetrics = pgTable("payment_metrics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  corridor: varchar("corridor", { length: 20 }).notNull(),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  avgProcessingMs: integer("avg_processing_ms").default(0),
  totalVolume: numeric("total_volume", { precision: 18, scale: 2 }).default("0.00"),
  period: varchar("period", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── BNPL Plans ───────────────────────────────────────────────────────────────
export const bnplPlans = pgTable("bnpl_plans", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  merchant: varchar("merchant", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }).default("0.00"),
  currency: varchar("currency", { length: 10 }).default("NGN"),
  installments: integer("installments").default(4),
  installmentAmount: numeric("installment_amount", { precision: 18, scale: 2 }),
  interestRate: numeric("interest_rate", { precision: 5, scale: 2 }).default("2.50"),
  status: varchar("status", { length: 20 }).default("active"),
  nextDueDate: timestamp("next_due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── CBDC Wallets ─────────────────────────────────────────────────────────────
export const cbdcWallets = pgTable("cbdc_wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  balance: numeric("balance", { precision: 18, scale: 2 }).default("0.00"),
  walletAddress: varchar("wallet_address", { length: 100 }),
  issuer: varchar("issuer", { length: 200 }).default("Central Bank"),
  walletType: varchar("wallet_type", { length: 20 }).default("retail"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("cbdcWallets_userId_idx").on(t.userId),
  index("cbdcWallets_userId_currency_idx").on(t.userId, t.currency),
]);

// ─── Stablecoin Wallets ───────────────────────────────────────────────────────
export const stablecoinWallets = pgTable("stablecoin_wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  balance: numeric("balance", { precision: 18, scale: 8 }).default("0.00000000"),
  walletAddress: varchar("wallet_address", { length: 200 }),
  network: varchar("network", { length: 50 }).default("Ethereum"),
  protocol: varchar("protocol", { length: 50 }).default("ERC-20"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Mojaloop Transfers ───────────────────────────────────────────────────────
export const mojaloopTransfers = pgTable("mojaloop_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  transferId: varchar("transfer_id", { length: 100 }),
  quoteId: varchar("quote_id", { length: 100 }),
  transactionId: varchar("transaction_id", { length: 100 }),
  payerFsp: varchar("payer_fsp", { length: 100 }),
  payeeFsp: varchar("payee_fsp", { length: 100 }),
  payerIdentifier: varchar("payer_identifier", { length: 200 }),
  payeeIdentifier: varchar("payee_identifier", { length: 200 }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  ilpPacket: text("ilp_packet"),
  condition: varchar("condition", { length: 200 }),
  fulfilment: varchar("fulfilment", { length: 200 }),
  status: varchar("status", { length: 30 }).default("PENDING"),
  errorCode: varchar("error_code", { length: 10 }),
  errorDescription: varchar("error_description", { length: 500 }),
  expirationDate: timestamp("expiration_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── POS Terminals ────────────────────────────────────────────────────────────
export const posTerminals = pgTable("pos_terminals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  terminalId: varchar("terminal_id", { length: 50 }).notNull(),
  merchantName: varchar("merchant_name", { length: 200 }).notNull(),
  merchantCategory: varchar("merchant_category", { length: 100 }),
  location: varchar("location", { length: 300 }),
  status: varchar("status", { length: 20 }).default("active"),
  serialNumber: varchar("serial_number", { length: 100 }),
  model: varchar("model", { length: 100 }),
  lastSeen: timestamp("last_seen"),
  dailyLimit: numeric("daily_limit", { precision: 18, scale: 2 }).default("500000.00"),
  totalTransactions: integer("total_transactions").default(0),
  totalVolume: numeric("total_volume", { precision: 18, scale: 2 }).default("0.00"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Agent Accounts ───────────────────────────────────────────────────────────
export const agentAccounts = pgTable("agent_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  agentCode: varchar("agent_code", { length: 20 }).notNull(),
  businessName: varchar("business_name", { length: 200 }),
  location: varchar("location", { length: 300 }),
  phone: varchar("phone", { length: 20 }),
  status: varchar("status", { length: 20 }).default("active"),
  tier: varchar("tier", { length: 20 }).default("basic"),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).default("1.50"),
  dailyLimit: numeric("daily_limit", { precision: 18, scale: 2 }).default("1000000.00"),
  totalTransactions: integer("total_transactions").default(0),
  totalVolume: numeric("total_volume", { precision: 18, scale: 2 }).default("0.00"),
  rating: numeric("rating", { precision: 3, scale: 2 }).default("5.00"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── KYB Records ─────────────────────────────────────────────────────────────
export const kybRecords = pgTable("kyb_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  businessName: varchar("business_name", { length: 300 }).notNull(),
  registrationNumber: varchar("registration_number", { length: 100 }),
  taxId: varchar("tax_id", { length: 100 }),
  incorporationDate: varchar("incorporation_date", { length: 20 }),
  country: varchar("country", { length: 10 }),
  industry: varchar("industry", { length: 100 }),
  website: varchar("website", { length: 300 }),
  annualRevenue: numeric("annual_revenue", { precision: 18, scale: 2 }),
  employeeCount: integer("employee_count"),
  uboName: varchar("ubo_name", { length: 200 }),
  uboOwnership: numeric("ubo_ownership", { precision: 5, scale: 2 }),
  status: varchar("status", { length: 30 }).default("pending"),
  riskRating: varchar("risk_rating", { length: 20 }).default("medium"),
  reviewedBy: varchar("reviewed_by", { length: 100 }),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Idempotency Keys ─────────────────────────────────────────────────────────
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 200 }).notNull(),
  userId: integer("user_id"),
  operation: varchar("operation", { length: 100 }).notNull(),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("idempotencyKeys_key_unique_idx").on(t.key),
  index("idempotencyKeys_userId_idx").on(t.userId),
  index("idempotencyKeys_expiresAt_idx").on(t.expiresAt),
]);

// ─── Outbox Events ────────────────────────────────────────────────────────────
export const outboxEvents = pgTable("outbox_events", {
  id: serial("id").primaryKey(),
  aggregateId: varchar("aggregate_id", { length: 100 }).notNull(),
  aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  payload: text("payload").notNull(),
  status: varchar("status", { length: 20 }).default("pending"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  publishedAt: timestamp("published_at"),
  failedAt: timestamp("failed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── GDPR Erasure Requests ────────────────────────────────────────────────────
export const erasureRequests = pgTable("erasure_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  requestedAt: timestamp("requested_at").defaultNow(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  executedAt: timestamp("executed_at"),
  cancelledAt: timestamp("cancelled_at"),
  status: varchar("status", { length: 30 }).default("pending"),
  reason: varchar("reason", { length: 500 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  anonymizedFields: text("anonymized_fields"),
  retainedRecords: text("retained_records"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Notification Preferences ────────────────────────────────────────────────
export const notificationPreferences = pgTable("notificationPreferences", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  emailEnabled: boolean("emailEnabled").default(true),
  inAppEnabled: boolean("inAppEnabled").default(true),
  pushEnabled: boolean("pushEnabled").default(false),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
});

// ─── New Type Exports ─────────────────────────────────────────────────────
export type BnplPlan = typeof bnplPlans.$inferSelect;
export type CbdcWallet = typeof cbdcWallets.$inferSelect;
export type StablecoinWallet = typeof stablecoinWallets.$inferSelect;
export type MojaloopTransfer = typeof mojaloopTransfers.$inferSelect;
export type PosTerminal = typeof posTerminals.$inferSelect;
export type AgentAccount = typeof agentAccounts.$inferSelect;
export type KybRecord = typeof kybRecords.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type ErasureRequest = typeof erasureRequests.$inferSelect;

// ─── Chat Sessions ─────────────────────────────────────────────────────────
export const chatSessions = pgTable("chatSessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull().default("New Conversation"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ─── Chat Messages ─────────────────────────────────────────────────────────
export const chatMessages = pgTable("chatMessages", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

// ─── Compliance Cases ──────────────────────────────────────────────────────
export const complianceCases = pgTable("complianceCases", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  transactionId: integer("transactionId"),
  caseType: caseTypeEnum("caseType").notNull().default("aml_flag"),
  severity: caseSeverityEnum("severity").notNull().default("medium"),
  status: caseStatusEnum("status").notNull().default("open"),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  riskScore: integer("riskScore").default(0),
  priority: ticketPriorityEnum("priority").default("medium"),
  assignedTo: varchar("assignedTo", { length: 255 }),
  dueAt: timestamp("dueAt"),
  resolvedAt: timestamp("resolvedAt"),
  escalatedAt: timestamp("escalatedAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ComplianceCase = typeof complianceCases.$inferSelect;
export type InsertComplianceCase = typeof complianceCases.$inferInsert;

// ─── Case Comments ────────────────────────────────────────────────────────────
export const caseComments = pgTable("caseComments", {
  id: serial("id").primaryKey(),
  caseId: integer("caseId").notNull(),
  authorId: integer("authorId").notNull(),
  authorName: varchar("authorName", { length: 128 }).notNull(),
  content: text("content").notNull(),
  isInternal: boolean("isInternal").default(true),
  parentId: integer("parentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CaseComment = typeof caseComments.$inferSelect;
export type InsertCaseComment = typeof caseComments.$inferInsert;

// ─── Impersonation Tokens ─────────────────────────────────────────────────────
export const impersonationTokens = pgTable("impersonationTokens", {
  id: serial("id").primaryKey(),
  adminId: integer("adminId").notNull(),
  targetUserId: integer("targetUserId").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ImpersonationToken = typeof impersonationTokens.$inferSelect;
export type InsertImpersonationToken = typeof impersonationTokens.$inferInsert;

// ─── Fraud Alerts ─────────────────────────────────────────────────────────────
export const fraudRiskLevelEnum = pgEnum("fraud_risk_level", ["low", "medium", "high", "critical"]);
export const fraudAlertStatusEnum = pgEnum("fraud_alert_status", ["pending", "reviewed", "blocked", "cleared"]);
export const fraudAlerts = pgTable("fraud_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  transactionId: integer("transaction_id"),
  riskScore: integer("risk_score").default(0),
  riskLevel: fraudRiskLevelEnum("risk_level").default("low"),
  status: fraudAlertStatusEnum("status").default("pending"),
  flaggedReasons: json("flagged_reasons"),
  transactionAmount: integer("transaction_amount").default(0),
  reviewerId: integer("reviewer_id"),
  reviewerNotes: text("reviewer_notes"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FraudAlert = typeof fraudAlerts.$inferSelect;
export type InsertFraudAlert = typeof fraudAlerts.$inferInsert;

// ─── Analytics Alert Thresholds ───────────────────────────────────────────────
export const thresholdOperatorEnum = pgEnum("threshold_operator", ["below", "above"]);
export const analyticsThresholds = pgTable("analyticsThresholds", {
  id: serial("id").primaryKey(),
  metric: varchar("metric", { length: 64 }).notNull().unique(), // e.g. "kycApprovalRate", "avgResolutionHours", "newUsers", "transferVolume"
  label: varchar("label", { length: 128 }).notNull(),
  threshold: integer("threshold").notNull(),
  operator: thresholdOperatorEnum("operator").notNull().default("below"),
  notifyOwner: boolean("notifyOwner").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type AnalyticsThreshold = typeof analyticsThresholds.$inferSelect;
export type InsertAnalyticsThreshold = typeof analyticsThresholds.$inferInsert;

// ── AfriMarket P2P Marketplace ───────────────────────────────────────────────
export const marketListingStatusEnum = pgEnum("market_listing_status", ["active", "sold", "cancelled", "pending"]);
export const marketOrderStatusEnum = pgEnum("market_order_status", ["pending_payment", "paid", "shipped", "delivered", "disputed", "refunded", "cancelled"]);
export const marketCategoryEnum = pgEnum("market_category", ["electronics", "fashion", "food", "crafts", "services", "real_estate", "agriculture", "education", "health", "other"]);

export const marketListings = pgTable("market_listings", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").notNull().references(() => users.id),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  category: marketCategoryEnum("category").notNull().default("other"),
  price: numeric("price", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("USD"),
  country: varchar("country", { length: 64 }).notNull(),
  city: varchar("city", { length: 64 }),
  imageUrl: text("image_url"),
  status: marketListingStatusEnum("status").notNull().default("active"),
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type MarketListing = typeof marketListings.$inferSelect;
export type InsertMarketListing = typeof marketListings.$inferInsert;

export const marketOrders = pgTable("market_orders", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id").notNull().references(() => marketListings.id),
  buyerId: integer("buyer_id").notNull().references(() => users.id),
  sellerId: integer("seller_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  status: marketOrderStatusEnum("status").notNull().default("pending_payment"),
  escrowHeld: boolean("escrow_held").default(false),
  buyerNote: text("buyer_note"),
  sellerNote: text("seller_note"),
  deliveryConfirmedAt: timestamp("deliveryConfirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type MarketOrder = typeof marketOrders.$inferSelect;
export type InsertMarketOrder = typeof marketOrders.$inferInsert;

// ─── Talent Bridge Tables ─────────────────────────────────────────────────────
export const talentAvailabilityEnum = pgEnum("talent_availability", ["full_time", "part_time", "advisory", "project_based"]);
export const talentBookingStatusEnum = pgEnum("talent_booking_status", ["pending", "accepted", "declined", "completed", "cancelled"]);
export const talentEngagementEnum = pgEnum("talent_engagement", ["advisory", "mentorship", "consulting", "speaking", "training"]);

export const talentProfiles = pgTable("talent_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  bio: text("bio"),
  expertise: json("expertise").$type<string[]>().default([]),
  countries: json("countries").$type<string[]>().default([]),
  availability: talentAvailabilityEnum("availability").default("advisory"),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 10 }).default("USD"),
  linkedinUrl: text("linkedin_url"),
  portfolioUrl: text("portfolio_url"),
  verified: boolean("verified").default(false),
  totalBookings: integer("total_bookings").default(0),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TalentProfile = typeof talentProfiles.$inferSelect;

export const talentOpportunities = pgTable("talent_opportunities", {
  id: serial("id").primaryKey(),
  postedByUserId: integer("posted_by_user_id").notNull().references(() => users.id),
  institutionName: varchar("institution_name", { length: 200 }).notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  sector: varchar("sector", { length: 100 }),
  country: varchar("country", { length: 64 }),
  engagementType: talentEngagementEnum("engagement_type").default("advisory"),
  compensation: numeric("compensation", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 10 }).default("USD"),
  deadline: timestamp("deadline"),
  status: varchar("status", { length: 20 }).default("open"),
  applicantCount: integer("applicant_count").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TalentOpportunity = typeof talentOpportunities.$inferSelect;

export const talentBookings = pgTable("talent_bookings", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => talentOpportunities.id),
  expertUserId: integer("expert_user_id").notNull().references(() => users.id),
  status: talentBookingStatusEnum("status").default("pending"),
  message: text("message"),
  proposedRate: numeric("proposed_rate", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 10 }).default("USD"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TalentBooking = typeof talentBookings.$inferSelect;

// ─── Community / DiasporaDAO Tables ──────────────────────────────────────────
export const communityFundStatusEnum = pgEnum("community_fund_status", ["active", "completed", "paused", "closed"]);
export const proposalStatusEnum = pgEnum("proposal_status", ["draft", "voting", "approved", "rejected", "funded", "completed"]);

export const communityFunds = pgTable("community_funds", {
  id: serial("id").primaryKey(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  country: varchar("country", { length: 64 }),
  theme: varchar("theme", { length: 100 }),
  totalRaised: numeric("total_raised", { precision: 18, scale: 2 }).default("0"),
  goalAmount: numeric("goal_amount", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 10 }).default("USD"),
  contributorCount: integer("contributor_count").default(0),
  beneficiaryCount: integer("beneficiary_count").default(0),
  sdgGoals: json("sdg_goals").$type<number[]>().default([]),
  status: communityFundStatusEnum("status").default("active"),
  imageUrl: text("image_url"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type CommunityFund = typeof communityFunds.$inferSelect;

export const fundProposals = pgTable("fund_proposals", {
  id: serial("id").primaryKey(),
  fundId: integer("fund_id").notNull().references(() => communityFunds.id),
  submittedByUserId: integer("submitted_by_user_id").notNull().references(() => users.id),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  requestedAmount: numeric("requested_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD"),
  beneficiaryName: varchar("beneficiary_name", { length: 200 }),
  beneficiaryCountry: varchar("beneficiary_country", { length: 64 }),
  impactDescription: text("impact_description"),
  status: proposalStatusEnum("status").default("voting"),
  votesFor: integer("votes_for").default(0),
  votesAgainst: integer("votes_against").default(0),
  votingDeadline: timestamp("voting_deadline"),
  fundedAt: timestamp("funded_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type FundProposal = typeof fundProposals.$inferSelect;

export const fundVotes = pgTable("fund_votes", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id").notNull().references(() => fundProposals.id),
  userId: integer("user_id").notNull().references(() => users.id),
  vote: varchar("vote", { length: 10 }).notNull(), // "for" | "against"
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type FundVote = typeof fundVotes.$inferSelect;

// ─── Diaspora Collectives Tables ──────────────────────────────────────────────
export const collectiveStatusEnum = pgEnum("collective_status", ["forming", "active", "investing", "completed", "dissolved"]);

export const diasporaCollectives = pgTable("diaspora_collectives", {
  id: serial("id").primaryKey(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  targetAmount: numeric("target_amount", { precision: 18, scale: 2 }),
  totalContributed: numeric("total_contributed", { precision: 18, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 10 }).default("USD"),
  memberCount: integer("member_count").default(1),
  maxMembers: integer("max_members").default(20),
  status: collectiveStatusEnum("status").default("forming"),
  investmentFocus: varchar("investment_focus", { length: 200 }),
  country: varchar("country", { length: 64 }),
  nextVoteDate: timestamp("next_vote_date"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type DiasporaCollective = typeof diasporaCollectives.$inferSelect;

export const diasporaCollectiveMembers = pgTable("diaspora_collective_members", {
  id: serial("id").primaryKey(),
  collectiveId: integer("collective_id").notNull().references(() => diasporaCollectives.id),
  userId: integer("user_id").notNull().references(() => users.id),
  role: varchar("role", { length: 20 }).default("member"), // "admin" | "member"
  myContribution: numeric("my_contribution", { precision: 18, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 10 }).default("USD"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});
export type DiasporaCollectiveMember = typeof diasporaCollectiveMembers.$inferSelect;

// ─── Investment Opportunities Table ───────────────────────────────────────────
export const investmentStageEnum = pgEnum("investment_stage", ["seed", "series_a", "series_b", "growth", "ipo_ready"]);
export const investmentStatusEnum = pgEnum("investment_status", ["open", "closing", "funded", "closed"]);

export const investmentOpportunities = pgTable("investment_opportunities", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  country: varchar("country", { length: 64 }).notNull(),
  sector: varchar("sector", { length: 100 }),
  stage: investmentStageEnum("stage").default("seed"),
  targetAmount: numeric("target_amount", { precision: 18, scale: 2 }).notNull(),
  raisedAmount: numeric("raised_amount", { precision: 18, scale: 2 }).default("0"),
  minInvestment: numeric("min_investment", { precision: 18, scale: 2 }).default("100"),
  currency: varchar("currency", { length: 10 }).default("USD"),
  dueDate: timestamp("due_date"),
  sdgAlignment: json("sdg_alignment").$type<number[]>().default([]),
  expectedReturn: numeric("expected_return", { precision: 5, scale: 2 }),
  riskLevel: varchar("risk_level", { length: 20 }).default("medium"),
  imageUrl: text("image_url"),
  status: investmentStatusEnum("status").default("open"),
  investorCount: integer("investor_count").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type InvestmentOpportunity = typeof investmentOpportunities.$inferSelect;

// ─── Market Ratings Table ─────────────────────────────────────────────────────
export const marketRatings = pgTable("market_ratings", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => marketOrders.id).unique(),
  raterId: integer("rater_id").notNull().references(() => users.id),
  ratedUserId: integer("rated_user_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(), // 1-5
  review: text("review"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MarketRating = typeof marketRatings.$inferSelect;

// ─── Family Dashboard Tables ──────────────────────────────────────────────────
export const familyRelationshipEnum = pgEnum("family_relationship", ["spouse", "parent", "child", "sibling", "grandparent", "grandchild", "uncle_aunt", "cousin", "other"]);

export const familyMembers = pgTable("family_members", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  relationship: familyRelationshipEnum("relationship").default("other"),
  country: varchar("country", { length: 64 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 200 }),
  bankAccount: varchar("bank_account", { length: 100 }),
  bankName: varchar("bank_name", { length: 200 }),
  currency: varchar("currency", { length: 10 }).default("NGN"),
  avatarUrl: text("avatar_url"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type FamilyMember = typeof familyMembers.$inferSelect;

export const familyBudgets = pgTable("family_budgets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  familyMemberId: integer("family_member_id").notNull().references(() => familyMembers.id),
  monthlyLimit: numeric("monthly_limit", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD"),
  currentMonthSpent: numeric("current_month_spent", { precision: 18, scale: 2 }).default("0"),
  alertThreshold: integer("alert_threshold").default(80), // % of budget
  autoRenew: boolean("auto_renew").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type FamilyBudget = typeof familyBudgets.$inferSelect;

// ─── Beyond Remittance Investment Module ──────────────────────────────────────
export const investmentAssetTypeEnum = pgEnum("investment_asset_type", [
  "stock", "etf", "commodity", "crypto", "mining_share", "real_estate", "bond", "index_fund"
]);
export const userInvestmentStatusEnum = pgEnum("user_investment_status", [
  "pending", "active", "sold", "cancelled", "matured"
]);
export const investmentAssets = pgTable("investment_assets", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  assetType: investmentAssetTypeEnum("asset_type").notNull(),
  exchange: varchar("exchange", { length: 50 }),
  country: varchar("country", { length: 64 }),
  sector: varchar("sector", { length: 100 }),
  currentPrice: numeric("current_price", { precision: 18, scale: 6 }).default("0"),
  currency: varchar("currency", { length: 10 }).default("USD"),
  priceChange24h: numeric("price_change_24h", { precision: 10, scale: 4 }).default("0"),
  priceChangePct24h: numeric("price_change_pct_24h", { precision: 10, scale: 4 }).default("0"),
  marketCap: numeric("market_cap", { precision: 24, scale: 2 }),
  volume24h: numeric("volume_24h", { precision: 24, scale: 2 }),
  description: text("description"),
  logoUrl: text("logo_url"),
  minInvestment: numeric("min_investment", { precision: 18, scale: 2 }).default("10"),
  isActive: boolean("is_active").default(true),
  isFeatured: boolean("is_featured").default(false),
  tags: json("tags").$type<string[]>().default([]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type InvestmentAsset = typeof investmentAssets.$inferSelect;

export const userInvestments = pgTable("user_investments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  assetId: integer("asset_id").notNull().references(() => investmentAssets.id),
  status: userInvestmentStatusEnum("status").default("active"),
  quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
  purchasePrice: numeric("purchase_price", { precision: 18, scale: 6 }).notNull(),
  currentValue: numeric("current_value", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 10 }).default("USD"),
  purchasedAt: timestamp("purchased_at").defaultNow().notNull(),
  soldAt: timestamp("sold_at"),
  soldPrice: numeric("sold_price", { precision: 18, scale: 6 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type UserInvestment = typeof userInvestments.$inferSelect;

export const investmentWatchlist = pgTable("investment_watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  assetId: integer("asset_id").notNull().references(() => investmentAssets.id),
  alertPrice: numeric("alert_price", { precision: 18, scale: 6 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type InvestmentWatchlistItem = typeof investmentWatchlist.$inferSelect;

export const investmentOrders = pgTable("investment_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  assetId: integer("asset_id").notNull().references(() => investmentAssets.id),
  orderType: varchar("order_type", { length: 10 }).default("buy"),
  quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
  priceAtOrder: numeric("price_at_order", { precision: 18, scale: 6 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD"),
  status: varchar("status", { length: 20 }).default("completed"),
  fee: numeric("fee", { precision: 10, scale: 4 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type InvestmentOrder = typeof investmentOrders.$inferSelect;

// ─── Investment Price History ─────────────────────────────────────────────────
export const investmentPriceHistory = pgTable("investment_price_history", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => investmentAssets.id),
  open: numeric("open", { precision: 18, scale: 6 }).notNull(),
  high: numeric("high", { precision: 18, scale: 6 }).notNull(),
  low: numeric("low", { precision: 18, scale: 6 }).notNull(),
  close: numeric("close", { precision: 18, scale: 6 }).notNull(),
  volume: numeric("volume", { precision: 24, scale: 2 }).default("0"),
  timestamp: timestamp("timestamp").notNull(),
  interval: varchar("interval", { length: 10 }).default("1d"),
});
export type InvestmentPriceHistory = typeof investmentPriceHistory.$inferSelect;

// ─── Multitenancy ─────────────────────────────────────────────────────────────
export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended", "trial", "churned"]);
export const tenantPlanEnum = pgEnum("tenant_plan", ["starter", "growth", "enterprise", "white_label"]);

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 63 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  plan: tenantPlanEnum("plan").default("starter").notNull(),
  status: tenantStatusEnum("status").default("trial").notNull(),
  ownerId: integer("owner_id").references(() => users.id),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: varchar("primary_color", { length: 7 }).default("#7c3aed"),
  secondaryColor: varchar("secondary_color", { length: 7 }).default("#06b6d4"),
  accentColor: varchar("accent_color", { length: 7 }).default("#f59e0b"),
  brandName: varchar("brand_name", { length: 255 }),
  supportEmail: varchar("support_email", { length: 255 }),
  supportUrl: text("support_url"),
  customDomain: varchar("custom_domain", { length: 255 }),
  defaultCurrency: varchar("default_currency", { length: 10 }).default("USD"),
  defaultLocale: varchar("default_locale", { length: 10 }).default("en"),
  allowedCountries: json("allowed_countries").$type<string[]>().default([]),
  maxUsers: integer("max_users").default(100),
  maxMonthlyVolume: numeric("max_monthly_volume", { precision: 18, scale: 2 }).default("50000"),
  metadata: json("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Tenant = typeof tenants.$inferSelect;

export const tenantUsers = pgTable("tenant_users", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).default("member").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});
export type TenantUser = typeof tenantUsers.$inferSelect;

// ─── Feature Flags ────────────────────────────────────────────────────────────
export const featureFlagScopeEnum = pgEnum("feature_flag_scope", ["global", "tenant", "user"]);

export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  scope: featureFlagScopeEnum("scope").default("global").notNull(),
  defaultEnabled: boolean("default_enabled").default(true).notNull(),
  rolloutPct: integer("rollout_pct").default(100).notNull(),
  requiredPlan: tenantPlanEnum("required_plan"),
  category: varchar("category", { length: 50 }).default("feature"),
  tags: json("tags").$type<string[]>().default([]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type FeatureFlag = typeof featureFlags.$inferSelect;

export const tenantFeatureFlags = pgTable("tenant_feature_flags", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  flagId: integer("flag_id").notNull().references(() => featureFlags.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(),
  overriddenBy: integer("overridden_by").references(() => users.id),
  reason: text("reason"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TenantFeatureFlag = typeof tenantFeatureFlags.$inferSelect;

export const userFeatureFlags = pgTable("user_feature_flags", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  flagId: integer("flag_id").notNull().references(() => featureFlags.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UserFeatureFlag = typeof userFeatureFlags.$inferSelect;

// ─── White-Label Onboarding Config ───────────────────────────────────────────
export const whiteLabelConfigs = pgTable("white_label_configs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  onboardingSteps: json("onboarding_steps").$type<Array<{
    id: string; label: string; required: boolean; order: number; enabled: boolean;
  }>>().default([]),
  navSections: json("nav_sections").$type<string[]>().default([]),
  termsUrl: text("terms_url"),
  privacyUrl: text("privacy_url"),
  welcomeEmailSubject: varchar("welcome_email_subject", { length: 255 }),
  welcomeEmailBody: text("welcome_email_body"),
  showPoweredBy: boolean("show_powered_by").default(true),
  allowSelfRegistration: boolean("allow_self_registration").default(true),
  requireInviteCode: boolean("require_invite_code").default(false),
  gaTrackingId: varchar("ga_tracking_id", { length: 50 }),
  intercomAppId: varchar("intercom_app_id", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type WhiteLabelConfig = typeof whiteLabelConfigs.$inferSelect;

// ─── Travel Rule Records ──────────────────────────────────────────────────────
export const travelRuleRecords = pgTable("travel_rule_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  transactionId: integer("transaction_id").references(() => transactions.id),
  direction: varchar("direction", { length: 10 }).notNull().default("outbound"),
  originatorName: varchar("originator_name", { length: 255 }).notNull(),
  originatorAccount: varchar("originator_account", { length: 100 }),
  originatorAddress: text("originator_address"),
  originatorCountry: varchar("originator_country", { length: 3 }),
  beneficiaryName: varchar("beneficiary_name", { length: 255 }).notNull(),
  beneficiaryAccount: varchar("beneficiary_account", { length: 100 }),
  beneficiaryAddress: text("beneficiary_address"),
  beneficiaryCountry: varchar("beneficiary_country", { length: 3 }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  vasp: varchar("vasp", { length: 255 }),
  vaspLei: varchar("vasp_lei", { length: 20 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  threshold: numeric("threshold", { precision: 18, scale: 2 }).default("1000"),
  reportedAt: timestamp("reported_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TravelRuleRecord = typeof travelRuleRecords.$inferSelect;

// ─── Partner Invite Codes ─────────────────────────────────────────────────────
export const partnerInviteCodes = pgTable("partner_invite_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  description: text("description"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  maxUses: integer("max_uses").default(1),
  usedCount: integer("used_count").default(0).notNull(),
  plan: varchar("plan", { length: 20 }).default("starter").notNull(),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").default(true).notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PartnerInviteCode = typeof partnerInviteCodes.$inferSelect;

// ─── Tenant Onboarding Sessions ───────────────────────────────────────────────
export const tenantOnboardingSessions = pgTable("tenant_onboarding_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: varchar("session_token", { length: 64 }).notNull().unique(),
  inviteCodeId: integer("invite_code_id").notNull().references(() => partnerInviteCodes.id),
  userId: integer("user_id").references(() => users.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  step: integer("step").default(1).notNull(),
  data: json("data").$type<Record<string, unknown>>().default({}),
  status: varchar("status", { length: 20 }).default("in_progress").notNull(),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TenantOnboardingSession = typeof tenantOnboardingSessions.$inferSelect;

// ─── Partner Payouts ──────────────────────────────────────────────────────────
export const payoutStatusEnum = pgEnum("payout_status", ["pending", "processing", "completed", "failed", "cancelled"]);
export const payoutMethodEnum = pgEnum("payout_method", ["bank_transfer", "crypto", "mobile_money", "paypal"]);

export const partnerPayouts = pgTable("partner_payouts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  method: payoutMethodEnum("method").default("bank_transfer").notNull(),
  status: payoutStatusEnum("status").default("pending").notNull(),
  reference: varchar("reference", { length: 64 }).unique(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  feeRevenue: numeric("fee_revenue", { precision: 18, scale: 6 }).default("0").notNull(),
  revenueShare: numeric("revenue_share", { precision: 5, scale: 4 }).default("0.3").notNull(),
  notes: text("notes"),
  processedAt: timestamp("processed_at"),
  processedBy: integer("processed_by").references(() => users.id),
  metadata: json("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type PartnerPayout = typeof partnerPayouts.$inferSelect;

// ─── Webhook Endpoints & Deliveries ──────────────────────────────────────────
export const webhookEventStatusEnum = pgEnum("webhook_event_status", ["pending", "delivered", "failed", "retrying"]);

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  userId: integer("user_id").references(() => users.id),
  url: text("url").notNull(),
  secret: varchar("secret", { length: 64 }).notNull(),
  events: json("events").$type<string[]>().default([]),
  isActive: boolean("is_active").default(true).notNull(),
  description: text("description"),
  lastDeliveredAt: timestamp("last_delivered_at"),
  failureCount: integer("failure_count").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  endpointId: integer("endpoint_id").notNull().references(() => webhookEndpoints.id),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: json("payload").$type<Record<string, unknown>>().default({}),
  status: webhookEventStatusEnum("status").default("pending").notNull(),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  attemptCount: integer("attempt_count").default(0).notNull(),
  nextRetryAt: timestamp("next_retry_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "revoked", "expired"]);

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  name: varchar("name", { length: 100 }).notNull(),
  keyHash: varchar("key_hash", { length: 128 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  scopes: json("scopes").$type<string[]>().default([]),
  status: apiKeyStatusEnum("status").default("active").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  ipAllowlist: json("ip_allowlist").$type<string[]>().default([]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ApiKey = typeof apiKeys.$inferSelect;

// ─── Payment Gateway Logs ─────────────────────────────────────────────────────
export const gatewayEnum = pgEnum("gateway", ["stripe", "paypal", "flutterwave", "bank_transfer", "mpesa", "mojaloop"]);
export const gatewayTxStatusEnum = pgEnum("gateway_tx_status", ["initiated", "pending", "success", "failed", "refunded", "disputed"]);

export const paymentGatewayLogs = pgTable("payment_gateway_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  gateway: gatewayEnum("gateway").notNull(),
  gatewayTxId: varchar("gateway_tx_id", { length: 128 }),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  status: gatewayTxStatusEnum("status").default("initiated").notNull(),
  direction: varchar("direction", { length: 10 }).default("credit").notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>().default({}),
  errorMessage: text("error_message"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type PaymentGatewayLog = typeof paymentGatewayLogs.$inferSelect;

// ─── Compliance Watchlist ─────────────────────────────────────────────────────
export const watchlistStatusEnum = pgEnum("watchlist_status", ["clear", "flagged", "blocked", "under_review"]);

export const complianceWatchlist = pgTable("compliance_watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  dateOfBirth: date("date_of_birth"),
  nationality: varchar("nationality", { length: 3 }),
  idNumber: varchar("id_number", { length: 50 }),
  status: watchlistStatusEnum("status").default("clear").notNull(),
  riskScore: integer("risk_score").default(0).notNull(),
  matchedLists: json("matched_lists").$type<string[]>().default([]),
  notes: text("notes"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ComplianceWatchlistEntry = typeof complianceWatchlist.$inferSelect;

// ─── FX Rate History ──────────────────────────────────────────────────────────
export const fxRateHistory = pgTable("fx_rate_history", {
  id: serial("id").primaryKey(),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
  source: varchar("source", { length: 50 }).default("api").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

// ─── System Config ────────────────────────────────────────────────────────────
export const systemConfig = pgTable("system_config", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  isSecret: boolean("is_secret").default(false).notNull(),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type SystemConfig = typeof systemConfig.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// DIASPORA INVESTMENT HUB — v74 (NGX Stocks + Real Estate + Startups + Gateways)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── NGX Stock Catalogue ──────────────────────────────────────────────────────
export const ngxStocks = pgTable("ngx_stocks", {
  id: serial("id").primaryKey(),
  ticker: varchar("ticker", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  sector: varchar("sector", { length: 100 }).notNull(),
  exchange: varchar("exchange", { length: 20 }).default("NGX").notNull(),
  currentPriceNgn: numeric("current_price_ngn", { precision: 18, scale: 4 }).notNull(),
  previousCloseNgn: numeric("previous_close_ngn", { precision: 18, scale: 4 }),
  changePercent: numeric("change_percent", { precision: 8, scale: 4 }),
  marketCapNgn: numeric("market_cap_ngn", { precision: 24, scale: 2 }),
  peRatio: numeric("pe_ratio", { precision: 10, scale: 2 }),
  dividendYield: numeric("dividend_yield", { precision: 8, scale: 4 }),
  week52High: numeric("week_52_high", { precision: 18, scale: 4 }),
  week52Low: numeric("week_52_low", { precision: 18, scale: 4 }),
  description: text("description"),
  logoUrl: text("logo_url"),
  isActive: boolean("is_active").default(true).notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type NgxStock = typeof ngxStocks.$inferSelect;

// ─── NGX Stock Watchlists ─────────────────────────────────────────────────────
export const stockWatchlists = pgTable("stock_watchlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  stockId: integer("stock_id").notNull().references(() => ngxStocks.id),
  alertPriceNgn: numeric("alert_price_ngn", { precision: 18, scale: 4 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type StockWatchlist = typeof stockWatchlists.$inferSelect;

// ─── NGX Stock Orders ─────────────────────────────────────────────────────────
export const ngxOrders = pgTable("ngx_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  stockId: integer("stock_id").notNull().references(() => ngxStocks.id),
  orderType: varchar("order_type", { length: 20 }).notNull(),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  quantityUnits: numeric("quantity_units", { precision: 18, scale: 6 }).notNull(),
  pricePerUnitNgn: numeric("price_per_unit_ngn", { precision: 18, scale: 4 }).notNull(),
  totalAmountNgn: numeric("total_amount_ngn", { precision: 24, scale: 2 }).notNull(),
  totalAmountUsd: numeric("total_amount_usd", { precision: 18, scale: 2 }),
  fxRateUsed: numeric("fx_rate_used", { precision: 18, scale: 6 }),
  brokerReference: varchar("broker_reference", { length: 100 }),
  brokerName: varchar("broker_name", { length: 100 }).default("Bamboo").notNull(),
  executedAt: timestamp("executed_at"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type NgxOrder = typeof ngxOrders.$inferSelect;

// ─── Real Estate Listings ─────────────────────────────────────────────────────
export const realEstateListings = pgTable("real_estate_listings", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description").notNull(),
  propertyType: varchar("property_type", { length: 50 }).notNull(),
  location: varchar("location", { length: 200 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 100 }).notNull(),
  totalValueNgn: numeric("total_value_ngn", { precision: 24, scale: 2 }).notNull(),
  totalValueUsd: numeric("total_value_usd", { precision: 18, scale: 2 }).notNull(),
  minimumInvestmentUsd: numeric("minimum_investment_usd", { precision: 18, scale: 2 }).notNull(),
  totalShares: integer("total_shares").notNull(),
  availableShares: integer("available_shares").notNull(),
  pricePerShareUsd: numeric("price_per_share_usd", { precision: 18, scale: 2 }).notNull(),
  expectedAnnualReturnPct: numeric("expected_annual_return_pct", { precision: 8, scale: 2 }),
  rentalYieldPct: numeric("rental_yield_pct", { precision: 8, scale: 2 }),
  appreciationPct: numeric("appreciation_pct", { precision: 8, scale: 2 }),
  tenureYears: integer("tenure_years"),
  status: varchar("status", { length: 30 }).default("open").notNull(),
  imageUrls: json("image_urls").$type<string[]>().default([]),
  documents: json("documents").$type<{name: string; url: string}[]>().default([]),
  developerName: varchar("developer_name", { length: 200 }),
  developerRating: numeric("developer_rating", { precision: 3, scale: 1 }),
  completionDate: timestamp("completion_date"),
  isVerified: boolean("is_verified").default(false).notNull(),
  isFeatured: boolean("is_featured").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type RealEstateListing = typeof realEstateListings.$inferSelect;

// ─── Real Estate Investments (Fractional Ownership) ──────────────────────────
export const realEstateInvestments = pgTable("real_estate_investments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  listingId: integer("listing_id").notNull().references(() => realEstateListings.id),
  sharesOwned: integer("shares_owned").notNull(),
  pricePerSharePaid: numeric("price_per_share_paid", { precision: 18, scale: 2 }).notNull(),
  totalInvestedUsd: numeric("total_invested_usd", { precision: 18, scale: 2 }).notNull(),
  ownershipPct: numeric("ownership_pct", { precision: 8, scale: 6 }).notNull(),
  status: varchar("status", { length: 30 }).default("active").notNull(),
  returnsPaidUsd: numeric("returns_paid_usd", { precision: 18, scale: 2 }).default("0"),
  lastReturnDate: timestamp("last_return_date"),
  investedAt: timestamp("invested_at").defaultNow().notNull(),
  exitedAt: timestamp("exited_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RealEstateInvestment = typeof realEstateInvestments.$inferSelect;

// ─── Startup Deals ────────────────────────────────────────────────────────────
export const startupDeals = pgTable("startup_deals", {
  id: serial("id").primaryKey(),
  companyName: varchar("company_name", { length: 200 }).notNull(),
  tagline: varchar("tagline", { length: 300 }).notNull(),
  description: text("description").notNull(),
  sector: varchar("sector", { length: 100 }).notNull(),
  stage: varchar("stage", { length: 50 }).notNull(),
  location: varchar("location", { length: 200 }).notNull(),
  foundedYear: integer("founded_year"),
  teamSize: integer("team_size"),
  targetRaiseUsd: numeric("target_raise_usd", { precision: 18, scale: 2 }).notNull(),
  raisedSoFarUsd: numeric("raised_so_far_usd", { precision: 18, scale: 2 }).default("0"),
  minimumTicketUsd: numeric("minimum_ticket_usd", { precision: 18, scale: 2 }).notNull(),
  valuationUsd: numeric("valuation_usd", { precision: 24, scale: 2 }),
  equityOfferedPct: numeric("equity_offered_pct", { precision: 8, scale: 4 }),
  instrumentType: varchar("instrument_type", { length: 50 }).default("SAFE").notNull(),
  status: varchar("status", { length: 30 }).default("open").notNull(),
  websiteUrl: text("website_url"),
  pitchDeckUrl: text("pitch_deck_url"),
  logoUrl: text("logo_url"),
  imageUrls: json("image_urls").$type<string[]>().default([]),
  highlights: json("highlights").$type<string[]>().default([]),
  risks: json("risks").$type<string[]>().default([]),
  metrics: json("metrics").$type<{label: string; value: string}[]>().default([]),
  closingDate: timestamp("closing_date"),
  isFeatured: boolean("is_featured").default(false).notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type StartupDeal = typeof startupDeals.$inferSelect;

// ─── Startup Investments ──────────────────────────────────────────────────────
export const startupInvestments = pgTable("startup_investments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  dealId: integer("deal_id").notNull().references(() => startupDeals.id),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  instrumentType: varchar("instrument_type", { length: 50 }).notNull(),
  equityPct: numeric("equity_pct", { precision: 10, scale: 6 }),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).default("wallet"),
  agreementSigned: boolean("agreement_signed").default(false).notNull(),
  agreementUrl: text("agreement_url"),
  notes: text("notes"),
  investedAt: timestamp("invested_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
  exitedAt: timestamp("exited_at"),
  exitValueUsd: numeric("exit_value_usd", { precision: 18, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type StartupInvestment = typeof startupInvestments.$inferSelect;

// ─── PayPal Transactions ──────────────────────────────────────────────────────
export const paypalTransactions = pgTable("paypal_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  paypalOrderId: varchar("paypal_order_id", { length: 100 }).notNull().unique(),
  paypalCaptureId: varchar("paypal_capture_id", { length: 100 }),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  status: varchar("status", { length: 30 }).default("created").notNull(),
  walletCredited: boolean("wallet_credited").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type PaypalTransaction = typeof paypalTransactions.$inferSelect;

// ─── Flutterwave Transactions ─────────────────────────────────────────────────
export const flutterwaveTransactions = pgTable("flutterwave_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  flwRef: varchar("flw_ref", { length: 100 }).notNull().unique(),
  txRef: varchar("tx_ref", { length: 100 }).notNull().unique(),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  paymentLink: text("payment_link"),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  walletCredited: boolean("wallet_credited").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type FlutterwaveTransaction = typeof flutterwaveTransactions.$inferSelect;

// ─── Corridor Margin History ──────────────────────────────────────────────────
export const corridorMarginHistory = pgTable("corridor_margin_history", {
  id: serial("id").primaryKey(),
  corridorId: varchar("corridor_id", { length: 50 }).notNull(),
  corridorName: varchar("corridor_name", { length: 100 }).notNull(),
  changeType: varchar("change_type", { length: 30 }).notNull(),
  oldValue: varchar("old_value", { length: 100 }),
  newValue: varchar("new_value", { length: 100 }).notNull(),
  changedBy: integer("changed_by").notNull().references(() => users.id),
  changedByName: varchar("changed_by_name", { length: 100 }),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CorridorMarginHistory = typeof corridorMarginHistory.$inferSelect;

// ─── Push Subscriptions (VAPID Web Push) ─────────────────────────────────────
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: varchar("device_name", { length: 100 }).default("Browser"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
});
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// ─── API Key Usage Logs ───────────────────────────────────────────────────────
export const apiKeyUsageLogs = pgTable("api_key_usage_logs", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  endpoint: varchar("endpoint", { length: 200 }).notNull(),
  method: varchar("method", { length: 10 }).default("POST").notNull(),
  statusCode: integer("status_code").default(200).notNull(),
  latencyMs: integer("latency_ms").default(0).notNull(),
  ipAddress: varchar("ip_address", { length: 50 }),
  environment: varchar("environment", { length: 10 }).default("live").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ApiKeyUsageLog = typeof apiKeyUsageLogs.$inferSelect;

// ─── Stripe Receipts ──────────────────────────────────────────────────────────
export const stripeReceipts = pgTable("stripe_receipts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  stripeSessionId: varchar("stripe_session_id", { length: 200 }).notNull().unique(),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 200 }),
  amountTotal: integer("amount_total").notNull(),
  currency: varchar("currency", { length: 10 }).default("usd").notNull(),
  status: varchar("status", { length: 30 }).default("paid").notNull(),
  productName: varchar("product_name", { length: 200 }),
  receiptUrl: text("receipt_url"),
  metadata: text("metadata"),
  paidAt: timestamp("paid_at").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type StripeReceipt = typeof stripeReceipts.$inferSelect;

// ─── FX Alert Trigger History ─────────────────────────────────────────────────
export const fxAlertTriggerHistory = pgTable("fx_alert_trigger_history", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  targetRate: numeric("target_rate", { precision: 18, scale: 6 }).notNull(),
  triggeredRate: numeric("triggered_rate", { precision: 18, scale: 6 }).notNull(),
  direction: varchar("direction", { length: 10 }).default("above").notNull(),
  notificationSent: boolean("notification_sent").default(false).notNull(),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
});
export type FxAlertTriggerHistory = typeof fxAlertTriggerHistory.$inferSelect;

// ─── Treasury Positions ───────────────────────────────────────────────────────
export const treasuryPositions = pgTable("treasury_positions", {
  id: serial("id").primaryKey(),
  currency: varchar("currency", { length: 10 }).notNull(),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull(),
  lockedBalance: numeric("locked_balance", { precision: 18, scale: 2 }).default("0"),
  availableBalance: numeric("available_balance", { precision: 18, scale: 2 }).notNull(),
  usdEquivalent: numeric("usd_equivalent", { precision: 18, scale: 2 }),
  provider: varchar("provider", { length: 100 }),
  accountRef: varchar("account_ref", { length: 200 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TreasuryPosition = typeof treasuryPositions.$inferSelect;

// ─── SLA Incidents ────────────────────────────────────────────────────────────
export const slaIncidents = pgTable("sla_incidents", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("medium").notNull(),
  status: varchar("status", { length: 20 }).default("open").notNull(),
  affectedService: varchar("affected_service", { length: 100 }),
  rootCause: text("root_cause"),
  resolution: text("resolution"),
  reportedBy: integer("reported_by").references(() => users.id),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SlaIncident = typeof slaIncidents.$inferSelect;

// ─── Chargeback Cases ─────────────────────────────────────────────────────────
export const chargebackCases = pgTable("chargeback_cases", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  transactionId: integer("transaction_id"),
  stripeChargeId: varchar("stripe_charge_id", { length: 200 }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  reason: varchar("reason", { length: 100 }).notNull(),
  status: varchar("status", { length: 30 }).default("open").notNull(),
  evidenceUrl: text("evidence_url"),
  notes: text("notes"),
  dueDate: timestamp("due_date"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ChargebackCase = typeof chargebackCases.$inferSelect;

// ─── Smart Routing Decisions ──────────────────────────────────────────────────
export const smartRoutingDecisions = pgTable("smart_routing_decisions", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id"),
  userId: integer("user_id").notNull().references(() => users.id),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  selectedProvider: varchar("selected_provider", { length: 100 }).notNull(),
  estimatedFee: numeric("estimated_fee", { precision: 18, scale: 2 }),
  estimatedTimeSeconds: integer("estimated_time_seconds"),
  score: numeric("score", { precision: 5, scale: 2 }),
  decisionFactors: text("decision_factors"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SmartRoutingDecision = typeof smartRoutingDecisions.$inferSelect;

// ─── Compliance Reports ───────────────────────────────────────────────────────
export const complianceReports = pgTable("compliance_reports", {
  id: serial("id").primaryKey(),
  reportType: varchar("report_type", { length: 50 }).notNull(),
  reportPeriod: varchar("report_period", { length: 30 }).notNull(),
  generatedBy: integer("generated_by").notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  fileUrl: text("file_url"),
  summary: text("summary"),
  totalTransactions: integer("total_transactions").default(0),
  totalVolume: numeric("total_volume", { precision: 18, scale: 2 }),
  flaggedTransactions: integer("flagged_transactions").default(0),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ComplianceReport = typeof complianceReports.$inferSelect;

// ─── Developer Sandbox Sessions ───────────────────────────────────────────────
export const developerSandboxSessions = pgTable("developer_sandbox_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  sessionKey: varchar("session_key", { length: 100 }).notNull().unique(),
  environment: varchar("environment", { length: 20 }).default("sandbox").notNull(),
  testApiKey: varchar("test_api_key", { length: 100 }),
  requestCount: integer("request_count").default(0).notNull(),
  lastRequestAt: timestamp("last_request_at"),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DeveloperSandboxSession = typeof developerSandboxSessions.$inferSelect;

// ─── Sandbox Scenarios (Developer Sandbox save/load) ──────────────────────────
export const sandboxScenarios = pgTable("sandbox_scenarios", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  scenarioType: varchar("scenario_type", { length: 50 }).default("transfer").notNull(),
  payload: text("payload").notNull(),
  tags: text("tags"),
  isPublic: boolean("is_public").default(false).notNull(),
  runCount: integer("run_count").default(0).notNull(),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type SandboxScenario = typeof sandboxScenarios.$inferSelect;

// ─── Compliance Alerts ────────────────────────────────────────────────────────
export const complianceAlerts = pgTable("compliance_alerts", {
  id: serial("id").primaryKey(),
  alertType: varchar("alert_type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("medium").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  relatedUserId: integer("related_user_id").references(() => users.id),
  relatedTransactionId: integer("related_transaction_id"),
  status: varchar("status", { length: 20 }).default("open").notNull(),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  assignedTo: integer("assigned_to").references(() => users.id),
  assignedAt: timestamp("assigned_at"),
  sarSubmittedAt: timestamp("sar_submitted_at"),
  sarReference: varchar("sar_reference", { length: 64 }),
  sarDeadline: timestamp("sar_deadline"),
  snoozeUntil: timestamp("snooze_until"),
  mlroNotes: text("mlro_notes"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ComplianceAlert = typeof complianceAlerts.$inferSelect;

// ─── Compliance Alert Notes ───────────────────────────────────────────────────
export const complianceAlertNotes = pgTable("compliance_alert_notes", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").references(() => complianceAlerts.id, { onDelete: "cascade" }).notNull(),
  authorId: integer("author_id").references(() => users.id).notNull(),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ComplianceAlertNote = typeof complianceAlertNotes.$inferSelect;

// ─── Security Events Log ──────────────────────────────────────────────────────
export const securityEvents = pgTable("security_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("info").notNull(),
  ipAddress: varchar("ip_address", { length: 50 }),
  userAgent: text("user_agent"),
  location: varchar("location", { length: 100 }),
  details: text("details"),
  resolved: boolean("resolved").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SecurityEvent = typeof securityEvents.$inferSelect;

// ─── MFA Settings ─────────────────────────────────────────────────────────────
export const mfaSettings = pgTable("mfa_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  totpSecret: varchar("totp_secret", { length: 100 }),
  totpEnabled: boolean("totp_enabled").default(false).notNull(),
  backupCodes: text("backup_codes"),
  enrolledAt: timestamp("enrolled_at"),
  lastUsedAt: timestamp("last_used_at"),
  failedAttempts: integer("failed_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MfaSetting = typeof mfaSettings.$inferSelect;

// ─── Transfer Audit Trail ─────────────────────────────────────────────────────
export const transferAuditTrail = pgTable("transfer_audit_trail", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  fromStatus: varchar("from_status", { length: 30 }),
  toStatus: varchar("to_status", { length: 30 }).notNull(),
  triggeredBy: varchar("triggered_by", { length: 50 }).notNull(),
  reason: text("reason"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TransferAuditTrailEntry = typeof transferAuditTrail.$inferSelect;

// ─── Fee Rules (tiered fee engine) ────────────────────────────────────────────
export const feeRules = pgTable("fee_rules", {
  id: serial("id").primaryKey(),
  corridor: varchar("corridor", { length: 20 }).notNull(),
  minAmount: numeric("min_amount", { precision: 18, scale: 2 }).default("0").notNull(),
  maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
  feeType: varchar("fee_type", { length: 20 }).default("percentage").notNull(),
  feePercentage: numeric("fee_percentage", { precision: 5, scale: 4 }).default("0"),
  feeFixed: numeric("fee_fixed", { precision: 18, scale: 2 }).default("0"),
  minFee: numeric("min_fee", { precision: 18, scale: 2 }).default("0"),
  maxFee: numeric("max_fee", { precision: 18, scale: 2 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type FeeRule = typeof feeRules.$inferSelect;

// ─── Promo Codes (admin-defined discount codes for transaction fees) ───────────
export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),
  discountType: varchar("discount_type", { length: 20 }).default("percentage").notNull(), // percentage | fixed
  discountValue: numeric("discount_value", { precision: 10, scale: 4 }).notNull(),
  minTransferAmount: numeric("min_transfer_amount", { precision: 18, scale: 2 }).default("0"),
  maxDiscountAmount: numeric("max_discount_amount", { precision: 18, scale: 2 }),
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").default(0).notNull(),
  perUserLimit: integer("per_user_limit").default(1),
  validFrom: timestamp("valid_from").defaultNow().notNull(),
  validUntil: timestamp("valid_until"),
  corridors: text("corridors"), // JSON array of corridor codes, null = all
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PromoCode = typeof promoCodes.$inferSelect;

// ─── Promo Code Redemptions ────────────────────────────────────────────────────
export const promoRedemptions = pgTable("promo_redemptions", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promo_code_id").references(() => promoCodes.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  transactionId: integer("transaction_id").references(() => transactions.id),
  discountApplied: numeric("discount_applied", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
});
export type PromoRedemption = typeof promoRedemptions.$inferSelect;

// ─── Daily Volume Snapshots (for dashboard widget) ────────────────────────────
export const dailyVolumeSnapshots = pgTable("daily_volume_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(), // YYYY-MM-DD
  totalTransactions: integer("total_transactions").default(0).notNull(),
  totalVolumeUsd: numeric("total_volume_usd", { precision: 18, scale: 2 }).default("0").notNull(),
  totalFeesUsd: numeric("total_fees_usd", { precision: 18, scale: 2 }).default("0").notNull(),
  uniqueSenders: integer("unique_senders").default(0).notNull(),
  topCorridor: varchar("top_corridor", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DailyVolumeSnapshot = typeof dailyVolumeSnapshots.$inferSelect;

// ─── User Notification Preferences (v86 extended) ────────────────────────────
export const userNotifPrefs = pgTable("user_notif_prefs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  emailTransactions: boolean("email_transactions").default(true).notNull(),
  emailMarketing: boolean("email_marketing").default(false).notNull(),
  emailSecurity: boolean("email_security").default(true).notNull(),
  pushTransactions: boolean("push_transactions").default(true).notNull(),
  pushMarketing: boolean("push_marketing").default(false).notNull(),
  smsTransactions: boolean("sms_transactions").default(false).notNull(),
  fxAlertEnabled: boolean("fx_alert_enabled").default(false).notNull(),
  fxAlertThreshold: numeric("fx_alert_threshold", { precision: 10, scale: 4 }),
  fxAlertCurrency: varchar("fx_alert_currency", { length: 10 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type UserNotifPref = typeof userNotifPrefs.$inferSelect;

// ─── Scheduled Transfers ──────────────────────────────────────────────────────
export const scheduledTransfers = pgTable("scheduled_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  beneficiaryId: integer("beneficiary_id").references(() => beneficiaries.id),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  frequency: varchar("frequency", { length: 20 }).notNull(), // once | daily | weekly | monthly
  nextRunAt: timestamp("next_run_at").notNull(),
  lastRunAt: timestamp("last_run_at"),
  runCount: integer("run_count").default(0).notNull(),
  maxRuns: integer("max_runs"),
  status: varchar("status", { length: 20 }).default("active").notNull(), // active | paused | completed | cancelled
  description: text("description"),
  promoCode: varchar("promo_code", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ScheduledTransfer = typeof scheduledTransfers.$inferSelect;

// ─── Exchange Rate Alerts ─────────────────────────────────────────────────────
export const exchangeRateAlerts = pgTable("exchange_rate_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  targetRate: numeric("target_rate", { precision: 18, scale: 6 }).notNull(),
  direction: varchar("direction", { length: 10 }).default("above").notNull(), // above | below
  isActive: boolean("is_active").default(true).notNull(),
  triggeredAt: timestamp("triggered_at"),
  notificationSent: boolean("notification_sent").default(false).notNull(),
  snoozeUntil: timestamp("snooze_until"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ExchangeRateAlert = typeof exchangeRateAlerts.$inferSelect;

// ─── v89: Data Pipeline Run Tracking ─────────────────────────────────────────
export const pipelineRunStatusEnum = pgEnum("pipeline_run_status", ["pending", "running", "success", "failed", "cancelled"]);

export const nifiPipelineRuns = pgTable("nifi_pipeline_runs", {
  id: serial("id").primaryKey(),
  pipelineId: varchar("pipeline_id", { length: 100 }).notNull(),
  pipelineName: varchar("pipeline_name", { length: 255 }),
  status: pipelineRunStatusEnum("status").default("pending").notNull(),
  triggeredBy: integer("triggered_by").references(() => users.id),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  recordsProcessed: integer("records_processed").default(0),
  errorMessage: text("error_message"),
  metadata: json("metadata"),
});
export type NifiPipelineRun = typeof nifiPipelineRuns.$inferSelect;

export const dbtRunHistory = pgTable("dbt_run_history", {
  id: serial("id").primaryKey(),
  runId: varchar("run_id", { length: 100 }),
  modelSelect: varchar("model_select", { length: 255 }),
  status: pipelineRunStatusEnum("status").default("pending").notNull(),
  triggeredBy: integer("triggered_by").references(() => users.id),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  modelsRun: integer("models_run").default(0),
  modelsError: integer("models_error").default(0),
  errorMessage: text("error_message"),
  results: json("results"),
});
export type DbtRunHistory = typeof dbtRunHistory.$inferSelect;

export const airflowDagRuns = pgTable("airflow_dag_runs", {
  id: serial("id").primaryKey(),
  dagId: varchar("dag_id", { length: 100 }).notNull(),
  runId: varchar("run_id", { length: 100 }),
  status: pipelineRunStatusEnum("status").default("pending").notNull(),
  triggeredBy: integer("triggered_by").references(() => users.id),
  conf: json("conf"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
});
export type AirflowDagRun = typeof airflowDagRuns.$inferSelect;

// ─── v89: Tenant White-Label Configuration ────────────────────────────────────
export const tenantConfigs = pgTable("tenant_configs", {
  id: serial("id").primaryKey(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull().unique(),
  tenantName: varchar("tenant_name", { length: 255 }).notNull(),
  primaryColor: varchar("primary_color", { length: 20 }).default("#6366f1"),
  secondaryColor: varchar("secondary_color", { length: 20 }).default("#8b5cf6"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  customDomain: varchar("custom_domain", { length: 255 }),
  supportEmail: varchar("support_email", { length: 255 }),
  supportPhone: varchar("support_phone", { length: 50 }),
  defaultCurrency: varchar("default_currency", { length: 10 }).default("USD"),
  allowedCurrencies: json("allowed_currencies"),
  maxTransferLimit: numeric("max_transfer_limit", { precision: 18, scale: 2 }).default("50000"),
  kycRequired: boolean("kyc_required").default(true),
  mfaRequired: boolean("mfa_required").default(false),
  webhookUrl: text("webhook_url"),
  webhookSecret: varchar("webhook_secret", { length: 255 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TenantConfig = typeof tenantConfigs.$inferSelect;

// ─── v90 Tables ───────────────────────────────────────────────────────────────
export const disputePriorityEnum = pgEnum("dispute_priority", ["low", "medium", "high", "critical"]);
export const sanctionsCheckResultEnum = pgEnum("sanctions_check_result", ["clear", "hit", "pending_review"]);
export const bulkPaymentBatchStatusEnum = pgEnum("bulk_payment_batch_status", ["pending", "processing", "completed", "failed", "cancelled"]);
export const openBankingConsentStatusEnum = pgEnum("open_banking_consent_status", ["awaiting_authorisation", "authorised", "rejected", "revoked", "expired"]);
export const regulatoryReportTypeEnum = pgEnum("regulatory_report_type", ["CTR", "SAR", "FBAR", "ANNUAL_AML"]);
export const regulatoryReportStatusEnum = pgEnum("regulatory_report_status", ["pending", "generating", "ready", "filed", "failed"]);

export const sanctionsChecks = pgTable("sanctions_checks", {
  id: serial("id").primaryKey(),
  screeningId: text("screening_id").notNull().unique(),
  userId: integer("user_id").references(() => users.id),
  entityName: text("entity_name").notNull(),
  entityType: text("entity_type").notNull().default("individual"),
  result: sanctionsCheckResultEnum("result").notNull().default("clear"),
  riskLevel: text("risk_level").notNull().default("low"),
  listsChecked: text("lists_checked").array(),
  matchDetails: text("match_details"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const bulkPaymentBatches = pgTable("bulk_payment_batches", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  totalPayments: integer("total_payments").notNull().default(0),
  completed: integer("completed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  pending: integer("pending").notNull().default(0),
  status: bulkPaymentBatchStatusEnum("status").notNull().default("pending"),
  currency: text("currency").notNull().default("USD"),
  totalAmount: integer("total_amount").notNull().default(0),
  successRate: integer("success_rate").notNull().default(0),
  estimatedCompletionAt: timestamp("estimated_completion_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const openBankingConsents = pgTable("open_banking_consents", {
  id: serial("id").primaryKey(),
  consentId: text("consent_id").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  bankId: text("bank_id").notNull(),
  bankName: text("bank_name").notNull(),
  status: openBankingConsentStatusEnum("status").notNull().default("awaiting_authorisation"),
  permissions: text("permissions").array(),
  expiresAt: timestamp("expires_at"),
  authorisedAt: timestamp("authorised_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const regulatoryReports = pgTable("regulatory_reports", {
  id: serial("id").primaryKey(),
  reportId: text("report_id").notNull().unique(),
  reportType: regulatoryReportTypeEnum("report_type").notNull(),
  status: regulatoryReportStatusEnum("status").notNull().default("pending"),
  format: text("format").notNull().default("pdf"),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  generatedBy: integer("generated_by").references(() => users.id),
  downloadUrl: text("download_url"),
  filedAt: timestamp("filed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const fraudModelRuns = pgTable("fraud_model_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  modelName: text("model_name").notNull(),
  modelVersion: text("model_version").notNull(),
  triggeredBy: text("triggered_by").notNull().default("airflow"),
  status: text("status").notNull().default("running"),
  accuracy: integer("accuracy"),
  f1Score: integer("f1_score"),
  aucRoc: integer("auc_roc"),
  trainingRecords: integer("training_records"),
  validationRecords: integer("validation_records"),
  durationSeconds: integer("duration_seconds"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── v91: Partner Application & Approval Workflow ────────────────────────────
export const partnerApplicationStatusEnum = pgEnum("partner_application_status", [
  "draft",
  "submitted",
  "under_review",
  "additional_info_required",
  "approved",
  "rejected",
  "suspended",
]);

export const partnerApplicationTypeEnum = pgEnum("partner_application_type", [
  "fintech_startup",
  "bank",
  "mfi",
  "ngo",
  "telecom",
  "aggregator",
  "enterprise",
  "other",
]);

export const partnerApplications = pgTable("partner_applications", {
  id: serial("id").primaryKey(),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  brandName: varchar("brand_name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 63 }).notNull().unique(),
  applicationType: partnerApplicationTypeEnum("application_type").default("fintech_startup").notNull(),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  contactEmail: varchar("contact_email", { length: 255 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 30 }),
  website: text("website"),
  country: varchar("country", { length: 3 }).notNull(),
  registrationNumber: varchar("registration_number", { length: 100 }),
  taxId: varchar("tax_id", { length: 100 }),
  incorporationDate: varchar("incorporation_date", { length: 20 }),
  businessDescription: text("business_description"),
  expectedMonthlyVolume: numeric("expected_monthly_volume", { precision: 18, scale: 2 }),
  expectedUserCount: integer("expected_user_count"),
  targetCorridors: json("target_corridors").$type<string[]>().default([]),
  requestedPlan: varchar("requested_plan", { length: 30 }).default("starter").notNull(),
  hasAmlPolicy: boolean("has_aml_policy").default(false),
  hasKycProcess: boolean("has_kyc_process").default(false),
  isRegulated: boolean("is_regulated").default(false),
  regulatoryLicenses: json("regulatory_licenses").$type<string[]>().default([]),
  businessRegDocUrl: text("business_reg_doc_url"),
  amlPolicyDocUrl: text("aml_policy_doc_url"),
  directorIdDocUrl: text("director_id_doc_url"),
  bankStatementDocUrl: text("bank_statement_doc_url"),
  primaryColor: varchar("primary_color", { length: 7 }).default("#7c3aed"),
  secondaryColor: varchar("secondary_color", { length: 7 }).default("#06b6d4"),
  logoUrl: text("logo_url"),
  status: partnerApplicationStatusEnum("status").default("draft").notNull(),
  submittedAt: timestamp("submitted_at"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  rejectionReason: text("rejection_reason"),
  additionalInfoRequest: text("additional_info_request"),
  additionalInfoProvidedAt: timestamp("additional_info_provided_at"),
  approvedAt: timestamp("approved_at"),
  tenantId: integer("tenant_id").references(() => tenants.id),
  slaSignedAt: timestamp("sla_signed_at"),
  slaVersion: varchar("sla_version", { length: 20 }).default("v1.0"),
  inviteCodeId: integer("invite_code_id").references(() => partnerInviteCodes.id),
  submittedByUserId: integer("submitted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PartnerApplication = typeof partnerApplications.$inferSelect;

export const partnerApplicationComments = pgTable("partner_application_comments", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => partnerApplications.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id),
  comment: text("comment").notNull(),
  isInternal: boolean("is_internal").default(true).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type PartnerApplicationComment = typeof partnerApplicationComments.$inferSelect;

export const partnerApiKeyStatusEnum = pgEnum("partner_api_key_status", ["active", "revoked", "expired"]);
export const partnerApiKeyEnvEnum = pgEnum("partner_api_key_env", ["sandbox", "production"]);

export const partnerApiKeys = pgTable("partner_api_keys", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull(),
  environment: partnerApiKeyEnvEnum("environment").default("sandbox").notNull(),
  status: partnerApiKeyStatusEnum("status").default("active").notNull(),
  permissions: json("permissions").$type<string[]>().default([]),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  revokedBy: integer("revoked_by").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  requestCount: integer("request_count").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type PartnerApiKey = typeof partnerApiKeys.$inferSelect;

export const partnerWebhooks = pgTable("partner_webhooks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  events: json("events").$type<string[]>().default([]),
  signingSecret: varchar("signing_secret", { length: 128 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastDeliveredAt: timestamp("last_delivered_at"),
  failureCount: integer("failure_count").default(0),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PartnerWebhook = typeof partnerWebhooks.$inferSelect;

export const userOnboardingStatusEnum = pgEnum("user_onboarding_status", [
  "not_started",
  "in_progress",
  "completed",
  "skipped",
]);

export const userOnboardingProgress = pgTable("user_onboarding_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  status: userOnboardingStatusEnum("status").default("not_started").notNull(),
  profileCompleted: boolean("profile_completed").default(false),
  bankLinked: boolean("bank_linked").default(false),
  kycStarted: boolean("kyc_started").default(false),
  kycCompleted: boolean("kyc_completed").default(false),
  firstTransferMade: boolean("first_transfer_made").default(false),
  notificationsEnabled: boolean("notifications_enabled").default(false),
  profileCompletedAt: timestamp("profile_completed_at"),
  bankLinkedAt: timestamp("bank_linked_at"),
  kycStartedAt: timestamp("kyc_started_at"),
  kycCompletedAt: timestamp("kyc_completed_at"),
  firstTransferAt: timestamp("first_transfer_at"),
  completedAt: timestamp("completed_at"),
  skippedAt: timestamp("skipped_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type UserOnboardingProgress = typeof userOnboardingProgress.$inferSelect;

export const complianceEmailConfig = pgTable("compliance_email_config", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  officerName: varchar("officer_name", { length: 255 }).notNull(),
  officerEmail: varchar("officer_email", { length: 255 }).notNull(),
  reportTypes: json("report_types").$type<string[]>().default(["CTR", "SAR", "FBAR"]),
  isActive: boolean("is_active").default(true).notNull(),
  smtpHost: varchar("smtp_host", { length: 255 }).default("smtp.sendgrid.net"),
  smtpPort: integer("smtp_port").default(587),
  smtpUser: varchar("smtp_user", { length: 255 }),
  smtpPasswordEncrypted: text("smtp_password_encrypted"),
  fromEmail: varchar("from_email", { length: 255 }).default("compliance@remitflow.com"),
  fromName: varchar("from_name", { length: 100 }).default("RemitFlow Compliance"),
  frequency: varchar("frequency", { length: 32 }).default("immediate"),
  includeAttachment: boolean("include_attachment").default(true),
  encryptAttachment: boolean("encrypt_attachment").default(false),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ComplianceEmailConfig = typeof complianceEmailConfig.$inferSelect;

// ============================================================
// v94 — A/B Testing Framework
// ============================================================
export const abExperimentStatusEnum = pgEnum("ab_experiment_status", ["draft", "running", "paused", "completed"]);
export const abExperiments = pgTable("ab_experiments", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  status: abExperimentStatusEnum("status").default("draft").notNull(),
  variants: json("variants").$type<Array<{ id: string; name: string; weight: number; description?: string }>>().default([]),
  targetPage: varchar("target_page", { length: 200 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type AbExperiment = typeof abExperiments.$inferSelect;

export const abAssignments = pgTable("ab_assignments", {
  id: serial("id").primaryKey(),
  experimentId: integer("experiment_id").notNull().references(() => abExperiments.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id),
  sessionId: varchar("session_id", { length: 128 }),
  variantId: varchar("variant_id", { length: 64 }).notNull(),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
});
export type AbAssignment = typeof abAssignments.$inferSelect;

export const abEventTypeEnum = pgEnum("ab_event_type", ["impression", "click", "conversion", "signup", "transfer"]);
export const abEvents = pgTable("ab_events", {
  id: serial("id").primaryKey(),
  experimentId: integer("experiment_id").notNull().references(() => abExperiments.id, { onDelete: "cascade" }),
  assignmentId: integer("assignment_id").references(() => abAssignments.id),
  variantId: varchar("variant_id", { length: 64 }).notNull(),
  eventType: abEventTypeEnum("event_type").notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type AbEvent = typeof abEvents.$inferSelect;

// ============================================================
// v94 — Referral Bonuses
// ============================================================
export const referralBonusStatusEnum = pgEnum("referral_bonus_status", ["pending", "approved", "paid", "expired", "rejected"]);
export const referralBonuses = pgTable("referral_bonuses", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull().references(() => users.id),
  referredId: integer("referred_id").notNull().references(() => users.id),
  referralCode: varchar("referral_code", { length: 32 }).notNull(),
  referrerBonus: decimal("referrer_bonus", { precision: 18, scale: 2 }).default("0"),
  referredBonus: decimal("referred_bonus", { precision: 18, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 10 }).default("USD"),
  status: referralBonusStatusEnum("status").default("pending").notNull(),
  triggerEvent: varchar("trigger_event", { length: 100 }).default("first_transfer"),
  paidAt: timestamp("paid_at"),
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ReferralBonus = typeof referralBonuses.$inferSelect;

// ============================================================
// v94 — Document Vault
// ============================================================
export const documentVaultCategoryEnum = pgEnum("document_vault_category", [
  "identity", "address", "financial", "compliance", "contract", "other"
]);
export const documentVaultStatusEnum = pgEnum("document_vault_status", ["active", "expired", "archived", "shared"]);
export const documentVaultTable = pgTable("document_vault", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: documentVaultCategoryEnum("category").default("other").notNull(),
  status: documentVaultStatusEnum("status").default("active").notNull(),
  fileUrl: text("file_url").notNull(),
  fileKey: varchar("file_key", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: integer("file_size"),
  isEncrypted: boolean("is_encrypted").default(false),
  expiresAt: timestamp("expires_at"),
  sharedWith: json("shared_with").$type<Array<{ userId: number; email: string; accessLevel: string; sharedAt: string }>>().default([]),
  tags: json("tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DocumentVaultEntry = typeof documentVaultTable.$inferSelect;

// ============================================================
// v94 — Rate Alert History
// ============================================================
export const rateAlertHistoryStatusEnum = pgEnum("rate_alert_history_status", ["triggered", "snoozed", "dismissed"]);
export const rateAlertHistory = pgTable("rate_alert_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  targetRate: decimal("target_rate", { precision: 18, scale: 6 }).notNull(),
  actualRate: decimal("actual_rate", { precision: 18, scale: 6 }).notNull(),
  direction: varchar("direction", { length: 10 }).default("above"),
  status: rateAlertHistoryStatusEnum("status").default("triggered").notNull(),
  notificationSent: boolean("notification_sent").default(false),
  snoozedUntil: timestamp("snoozed_until"),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type RateAlertHistory = typeof rateAlertHistory.$inferSelect;

// ============================================================
// Document Vault — Expiry Reminder System
// ============================================================

/** Per-user preferences for which reminder thresholds and channels to use */
export const docReminderPrefs = pgTable("doc_reminder_prefs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  remind30d: boolean("remind_30d").default(true).notNull(),
  remind14d: boolean("remind_14d").default(true).notNull(),
  remind7d:  boolean("remind_7d").default(true).notNull(),
  remind3d:  boolean("remind_3d").default(true).notNull(),
  remind1d:  boolean("remind_1d").default(true).notNull(),
  notifyEmail:  boolean("notify_email").default(true).notNull(),
  notifyInApp:  boolean("notify_in_app").default(true).notNull(),
  notifyPush:   boolean("notify_push").default(false).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DocReminderPrefs = typeof docReminderPrefs.$inferSelect;

/** Audit log of every reminder sent — used for deduplication */
export const docReminderLog = pgTable("doc_reminder_log", {
  id: serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentId: integer("document_id").notNull().references(() => documentVaultTable.id, { onDelete: "cascade" }),
  reminderType: varchar("reminder_type", { length: 10 }).notNull(),
  channel:    varchar("channel", { length: 20 }).notNull(),
  status:     varchar("status", { length: 20 }).default("sent").notNull(),
  sentAt:     timestamp("sent_at").notNull().defaultNow(),
});
export type DocReminderLog = typeof docReminderLog.$inferSelect;

// ============================================================
// v97 — Velocity Check Rules & Overrides
// ============================================================
export const velocityWindowEnum = pgEnum("velocity_window", ["1h", "6h", "24h", "7d", "30d"]);
export const velocityActionEnum = pgEnum("velocity_action", ["block", "flag", "require_2fa", "notify_admin"]);

export const velocityRules = pgTable("velocity_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  window: velocityWindowEnum("window").default("24h").notNull(),
  maxCount: integer("max_count"),
  maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 10 }).default("USD"),
  action: velocityActionEnum("action").default("flag").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  appliesTo: varchar("applies_to", { length: 20 }).default("all"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type VelocityRule = typeof velocityRules.$inferSelect;

export const velocityOverrides = pgTable("velocity_overrides", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => velocityRules.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at"),
  grantedBy: integer("granted_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type VelocityOverride = typeof velocityOverrides.$inferSelect;

export const velocityWhitelist = pgTable("velocity_whitelist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  addedBy: integer("added_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type VelocityWhitelist = typeof velocityWhitelist.$inferSelect;

// ============================================================
// v97 — KYC Lifecycle State Machine
// ============================================================
export const kycStageEnum = pgEnum("kyc_stage", [
  "not_started", "documents_submitted", "under_review", "additional_info_required",
  "approved", "rejected", "expired", "suspended"
]);

export const kycLifecycle = pgTable("kyc_lifecycle", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stage: kycStageEnum("stage").default("not_started").notNull(),
  tier: integer("tier").default(1).notNull(),
  submittedAt: timestamp("submitted_at"),
  reviewStartedAt: timestamp("review_started_at"),
  reviewedAt: timestamp("reviewed_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  expiresAt: timestamp("expires_at"),
  rejectionReason: text("rejection_reason"),
  additionalInfoRequired: text("additional_info_required"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  riskScore: integer("risk_score").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type KycLifecycle = typeof kycLifecycle.$inferSelect;

export const kycLifecycleHistory = pgTable("kyc_lifecycle_history", {
  id: serial("id").primaryKey(),
  lifecycleId: integer("lifecycle_id").notNull().references(() => kycLifecycle.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  fromStage: kycStageEnum("from_stage").notNull(),
  toStage: kycStageEnum("to_stage").notNull(),
  changedBy: integer("changed_by").references(() => users.id),
  reason: text("reason"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type KycLifecycleHistory = typeof kycLifecycleHistory.$inferSelect;

// ============================================================
// v97 — Document Vault Renewals
// ============================================================
export const documentRenewals = pgTable("document_renewals", {
  id: serial("id").primaryKey(),
  originalDocId: integer("original_doc_id").notNull().references(() => documentVaultTable.id),
  newDocId: integer("new_doc_id").references(() => documentVaultTable.id),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  initiatedAt: timestamp("initiated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
});
export type DocumentRenewal = typeof documentRenewals.$inferSelect;

// ============================================================
// v97 — Webhook Retry Queue
// ============================================================
export const webhookRetryQueue = pgTable("webhook_retry_queue", {
  id: serial("id").primaryKey(),
  deliveryId: integer("delivery_id").notNull().references(() => webhookDeliveries.id, { onDelete: "cascade" }),
  endpointId: integer("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  payload: json("payload").notNull(),
  attemptNumber: integer("attempt_number").default(1).notNull(),
  maxAttempts: integer("max_attempts").default(5).notNull(),
  nextAttemptAt: timestamp("next_attempt_at").notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  lastError: text("last_error"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type WebhookRetryQueueEntry = typeof webhookRetryQueue.$inferSelect;

// ============================================================
// v97 — API Key Rotation Log
// ============================================================
export const apiKeyRotationLog = pgTable("api_key_rotation_log", {
  id: serial("id").primaryKey(),
  oldKeyId: integer("old_key_id").notNull(),
  newKeyId: integer("new_key_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  reason: varchar("reason", { length: 200 }),
  rotatedAt: timestamp("rotated_at").notNull().defaultNow(),
});
export type ApiKeyRotationLog = typeof apiKeyRotationLog.$inferSelect;

// ============================================================
// v97 — Batch Payment Items (line-item tracking)
// ============================================================
export const batchPaymentItems = pgTable("batch_payment_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchPayments.id, { onDelete: "cascade" }),
  recipientName: varchar("recipient_name", { length: 200 }).notNull(),
  recipientAccount: varchar("recipient_account", { length: 100 }),
  recipientBank: varchar("recipient_bank", { length: 100 }),
  recipientCountry: varchar("recipient_country", { length: 10 }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  transactionId: integer("transaction_id").references(() => transactions.id),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type BatchPaymentItem = typeof batchPaymentItems.$inferSelect;

// ============================================================
// v97 — System Config Audit Log
// ============================================================
export const systemConfigAuditLog = pgTable("system_config_audit_log", {
  id: serial("id").primaryKey(),
  configKey: varchar("config_key", { length: 100 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedBy: integer("changed_by").references(() => users.id),
  changeReason: text("change_reason"),
  reloadTriggered: boolean("reload_triggered").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SystemConfigAuditLog = typeof systemConfigAuditLog.$inferSelect;

// ============================================================
// v98 — Kafka Consumer Metrics
// ============================================================
export const kafkaConsumerMetrics = pgTable("kafka_consumer_metrics", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 200 }).notNull(),
  groupId: varchar("group_id", { length: 100 }).notNull(),
  partition: integer("partition").default(0).notNull(),
  currentOffset: bigint("current_offset", { mode: "number" }).default(0).notNull(),
  logEndOffset: bigint("log_end_offset", { mode: "number" }).default(0).notNull(),
  lag: bigint("lag", { mode: "number" }).default(0).notNull(),
  messagesConsumed: bigint("messages_consumed", { mode: "number" }).default(0).notNull(),
  messagesPerSecond: numeric("messages_per_second", { precision: 10, scale: 2 }).default("0"),
  lastConsumedAt: timestamp("last_consumed_at"),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  errorMessage: text("error_message"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});
export type KafkaConsumerMetric = typeof kafkaConsumerMetrics.$inferSelect;

// ============================================================
// v98 — Transaction Export History
// ============================================================
export const transactionExports = pgTable("transaction_exports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  format: varchar("format", { length: 10 }).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  filters: jsonb("filters"),
  recordCount: integer("record_count").default(0),
  fileUrl: text("file_url"),
  fileSize: integer("file_size"),
  expiresAt: timestamp("expires_at"),
  errorMessage: text("error_message"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
export type TransactionExport = typeof transactionExports.$inferSelect;

// ============================================================
// v98 — IP Login History
// ============================================================
export const ipLoginHistory = pgTable("ip_login_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  userAgent: text("user_agent"),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  isSuccess: boolean("is_success").default(true).notNull(),
  isSuspicious: boolean("is_suspicious").default(false).notNull(),
  suspiciousReason: varchar("suspicious_reason", { length: 200 }),
  deviceFingerprint: varchar("device_fingerprint", { length: 200 }),
  loginAt: timestamp("login_at").notNull().defaultNow(),
});
export type IpLoginHistory = typeof ipLoginHistory.$inferSelect;

// ============================================================
// v98 — CBDC Mint/Burn Ledger
// ============================================================
export const cbdcMintBurnLog = pgTable("cbdc_mint_burn_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  currency: varchar("currency", { length: 20 }).notNull(),
  operation: varchar("operation", { length: 10 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 18, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }).notNull(),
  authorizedBy: integer("authorized_by").references(() => users.id),
  transactionRef: varchar("transaction_ref", { length: 100 }),
  reason: text("reason"),
  status: varchar("status", { length: 20 }).default("completed").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CbdcMintBurnLog = typeof cbdcMintBurnLog.$inferSelect;

// ============================================================
// v98 — Community Activity Feed
// ============================================================
export const communityActivityFeed = pgTable("community_activity_feed", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  actorName: varchar("actor_name", { length: 200 }).notNull(),
  actorAvatar: text("actor_avatar"),
  activityType: varchar("activity_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  country: varchar("country", { length: 100 }),
  sdgGoal: integer("sdg_goal"),
  isPublic: boolean("is_public").default(true).notNull(),
  likesCount: integer("likes_count").default(0).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CommunityActivityFeedItem = typeof communityActivityFeed.$inferSelect;

// ============================================================
// v98 — Compliance CTR Auto-Flag
// ============================================================
export const ctrAutoFlags = pgTable("ctr_auto_flags", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").notNull().references(() => transactions.id),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }),
  flagReason: varchar("flag_reason", { length: 200 }).notNull(),
  reportType: varchar("report_type", { length: 20 }).default("CTR").notNull(),
  status: varchar("status", { length: 30 }).default("pending_review").notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  filedAt: timestamp("filed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CtrAutoFlag = typeof ctrAutoFlags.$inferSelect;

// ============================================================
// v98 — Mojaloop FSP Registry
// ============================================================
export const mojaloopFsps = pgTable("mojaloop_fsps", {
  id: serial("id").primaryKey(),
  fspId: varchar("fsp_id", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  country: varchar("country", { length: 10 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  endpoint: text("endpoint").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  supportedSchemes: jsonb("supported_schemes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type MojaloopFsp = typeof mojaloopFsps.$inferSelect;

// ============================================================
// v98 — Bulk User Actions Log
// ============================================================
export const bulkUserActionLog = pgTable("bulk_user_action_log", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => users.id),
  action: varchar("action", { length: 50 }).notNull(),
  targetUserIds: jsonb("target_user_ids").notNull(),
  affectedCount: integer("affected_count").default(0).notNull(),
  status: varchar("status", { length: 20 }).default("completed").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type BulkUserActionLog = typeof bulkUserActionLog.$inferSelect;

// ============================================================
// v98 — Stripe Webhook Retry Log
// ============================================================
export const stripeWebhookRetryLog = pgTable("stripe_webhook_retry_log", {
  id: serial("id").primaryKey(),
  stripeEventId: varchar("stripe_event_id", { length: 200 }).notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  payload: jsonb("payload"),
  attemptCount: integer("attempt_count").default(1).notNull(),
  lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
  nextRetryAt: timestamp("next_retry_at"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  errorMessage: text("error_message"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type StripeWebhookRetryLog = typeof stripeWebhookRetryLog.$inferSelect;

// ============================================================
// v108 — Revenue Share System
// ============================================================
export const revShareModelEnum = pgEnum("rev_share_model", ["percentage", "flat_fee", "tiered", "hybrid"]);
export const revShareStatusEnum = pgEnum("rev_share_status", ["draft", "active", "suspended", "terminated"]);
export const revShareLedgerTypeEnum = pgEnum("rev_share_ledger_type", ["credit", "debit", "adjustment", "reversal"]);

export const revenueShareAgreements = pgTable("revenue_share_agreements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  model: revShareModelEnum("model").default("percentage").notNull(),
  status: revShareStatusEnum("status").default("draft").notNull(),
  baseRate: numeric("base_rate", { precision: 7, scale: 6 }).default("0.300000").notNull(),
  flatFeeAmount: numeric("flat_fee_amount", { precision: 18, scale: 6 }).default("0"),
  flatFeeCurrency: varchar("flat_fee_currency", { length: 10 }).default("USD"),
  minPayoutThreshold: numeric("min_payout_threshold", { precision: 18, scale: 2 }).default("50.00"),
  payoutCurrency: varchar("payout_currency", { length: 10 }).default("USD"),
  payoutMethod: payoutMethodEnum("payout_method").default("bank_transfer"),
  payoutFrequency: varchar("payout_frequency", { length: 20 }).default("monthly"),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  bankName: varchar("bank_name", { length: 255 }),
  bankAccountNumber: varchar("bank_account_number", { length: 64 }),
  bankRoutingNumber: varchar("bank_routing_number", { length: 64 }),
  bankSwiftCode: varchar("bank_swift_code", { length: 20 }),
  bankIban: varchar("bank_iban", { length: 64 }),
  paypalEmail: varchar("paypal_email", { length: 255 }),
  notes: text("notes"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdBy: integer("created_by").references(() => users.id),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type RevenueShareAgreement = typeof revenueShareAgreements.$inferSelect;

export const revenueShareTiers = pgTable("revenue_share_tiers", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull().references(() => revenueShareAgreements.id, { onDelete: "cascade" }),
  tierName: varchar("tier_name", { length: 100 }).notNull(),
  minMonthlyVolume: numeric("min_monthly_volume", { precision: 18, scale: 2 }).notNull(),
  maxMonthlyVolume: numeric("max_monthly_volume", { precision: 18, scale: 2 }),
  rate: numeric("rate", { precision: 7, scale: 6 }).notNull(),
  bonusRate: numeric("bonus_rate", { precision: 7, scale: 6 }).default("0"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type RevenueShareTier = typeof revenueShareTiers.$inferSelect;

export const revenueShareLedger = pgTable("revenue_share_ledger", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull().references(() => revenueShareAgreements.id),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  type: revShareLedgerTypeEnum("type").notNull(),
  transactionId: integer("transaction_id").references(() => transactions.id),
  grossFeeRevenue: numeric("gross_fee_revenue", { precision: 18, scale: 6 }).notNull(),
  appliedRate: numeric("applied_rate", { precision: 7, scale: 6 }).notNull(),
  partnerShare: numeric("partner_share", { precision: 18, scale: 6 }).notNull(),
  platformShare: numeric("platform_share", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  periodMonth: integer("period_month").notNull(),
  periodYear: integer("period_year").notNull(),
  payoutId: integer("payout_id").references(() => partnerPayouts.id),
  description: text("description"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type RevenueShareLedgerEntry = typeof revenueShareLedger.$inferSelect;

export const revenueShareReports = pgTable("revenue_share_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  agreementId: integer("agreement_id").notNull().references(() => revenueShareAgreements.id),
  periodMonth: integer("period_month").notNull(),
  periodYear: integer("period_year").notNull(),
  totalTransactions: integer("total_transactions").default(0).notNull(),
  totalVolume: numeric("total_volume", { precision: 18, scale: 2 }).default("0").notNull(),
  totalFeeRevenue: numeric("total_fee_revenue", { precision: 18, scale: 6 }).default("0").notNull(),
  partnerEarnings: numeric("partner_earnings", { precision: 18, scale: 6 }).default("0").notNull(),
  platformEarnings: numeric("platform_earnings", { precision: 18, scale: 6 }).default("0").notNull(),
  appliedTierId: integer("applied_tier_id").references(() => revenueShareTiers.id),
  appliedRate: numeric("applied_rate", { precision: 7, scale: 6 }).notNull(),
  payoutId: integer("payout_id").references(() => partnerPayouts.id),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
});
export type RevenueShareReport = typeof revenueShareReports.$inferSelect;

// ============================================================
// v108 — Enhanced Live Chat (Human Handoff)
// ============================================================
export const chatSessionStatusEnum = pgEnum("chat_session_status", ["bot", "queued", "active", "resolved", "abandoned"]);
export const chatPriorityEnum = pgEnum("chat_priority", ["low", "normal", "high", "urgent"]);
export const chatChannelEnum = pgEnum("chat_channel", ["web", "mobile", "api", "whatsapp", "telegram"]);

export const chatSessionMeta = pgTable("chat_session_meta", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().unique().references(() => chatSessions.id, { onDelete: "cascade" }),
  status: chatSessionStatusEnum("status").default("bot").notNull(),
  priority: chatPriorityEnum("priority").default("normal").notNull(),
  channel: chatChannelEnum("channel").default("web").notNull(),
  assignedAgentId: integer("assigned_agent_id").references(() => users.id),
  queuePosition: integer("queue_position"),
  waitTimeSeconds: integer("wait_time_seconds"),
  firstResponseAt: timestamp("first_response_at"),
  resolvedAt: timestamp("resolved_at"),
  satisfactionScore: integer("satisfaction_score"),
  satisfactionComment: text("satisfaction_comment"),
  tags: jsonb("tags").$type<string[]>().default([]),
  internalNotes: text("internal_notes"),
  escalatedAt: timestamp("escalated_at"),
  escalatedReason: text("escalated_reason"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ChatSessionMeta = typeof chatSessionMeta.$inferSelect;

export const chatAgentStatus = pgTable("chat_agent_status", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().unique().references(() => users.id),
  isOnline: boolean("is_online").default(false).notNull(),
  isAvailable: boolean("is_available").default(true).notNull(),
  maxConcurrentChats: integer("max_concurrent_chats").default(5).notNull(),
  activeChatCount: integer("active_chat_count").default(0).notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  statusMessage: varchar("status_message", { length: 255 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ChatAgentStatus = typeof chatAgentStatus.$inferSelect;

export const chatCannedResponses = pgTable("chat_canned_responses", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  shortcut: varchar("shortcut", { length: 50 }).notNull().unique(),
  content: text("content").notNull(),
  category: varchar("category", { length: 50 }).default("general"),
  usageCount: integer("usage_count").default(0).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ChatCannedResponse = typeof chatCannedResponses.$inferSelect;

// ============================================================
// v109 — Digital Revenue Share Agreement System
// ============================================================
export const agreementStatusEnum = pgEnum("agreement_status", ["draft", "sent", "viewed", "digitally_signed", "physically_signed", "fully_executed", "expired", "terminated"]);
export const signatureMethodEnum = pgEnum("signature_method", ["digital_checkbox", "drawn", "typed", "uploaded"]);

export const agreementTemplates = pgTable("agreement_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  version: varchar("version", { length: 20 }).default("1.0").notNull(),
  type: varchar("type", { length: 50 }).default("revenue_share").notNull(),
  content: text("content").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type AgreementTemplate = typeof agreementTemplates.$inferSelect;

export const partnerDigitalAgreements = pgTable("partner_digital_agreements", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull().references(() => revenueShareAgreements.id, { onDelete: "cascade" }),
  templateId: integer("template_id").references(() => agreementTemplates.id),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  status: agreementStatusEnum("status").default("draft").notNull(),
  agreementText: text("agreement_text").notNull(),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  digitallySignedAt: timestamp("digitally_signed_at"),
  physicallySignedAt: timestamp("physically_signed_at"),
  fullyExecutedAt: timestamp("fully_executed_at"),
  expiresAt: timestamp("expires_at"),
  partnerName: varchar("partner_name", { length: 255 }).notNull(),
  partnerEmail: varchar("partner_email", { length: 255 }).notNull(),
  partnerTitle: varchar("partner_title", { length: 100 }),
  partnerCompany: varchar("partner_company", { length: 255 }),
  partnerIpAddress: varchar("partner_ip_address", { length: 45 }),
  partnerUserAgent: text("partner_user_agent"),
  platformSignedBy: integer("platform_signed_by").references(() => users.id),
  platformSignedAt: timestamp("platform_signed_at"),
  signedDocumentUrl: text("signed_document_url"),
  signedDocumentKey: text("signed_document_key"),
  physicalDocumentUrl: text("physical_document_url"),
  physicalDocumentKey: text("physical_document_key"),
  auditTrail: jsonb("audit_trail").$type<Array<{event: string; timestamp: string; ipAddress?: string; userId?: number; details?: string}>>().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PartnerDigitalAgreement = typeof partnerDigitalAgreements.$inferSelect;

export const agreementSignatures = pgTable("agreement_signatures", {
  id: serial("id").primaryKey(),
  agreementDocId: integer("agreement_doc_id").notNull().references(() => partnerDigitalAgreements.id, { onDelete: "cascade" }),
  signerType: varchar("signer_type", { length: 20 }).default("partner").notNull(),
  signerUserId: integer("signer_user_id").references(() => users.id),
  signerName: varchar("signer_name", { length: 255 }).notNull(),
  signerEmail: varchar("signer_email", { length: 255 }).notNull(),
  signerTitle: varchar("signer_title", { length: 100 }),
  method: signatureMethodEnum("method").default("digital_checkbox").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  checkboxConfirmed: boolean("checkbox_confirmed").default(false).notNull(),
  signatureData: text("signature_data"),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
  isValid: boolean("is_valid").default(true).notNull(),
  verificationHash: varchar("verification_hash", { length: 128 }),
});
export type AgreementSignature = typeof agreementSignatures.$inferSelect;

// ─── Cron Jobs ────────────────────────────────────────────────────────────────
export const cronJobStatusEnum = pgEnum("cron_job_status", ["active", "paused", "error", "running"]);
export const cronJobs = pgTable("cron_jobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  schedule: varchar("schedule", { length: 100 }).notNull(),
  status: cronJobStatusEnum("status").default("active").notNull(),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: varchar("last_run_status", { length: 20 }),
  lastRunDurationMs: integer("last_run_duration_ms"),
  lastRunError: text("last_run_error"),
  nextRunAt: timestamp("next_run_at"),
  runCount: integer("run_count").default(0).notNull(),
  errorCount: integer("error_count").default(0).notNull(),
  category: varchar("category", { length: 50 }).default("general").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type CronJob = typeof cronJobs.$inferSelect;

// ─── API Changelog ────────────────────────────────────────────────────────────
export const apiChangelogs = pgTable("api_changelogs", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 20 }).notNull(),
  releaseDate: timestamp("release_date").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // major, minor, patch, security
  summary: text("summary").notNull(),
  breakingChanges: text("breaking_changes"),
  newEndpoints: text("new_endpoints"), // JSON array
  deprecatedEndpoints: text("deprecated_endpoints"), // JSON array
  bugFixes: text("bug_fixes"), // JSON array
  isPublished: boolean("is_published").default(true).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ApiChangelog = typeof apiChangelogs.$inferSelect;

// ─── Security Incidents ───────────────────────────────────────────────────────
export const securityIncidents = pgTable("security_incidents", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull(), // sqli, xss, csrf, brute_force, rate_limit
  severity: varchar("severity", { length: 20 }).notNull(), // low, medium, high, critical
  sourceIp: varchar("source_ip", { length: 45 }),
  userId: integer("user_id").references(() => users.id),
  endpoint: varchar("endpoint", { length: 255 }),
  payload: text("payload"),
  blocked: boolean("blocked").default(true).notNull(),
  responseCode: integer("response_code"),
  details: text("details"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SecurityIncident = typeof securityIncidents.$inferSelect;

// ─── Payment Requests (Request Money) ────────────────────────────────────────
export const paymentRequests = pgTable("payment_requests", {
  id: serial("id").primaryKey(),
  requesterId: integer("requester_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  description: text("description"),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  payerUserId: integer("payer_user_id").references(() => users.id),
  payerEmail: varchar("payer_email", { length: 255 }),
  transactionId: integer("transaction_id").references(() => transactions.id),
  expiresAt: timestamp("expires_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PaymentRequest = typeof paymentRequests.$inferSelect;


// ============================================================
// Split Bill Tables (v117)
// ============================================================
export const splitBillGroups = pgTable("split_bill_groups", {
  id: serial("id").primaryKey(),
  groupId: varchar("group_id", { length: 64 }).notNull().unique(),
  creatorId: integer("creator_id").notNull().references(() => users.id),
  title: varchar("title", { length: 200 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  note: text("note"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SplitBillGroup = typeof splitBillGroups.$inferSelect;

export const splitBillParticipants = pgTable("split_bill_participants", {
  id: serial("id").primaryKey(),
  groupId: varchar("group_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 255 }),
  shareAmount: numeric("share_amount", { precision: 18, scale: 2 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SplitBillParticipant = typeof splitBillParticipants.$inferSelect;

// Rate Locks Table (v117)

// ─── Push Notification Preferences ───────────────────────────────────────────
export const pushNotificationPreferences = pgTable("push_notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  preferenceKey: varchar("preference_key", { length: 100 }).notNull(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PushNotificationPreference = typeof pushNotificationPreferences.$inferSelect;

// ─── User Lockouts Table (v148) ───────────────────────────────────────────────
export const userLockouts = pgTable("user_lockouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedAt: timestamp("locked_at"),
  lockExpiresAt: timestamp("lock_expires_at"),
  lastFailedAt: timestamp("last_failed_at"),
  unlockedAt: timestamp("unlocked_at"),
  unlockedByAdminId: integer("unlocked_by_admin_id"),
  notificationSentAt: timestamp("notification_sent_at"),
  unlockToken: text("unlock_token"),
  unlockTokenExpiresAt: timestamp("unlock_token_expires_at"),
  unlockRequestedAt: timestamp("unlock_requested_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type UserLockout = typeof userLockouts.$inferSelect;

// ─── v171 Payment Rails ───────────────────────────────────────────────────────
// New rails: BRICSPay, mBridge, GhIPSS, AfriCBDC, PAPSS
// All tables follow the same pattern as mojaloopTransfers for consistency.

export const paymentRailEnum = pgEnum("payment_rail", [
  "mojaloop", "cips", "upi", "pix", "swift", "sepa", "ach",
  "bricspay", "mbridge", "ghipss", "africbdc", "papss",
]);

// ─── BRICSPay Transfers ───────────────────────────────────────────────────────
export const bricspayTransfers = pgTable("bricspay_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  transferId: varchar("transfer_id", { length: 100 }).notNull().unique(),
  dcmsMessageId: varchar("dcms_message_id", { length: 100 }),
  senderCountry: varchar("sender_country", { length: 3 }).notNull(),
  receiverCountry: varchar("receiver_country", { length: 3 }).notNull(),
  sendAmount: numeric("send_amount", { precision: 18, scale: 6 }).notNull(),
  sendCurrency: varchar("send_currency", { length: 10 }).notNull(),
  receiveCurrency: varchar("receive_currency", { length: 10 }).notNull(),
  receiveAmount: numeric("receive_amount", { precision: 18, scale: 6 }),
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
  senderVpa: varchar("sender_vpa", { length: 200 }),
  receiverVpa: varchar("receiver_vpa", { length: 200 }).notNull(),
  senderName: varchar("sender_name", { length: 200 }),
  receiverName: varchar("receiver_name", { length: 200 }),
  purpose: varchar("purpose", { length: 50 }),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  mojaloopRouted: boolean("mojaloop_routed").default(false),
  errorMessage: text("error_message"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type BRICSPayTransfer = typeof bricspayTransfers.$inferSelect;

// ─── mBridge CBDC Transfers ───────────────────────────────────────────────────
export const mbridgeTransfers = pgTable("mbridge_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  transferId: varchar("transfer_id", { length: 100 }).notNull().unique(),
  dltTxHash: varchar("dlt_tx_hash", { length: 100 }),
  senderCountry: varchar("sender_country", { length: 3 }).notNull(),
  receiverCountry: varchar("receiver_country", { length: 3 }).notNull(),
  sendAmount: numeric("send_amount", { precision: 18, scale: 6 }).notNull(),
  sendCbdc: varchar("send_cbdc", { length: 20 }).notNull(),
  receiveCbdc: varchar("receive_cbdc", { length: 20 }).notNull(),
  receiveAmount: numeric("receive_amount", { precision: 18, scale: 6 }),
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
  senderCbdcAddress: varchar("sender_cbdc_address", { length: 200 }),
  receiverCbdcAddress: varchar("receiver_cbdc_address", { length: 200 }).notNull(),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  mojaloopRouted: boolean("mojaloop_routed").default(false),
  settlementTimeMs: integer("settlement_time_ms"),
  errorMessage: text("error_message"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type MBridgeTransfer = typeof mbridgeTransfers.$inferSelect;

// ─── GhIPSS Transfers ────────────────────────────────────────────────────────
export const ghipssTransfers = pgTable("ghipss_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  transferId: varchar("transfer_id", { length: 100 }).notNull().unique(),
  ghipssRef: varchar("ghipss_ref", { length: 100 }),
  transferType: varchar("transfer_type", { length: 20 }).notNull(),
  sendAmount: numeric("send_amount", { precision: 18, scale: 6 }).notNull(),
  sendCurrency: varchar("send_currency", { length: 10 }).notNull(),
  receiveCurrency: varchar("receive_currency", { length: 10 }),
  receiveAmount: numeric("receive_amount", { precision: 18, scale: 6 }),
  senderAccount: varchar("sender_account", { length: 200 }).notNull(),
  receiverAccount: varchar("receiver_account", { length: 200 }).notNull(),
  receiverBank: varchar("receiver_bank", { length: 50 }),
  receiverMsisdn: varchar("receiver_msisdn", { length: 20 }),
  senderName: varchar("sender_name", { length: 200 }),
  receiverName: varchar("receiver_name", { length: 200 }),
  narration: varchar("narration", { length: 500 }),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  mojaloopRouted: boolean("mojaloop_routed").default(false),
  papssRouted: boolean("papss_routed").default(false),
  errorMessage: text("error_message"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type GhIPSSTransfer = typeof ghipssTransfers.$inferSelect;

// ─── African CBDC Transfers ───────────────────────────────────────────────────
export const africbdcTransfers = pgTable("africbdc_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  transferId: varchar("transfer_id", { length: 100 }).notNull().unique(),
  cbdcRef: varchar("cbdc_ref", { length: 100 }),
  cbdcType: varchar("cbdc_type", { length: 20 }).notNull(),
  sendAmount: numeric("send_amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  country: varchar("country", { length: 3 }).notNull(),
  senderWallet: varchar("sender_wallet", { length: 200 }).notNull(),
  receiverWallet: varchar("receiver_wallet", { length: 200 }).notNull(),
  senderName: varchar("sender_name", { length: 200 }),
  receiverName: varchar("receiver_name", { length: 200 }),
  purpose: varchar("purpose", { length: 100 }),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  mojaloopRouted: boolean("mojaloop_routed").default(false),
  cbdcStatus: varchar("cbdc_status", { length: 20 }),
  errorMessage: text("error_message"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type AfriCBDCTransfer = typeof africbdcTransfers.$inferSelect;

// ─── PAPSS Transfers ──────────────────────────────────────────────────────────
export const papssTransfers = pgTable("papss_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  transferId: varchar("transfer_id", { length: 100 }).notNull().unique(),
  papssRef: varchar("papss_ref", { length: 100 }),
  senderCountry: varchar("sender_country", { length: 3 }).notNull(),
  receiverCountry: varchar("receiver_country", { length: 3 }).notNull(),
  sendAmount: numeric("send_amount", { precision: 18, scale: 6 }).notNull(),
  sendCurrency: varchar("send_currency", { length: 10 }).notNull(),
  receiveCurrency: varchar("receive_currency", { length: 10 }).notNull(),
  receiveAmount: numeric("receive_amount", { precision: 18, scale: 6 }),
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
  senderAccount: varchar("sender_account", { length: 200 }).notNull(),
  receiverAccount: varchar("receiver_account", { length: 200 }).notNull(),
  senderBankCode: varchar("sender_bank_code", { length: 20 }),
  receiverBankCode: varchar("receiver_bank_code", { length: 20 }),
  senderName: varchar("sender_name", { length: 200 }),
  receiverName: varchar("receiver_name", { length: 200 }),
  narration: varchar("narration", { length: 500 }),
  corridor: varchar("corridor", { length: 10 }),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  mojaloopRouted: boolean("mojaloop_routed").default(false),
  ghipssRouted: boolean("ghipss_routed").default(false),
  nettingBatchId: varchar("netting_batch_id", { length: 100 }),
  settledAt: timestamp("settled_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PAPSSTransfer = typeof papssTransfers.$inferSelect;

// ─── Rail Health Status ───────────────────────────────────────────────────────
export const railHealthStatus = pgTable("rail_health_status", {
  id: serial("id").primaryKey(),
  rail: paymentRailEnum("rail").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("unknown"),
  latencyMs: integer("latency_ms"),
  lastCheckedAt: timestamp("last_checked_at").notNull().defaultNow(),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});
export type RailHealthStatus = typeof railHealthStatus.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// CBN COMPLIANCE TABLES — v187 (CBN Circular March 24 2026)
// ═══════════════════════════════════════════════════════════════════════════════

export const fundingSourceTypeEnum = pgEnum("funding_source_type", [
  "remittance_inflow",
  "nfem_fx_conversion",
  "internal_transfer",
  "stripe_topup",
  "crypto_conversion",
  "agent_cash",
  "other",
]);

export const settlementAccountStatusEnum = pgEnum("settlement_account_status", [
  "active",
  "pending_cbn_filing",
  "filed",
  "suspended",
  "closed",
]);

export const bdcPartnerStatusEnum = pgEnum("bdc_partner_status", [
  "pending_review",
  "approved",
  "suspended",
  "rejected",
]);

export const settlementAccounts = pgTable("settlement_accounts", {
  id: serial("id").primaryKey(),
  corridor: varchar("corridor", { length: 20 }).notNull(),
  adbName: varchar("adb_name", { length: 200 }).notNull(),
  adbCode: varchar("adb_code", { length: 20 }),
  accountNumber: varchar("account_number", { length: 50 }).notNull(),
  accountName: varchar("account_name", { length: 200 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("NGN"),
  status: settlementAccountStatusEnum("status").notNull().default("pending_cbn_filing"),
  isPrimary: boolean("is_primary").notNull().default(false),
  cbnFiledAt: timestamp("cbn_filed_at"),
  cbnReferenceNumber: varchar("cbn_reference_number", { length: 100 }),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SettlementAccount = typeof settlementAccounts.$inferSelect;
export type InsertSettlementAccount = typeof settlementAccounts.$inferInsert;

export const bmatchRateSnapshots = pgTable("bmatch_rate_snapshots", {
  id: serial("id").primaryKey(),
  pair: varchar("pair", { length: 20 }).notNull(),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  midRate: varchar("mid_rate", { length: 30 }).notNull(),
  bidRate: varchar("bid_rate", { length: 30 }),
  askRate: varchar("ask_rate", { length: 30 }),
  spreadBps: varchar("spread_bps", { length: 20 }),
  platformRate: varchar("platform_rate", { length: 30 }),
  platformSpreadBps: varchar("platform_spread_bps", { length: 20 }),
  withinCbnLimit: boolean("within_cbn_limit").notNull().default(true),
  source: varchar("source", { length: 100 }).notNull().default("adb_passthrough_simulated"),
  session: varchar("session", { length: 20 }),
  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
});
export type BmatchRateSnapshot = typeof bmatchRateSnapshots.$inferSelect;

export const walletFundingEvents = pgTable("wallet_funding_events", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: varchar("amount", { length: 30 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  fundingSourceType: fundingSourceTypeEnum("funding_source_type").notNull(),
  sourceReference: varchar("source_reference", { length: 200 }),
  settlementAccountId: integer("settlement_account_id").references(() => settlementAccounts.id),
  isNfemApproved: boolean("is_nfem_approved").notNull().default(false),
  blockedReason: text("blocked_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type WalletFundingEvent = typeof walletFundingEvents.$inferSelect;

export const bdcPartners = pgTable("bdc_partners", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  cbnLicenceNumber: varchar("cbn_licence_number", { length: 100 }).notNull().unique(),
  adbName: varchar("adb_name", { length: 200 }).notNull(),
  adbCode: varchar("adb_code", { length: 20 }),
  contactEmail: varchar("contact_email", { length: 200 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  status: bdcPartnerStatusEnum("status").notNull().default("pending_review"),
  maxDailyFxUsd: integer("max_daily_fx_usd").notNull().default(100000),
  notes: text("notes"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type BdcPartner = typeof bdcPartners.$inferSelect;
export type InsertBdcPartner = typeof bdcPartners.$inferInsert;

export const bdcLiquidityRequests = pgTable("bdc_liquidity_requests", {
  id: serial("id").primaryKey(),
  bdcPartnerId: integer("bdc_partner_id").notNull().references(() => bdcPartners.id),
  settlementAccountId: integer("settlement_account_id").references(() => settlementAccounts.id),
  requestedAmountUsd: integer("requested_amount_usd").notNull(),
  approvedAmountUsd: integer("approved_amount_usd"),
  bmatchRateAtRequest: varchar("bmatch_rate_at_request", { length: 30 }),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  adbTransferReference: varchar("adb_transfer_reference", { length: 200 }),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type BdcLiquidityRequest = typeof bdcLiquidityRequests.$inferSelect;

export const cbnComplianceExports = pgTable("cbn_compliance_exports", {
  id: serial("id").primaryKey(),
  exportType: varchar("export_type", { length: 50 }).notNull(),
  fromDate: timestamp("from_date").notNull(),
  toDate: timestamp("to_date").notNull(),
  corridor: varchar("corridor", { length: 20 }),
  recordCount: integer("record_count").notNull().default(0),
  fileUrl: text("file_url"),
  fileKey: text("file_key"),
  status: varchar("status", { length: 30 }).notNull().default("generated"),
  generatedBy: integer("generated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CbnComplianceExport = typeof cbnComplianceExports.$inferSelect;

export const cbnCorridors = pgTable("cbn_corridors", {
  id: serial("id").primaryKey(),
  corridor: varchar("corridor", { length: 20 }).notNull().unique(), // e.g. "USD/NGN"
  papssEnabled: boolean("papss_enabled").notNull().default(false),
  exchangeRate: varchar("exchange_rate", { length: 30 }),
  transferFeePercent: varchar("transfer_fee_percent", { length: 10 }),
  settlementTimeHours: integer("settlement_time_hours").default(24),
  minAmountUsd: integer("min_amount_usd").default(1),
  maxAmountUsd: integer("max_amount_usd").default(50000),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type CbnCorridor = typeof cbnCorridors.$inferSelect;
export type InsertCbnCorridor = typeof cbnCorridors.$inferInsert;

// ─── Outbound Annual Usage (CBN Form A annual limits per user per purpose code) ─
export const outboundAnnualUsage = pgTable("outbound_annual_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  purposeCode: varchar("purpose_code", { length: 20 }).notNull(), // EDU, MED, TRV, REM, SME, HNW, INV, DIVI
  calendarYear: integer("calendar_year").notNull(), // e.g. 2026
  usedUsd: numeric("used_usd", { precision: 18, scale: 2 }).default("0.00").notNull(),
  lastTransactionAt: timestamp("last_transaction_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type OutboundAnnualUsage = typeof outboundAnnualUsage.$inferSelect;
export type InsertOutboundAnnualUsage = typeof outboundAnnualUsage.$inferInsert;

// ─── Cross-Sell Offers (triggered when Python scoreCrossSell > 0.7) ────────────
export const crossSellOfferTypeEnum = pgEnum("cross_sell_offer_type", [
  "savings_account", "diaspora_bond", "insurance", "investment_fund", "credit_card"
]);
export const crossSellOfferStatusEnum = pgEnum("cross_sell_offer_status", [
  "pending", "shown", "accepted", "dismissed", "expired"
]);
export const crossSellOffers = pgTable("cross_sell_offers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  offerType: crossSellOfferTypeEnum("offer_type").notNull(),
  score: numeric("score", { precision: 5, scale: 4 }).notNull(), // 0.0000 - 1.0000
  segment: varchar("segment", { length: 30 }), // labor, education, medical, sme, hnw
  headline: varchar("headline", { length: 200 }),
  body: text("body"),
  ctaLabel: varchar("cta_label", { length: 100 }),
  ctaUrl: varchar("cta_url", { length: 500 }),
  status: crossSellOfferStatusEnum("status").notNull().default("pending"),
  shownAt: timestamp("shown_at"),
  respondedAt: timestamp("responded_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CrossSellOffer = typeof crossSellOffers.$inferSelect;
export type InsertCrossSellOffer = typeof crossSellOffers.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// v200 — Gap Implementation Tables
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Gap 1: West African Outbound Corridors ────────────────────────────────────
export const westAfricanCorridorEnum = pgEnum("west_african_corridor", [
  "GH", "TG", "NE", "ML", "BJ", "CI", "SN", "BF"
]);
export const xofPayoutMethodEnum = pgEnum("xof_payout_method", [
  "mobile_money", "bank_account", "cash_pickup", "wallet"
]);

export const westAfricanCorridors = pgTable("west_african_corridors", {
  id: serial("id").primaryKey(),
  corridorCode: westAfricanCorridorEnum("corridor_code").notNull(),
  countryName: varchar("country_name", { length: 100 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(), // XOF, GHS, XAF
  fxRateNgn: numeric("fx_rate_ngn", { precision: 18, scale: 6 }).notNull(),
  fxRateUpdatedAt: timestamp("fx_rate_updated_at").notNull().defaultNow(),
  cbdcEnabled: boolean("cbdc_enabled").default(false),
  mojalooopEnabled: boolean("mojaloop_enabled").default(false),
  minTransferNgn: integer("min_transfer_ngn").notNull().default(5000),
  maxTransferNgn: integer("max_transfer_ngn").notNull().default(5000000),
  feePercent: numeric("fee_percent", { precision: 5, scale: 4 }).notNull().default("0.0150"),
  settlementHours: integer("settlement_hours").notNull().default(24),
  isActive: boolean("is_active").notNull().default(true),
  kafkaTopic: varchar("kafka_topic", { length: 200 }),
  daprAppId: varchar("dapr_app_id", { length: 100 }),
  mojalooopFspId: varchar("mojaloop_fsp_id", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type WestAfricanCorridor = typeof westAfricanCorridors.$inferSelect;

export const xofPayoutAccounts = pgTable("xof_payout_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  corridorCode: westAfricanCorridorEnum("corridor_code").notNull(),
  payoutMethod: xofPayoutMethodEnum("payout_method").notNull(),
  accountName: varchar("account_name", { length: 200 }).notNull(),
  accountNumber: varchar("account_number", { length: 50 }),
  mobileNumber: varchar("mobile_number", { length: 20 }),
  mobileProvider: varchar("mobile_provider", { length: 50 }), // MTN, Orange, Moov, Airtel
  bankCode: varchar("bank_code", { length: 20 }),
  bankName: varchar("bank_name", { length: 100 }),
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type XofPayoutAccount = typeof xofPayoutAccounts.$inferSelect;

export const ecowasComplianceChecks = pgTable("ecowas_compliance_checks", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id"),
  userId: integer("user_id").notNull().references(() => users.id),
  corridorCode: westAfricanCorridorEnum("corridor_code").notNull(),
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }).notNull(),
  checkType: varchar("check_type", { length: 50 }).notNull(), // aml, sanctions, cbn_limit, ecowas_limit
  result: varchar("result", { length: 20 }).notNull(), // pass, fail, review
  riskScore: numeric("risk_score", { precision: 5, scale: 4 }),
  details: jsonb("details"),
  openSearchDocId: varchar("open_search_doc_id", { length: 200 }),
  tigerBeetleEntryId: bigint("tiger_beetle_entry_id", { mode: "bigint" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type EcowasComplianceCheck = typeof ecowasComplianceChecks.$inferSelect;

// ─── Gap 2: Immigrant Worker Cash-In / Agent Onboarding ───────────────────────
export const kycTierV2Enum = pgEnum("kyc_tier_v2", ["tier0", "tier1", "tier2", "tier3"]);
export const idDocTypeEnum = pgEnum("id_doc_type", [
  "ecowas_id", "national_id", "passport", "drivers_license", "nin_slip", "voters_card"
]);

export const immigrantWorkerProfiles = pgTable("immigrant_worker_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  nationalityCode: varchar("nationality_code", { length: 5 }).notNull(), // GH, TG, NE, ML, BJ
  preferredLanguage: varchar("preferred_language", { length: 10 }).default("en"), // en, fr, ha
  employerName: varchar("employer_name", { length: 200 }),
  employerAddress: text("employer_address"),
  workPermitNumber: varchar("work_permit_number", { length: 50 }),
  workPermitExpiry: timestamp("work_permit_expiry"),
  kycTier: kycTierV2Enum("kyc_tier").notNull().default("tier0"),
  dailyLimitNgn: integer("daily_limit_ngn").notNull().default(50000),
  monthlyLimitNgn: integer("monthly_limit_ngn").notNull().default(200000),
  keycloakRoleId: varchar("keycloak_role_id", { length: 100 }),
  permifySubjectId: varchar("permify_subject_id", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ImmigrantWorkerProfile = typeof immigrantWorkerProfiles.$inferSelect;

export const tieredKycSessions = pgTable("tiered_kyc_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  sessionToken: varchar("session_token", { length: 200 }).notNull().unique(),
  targetTier: kycTierV2Enum("target_tier").notNull(),
  idDocType: idDocTypeEnum("id_doc_type"),
  idDocNumber: varchar("id_doc_number", { length: 100 }),
  idDocFrontUrl: varchar("id_doc_front_url", { length: 500 }),
  idDocBackUrl: varchar("id_doc_back_url", { length: 500 }),
  selfieUrl: varchar("selfie_url", { length: 500 }),
  livenessScore: numeric("liveness_score", { precision: 5, scale: 4 }),
  ocrData: jsonb("ocr_data"),
  rustKycServiceResult: jsonb("rust_kyc_service_result"),
  status: varchar("status", { length: 30 }).notNull().default("pending"), // pending, processing, approved, rejected
  rejectionReason: text("rejection_reason"),
  redisSessionKey: varchar("redis_session_key", { length: 200 }),
  temporalWorkflowId: varchar("temporal_workflow_id", { length: 200 }),
  kafkaEventId: varchar("kafka_event_id", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
export type TieredKycSession = typeof tieredKycSessions.$inferSelect;

export const agentCashinTransactions = pgTable("agent_cashin_transactions", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => users.id),
  workerId: integer("worker_id").notNull().references(() => users.id),
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }).notNull(),
  destinationCorridor: westAfricanCorridorEnum("destination_corridor").notNull(),
  payoutMethod: xofPayoutMethodEnum("payout_method").notNull(),
  beneficiaryMobile: varchar("beneficiary_mobile", { length: 20 }),
  beneficiaryName: varchar("beneficiary_name", { length: 200 }),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  agentFeeNgn: numeric("agent_fee_ngn", { precision: 10, scale: 2 }),
  tigerBeetleDebitEntry: bigint("tiger_beetle_debit_entry", { mode: "bigint" }),
  tigerBeetleCreditEntry: bigint("tiger_beetle_credit_entry", { mode: "bigint" }),
  mojaloopTransferId: varchar("mojaloop_transfer_id", { length: 200 }),
  fluvioOffset: bigint("fluvio_offset", { mode: "bigint" }),
  reference: varchar("reference", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  settledAt: timestamp("settled_at"),
});
export type AgentCashinTransaction = typeof agentCashinTransactions.$inferSelect;

// ─── Gap 3: HNW Private Banking ────────────────────────────────────────────────
export const hnwTierEnum = pgEnum("hnw_tier", ["standard", "premium", "ultra"]);

export const hnwProfiles = pgTable("hnw_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  tier: hnwTierEnum("tier").notNull().default("standard"),
  annualTransferVolumeUsd: numeric("annual_transfer_volume_usd", { precision: 18, scale: 2 }),
  assignedRmId: integer("assigned_rm_id").references(() => users.id),
  negotiatedFxSpreadBps: integer("negotiated_fx_spread_bps").default(150), // basis points
  prioritySwiftEnabled: boolean("priority_swift_enabled").default(false),
  dedicatedIbanEnabled: boolean("dedicated_iban_enabled").default(false),
  keycloakRoleId: varchar("keycloak_role_id", { length: 100 }),
  permifySubjectId: varchar("permify_subject_id", { length: 100 }),
  onboardedAt: timestamp("onboarded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type HnwProfile = typeof hnwProfiles.$inferSelect;

export const hnwFxRates = pgTable("hnw_fx_rates", {
  id: serial("id").primaryKey(),
  hnwProfileId: integer("hnw_profile_id").notNull().references(() => hnwProfiles.id),
  currencyPair: varchar("currency_pair", { length: 10 }).notNull(), // NGNUSD, NGNGBP
  baseRate: numeric("base_rate", { precision: 18, scale: 8 }).notNull(),
  negotiatedRate: numeric("negotiated_rate", { precision: 18, scale: 8 }).notNull(),
  spreadBps: integer("spread_bps").notNull(),
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  rustEngineQuoteId: varchar("rust_engine_quote_id", { length: 200 }),
  redisRateKey: varchar("redis_rate_key", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type HnwFxRate = typeof hnwFxRates.$inferSelect;

export const hnwRelationshipManagers = pgTable("hnw_relationship_managers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  email: varchar("email", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  calendarUrl: varchar("calendar_url", { length: 500 }),
  maxClients: integer("max_clients").notNull().default(25),
  currentClients: integer("current_clients").notNull().default(0),
  specialisations: text("specialisations").array(),
  daprActorId: varchar("dapr_actor_id", { length: 200 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type HnwRelationshipManager = typeof hnwRelationshipManagers.$inferSelect;

export const hnwPortfolios = pgTable("hnw_portfolios", {
  id: serial("id").primaryKey(),
  hnwProfileId: integer("hnw_profile_id").notNull().references(() => hnwProfiles.id),
  assetClass: varchar("asset_class", { length: 50 }).notNull(), // bonds, equities, real_estate, fx_deposits
  assetName: varchar("asset_name", { length: 200 }).notNull(),
  currentValueUsd: numeric("current_value_usd", { precision: 18, scale: 2 }).notNull(),
  allocationPercent: numeric("allocation_percent", { precision: 5, scale: 2 }),
  yieldPercent: numeric("yield_percent", { precision: 5, scale: 4 }),
  openSearchDocId: varchar("open_search_doc_id", { length: 200 }),
  tigerBeetleAccountId: bigint("tiger_beetle_account_id", { mode: "bigint" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type HnwPortfolio = typeof hnwPortfolios.$inferSelect;

// ─── Gap 4: Correspondent Bank Management ─────────────────────────────────────
export const correspondentRiskEnum = pgEnum("correspondent_risk", ["low", "medium", "high", "critical"]);
export const derisikingStatusEnum = pgEnum("derisking_status", ["active", "watch", "at_risk", "terminated"]);

export const correspondentBanks = pgTable("correspondent_banks", {
  id: serial("id").primaryKey(),
  bankName: varchar("bank_name", { length: 200 }).notNull(),
  swiftBic: varchar("swift_bic", { length: 20 }).notNull().unique(),
  country: varchar("country", { length: 5 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  nostroAccountNumber: varchar("nostro_account_number", { length: 50 }),
  clearingLineUsd: numeric("clearing_line_usd", { precision: 18, scale: 2 }),
  usedLineUsd: numeric("used_line_usd", { precision: 18, scale: 2 }).default("0"),
  settlementCostBps: integer("settlement_cost_bps").notNull().default(150),
  riskScore: correspondentRiskEnum("risk_score").notNull().default("low"),
  derisikingStatus: derisikingStatusEnum("derisking_status").notNull().default("active"),
  lastReviewDate: timestamp("last_review_date"),
  nextReviewDate: timestamp("next_review_date"),
  openSearchDocId: varchar("open_search_doc_id", { length: 200 }),
  tigerBeetleAccountId: bigint("tiger_beetle_account_id", { mode: "bigint" }),
  kafkaTopic: varchar("kafka_topic", { length: 200 }),
  lakehouseTablePath: varchar("lakehouse_table_path", { length: 500 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type CorrespondentBank = typeof correspondentBanks.$inferSelect;

export const clearingLines = pgTable("clearing_lines", {
  id: serial("id").primaryKey(),
  correspondentBankId: integer("correspondent_bank_id").notNull().references(() => correspondentBanks.id),
  currency: varchar("currency", { length: 10 }).notNull(),
  limitUsd: numeric("limit_usd", { precision: 18, scale: 2 }).notNull(),
  usedUsd: numeric("used_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  utilizationPercent: numeric("utilization_percent", { precision: 5, scale: 2 }),
  alertThresholdPercent: integer("alert_threshold_percent").notNull().default(80),
  tigerBeetleAccountId: bigint("tiger_beetle_account_id", { mode: "bigint" }),
  redisUtilKey: varchar("redis_util_key", { length: 200 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ClearingLine = typeof clearingLines.$inferSelect;

export const correspondentRiskScores = pgTable("correspondent_risk_scores", {
  id: serial("id").primaryKey(),
  correspondentBankId: integer("correspondent_bank_id").notNull().references(() => correspondentBanks.id),
  scoreDate: timestamp("score_date").notNull().defaultNow(),
  overallScore: numeric("overall_score", { precision: 5, scale: 4 }).notNull(),
  amlScore: numeric("aml_score", { precision: 5, scale: 4 }),
  sanctionsScore: numeric("sanctions_score", { precision: 5, scale: 4 }),
  financialHealthScore: numeric("financial_health_score", { precision: 5, scale: 4 }),
  geopoliticalScore: numeric("geopolitical_score", { precision: 5, scale: 4 }),
  pythonModelVersion: varchar("python_model_version", { length: 50 }),
  openSearchDocId: varchar("open_search_doc_id", { length: 200 }),
  lakehouseRowId: varchar("lakehouse_row_id", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CorrespondentRiskScore = typeof correspondentRiskScores.$inferSelect;

export const derisikingAlerts = pgTable("derisking_alerts", {
  id: serial("id").primaryKey(),
  correspondentBankId: integer("correspondent_bank_id").notNull().references(() => correspondentBanks.id),
  alertType: varchar("alert_type", { length: 50 }).notNull(), // line_utilization, risk_score, regulatory, news
  severity: varchar("severity", { length: 20 }).notNull(), // info, warning, critical
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  isAcknowledged: boolean("is_acknowledged").default(false),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  kafkaEventId: varchar("kafka_event_id", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type DerisikingAlert = typeof derisikingAlerts.$inferSelect;

// ─── Gap 5: SME Trade Payments ─────────────────────────────────────────────────
export const tradeCorridorEnum = pgEnum("trade_corridor", ["CN", "AE", "IN", "US", "GB", "DE", "TR", "BD"]);
export const tradePurposeEnum = pgEnum("trade_purpose", [
  "goods_import", "services_import", "royalties", "technical_fees", "dividends", "loan_repayment"
]);

export const smeTradeBulkBatches = pgTable("sme_trade_bulk_batches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  batchReference: varchar("batch_reference", { length: 100 }).notNull().unique(),
  totalPayments: integer("total_payments").notNull(),
  totalAmountNgn: numeric("total_amount_ngn", { precision: 18, scale: 2 }).notNull(),
  csvFileUrl: varchar("csv_file_url", { length: 500 }),
  status: varchar("status", { length: 30 }).notNull().default("pending"), // pending, validating, approved, processing, completed, failed
  validationErrors: jsonb("validation_errors"),
  rustProcessorJobId: varchar("rust_processor_job_id", { length: 200 }),
  temporalWorkflowId: varchar("temporal_workflow_id", { length: 200 }),
  kafkaBatchId: varchar("kafka_batch_id", { length: 200 }),
  tigerBeetleBatchId: varchar("tiger_beetle_batch_id", { length: 200 }),
  lakehouseBatchPath: varchar("lakehouse_batch_path", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
export type SmeTradeBulkBatch = typeof smeTradeBulkBatches.$inferSelect;

export const smeTradePayments = pgTable("sme_trade_payments", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").references(() => smeTradeBulkBatches.id),
  userId: integer("user_id").notNull().references(() => users.id),
  corridor: tradeCorridorEnum("corridor").notNull(),
  purpose: tradePurposeEnum("purpose").notNull(),
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }).notNull(),
  amountForeign: numeric("amount_foreign", { precision: 18, scale: 2 }).notNull(),
  foreignCurrency: varchar("foreign_currency", { length: 10 }).notNull(),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull(),
  beneficiaryName: varchar("beneficiary_name", { length: 200 }).notNull(),
  beneficiaryBank: varchar("beneficiary_bank", { length: 200 }),
  beneficiarySwift: varchar("beneficiary_swift", { length: 20 }),
  beneficiaryAccount: varchar("beneficiary_account", { length: 50 }),
  formMNumber: varchar("form_m_number", { length: 50 }),
  formANumber: varchar("form_a_number", { length: 50 }),
  cbnApprovalRef: varchar("cbn_approval_ref", { length: 100 }),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  swiftMt103Ref: varchar("swift_mt103_ref", { length: 100 }),
  tigerBeetleEntryId: bigint("tiger_beetle_entry_id", { mode: "bigint" }),
  openSearchDocId: varchar("open_search_doc_id", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  settledAt: timestamp("settled_at"),
});
export type SmeTradePayment = typeof smeTradePayments.$inferSelect;

export const formMDocuments = pgTable("form_m_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  tradePaymentId: integer("trade_payment_id").references(() => smeTradePayments.id),
  formType: varchar("form_type", { length: 10 }).notNull(), // Form_M, Form_A
  formNumber: varchar("form_number", { length: 50 }),
  documentUrl: varchar("document_url", { length: 500 }),
  cbnPortalRef: varchar("cbn_portal_ref", { length: 100 }),
  validityDate: timestamp("validity_date"),
  pythonValidationResult: jsonb("python_validation_result"),
  status: varchar("status", { length: 30 }).notNull().default("pending"), // pending, validated, approved, rejected
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type FormMDocument = typeof formMDocuments.$inferSelect;

// ─── Gap 6: USA Diaspora Acquisition ──────────────────────────────────────────
export const diasporaUsaProfiles = pgTable("diaspora_usa_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  usState: varchar("us_state", { length: 5 }),
  plaidItemId: varchar("plaid_item_id", { length: 200 }),
  plaidAccessToken: varchar("plaid_access_token", { length: 500 }), // encrypted
  achRoutingNumber: varchar("ach_routing_number", { length: 20 }),
  achAccountNumber: varchar("ach_account_number", { length: 50 }), // encrypted
  achAccountType: varchar("ach_account_type", { length: 20 }), // checking, savings
  fincenMtlNumber: varchar("fincen_mtl_number", { length: 100 }),
  stateTransmitterLicences: text("state_transmitter_licences").array(),
  complianceDisclosureAcceptedAt: timestamp("compliance_disclosure_accepted_at"),
  keycloakRoleId: varchar("keycloak_role_id", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DiasporaUsaProfile = typeof diasporaUsaProfiles.$inferSelect;

export const achPaymentMethods = pgTable("ach_payment_methods", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  bankName: varchar("bank_name", { length: 200 }).notNull(),
  routingNumber: varchar("routing_number", { length: 20 }).notNull(),
  accountNumberMasked: varchar("account_number_masked", { length: 20 }).notNull(),
  accountType: varchar("account_type", { length: 20 }).notNull(),
  plaidAccountId: varchar("plaid_account_id", { length: 200 }),
  isVerified: boolean("is_verified").default(false),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type AchPaymentMethod = typeof achPaymentMethods.$inferSelect;

export const usComplianceDisclosures = pgTable("us_compliance_disclosures", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  disclosureVersion: varchar("disclosure_version", { length: 20 }).notNull(),
  disclosureType: varchar("disclosure_type", { length: 50 }).notNull(), // fincen, state_mtl, cfpb, dodd_frank
  acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
  ipAddress: varchar("ip_address", { length: 50 }),
  userAgent: text("user_agent"),
});
export type UsComplianceDisclosure = typeof usComplianceDisclosures.$inferSelect;

// ─── Gap 7: EU/Italy/Canada Diaspora Corridors ────────────────────────────────
export const euCorridorEnum = pgEnum("eu_corridor", ["IT", "DE", "FR", "ES", "NL", "BE", "PT", "IE"]);

export const diasporaEuProfiles = pgTable("diaspora_eu_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  country: euCorridorEnum("country").notNull(),
  sepaIban: varchar("sepa_iban", { length: 50 }),
  sepaBic: varchar("sepa_bic", { length: 20 }),
  sepaAccountName: varchar("sepa_account_name", { length: 200 }),
  psd2ConsentId: varchar("psd2_consent_id", { length: 200 }),
  psd2ConsentExpiry: timestamp("psd2_consent_expiry"),
  ebaComplianceRef: varchar("eba_compliance_ref", { length: 100 }),
  keycloakRoleId: varchar("keycloak_role_id", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DiasporaEuProfile = typeof diasporaEuProfiles.$inferSelect;

export const sepaPaymentMethods = pgTable("sepa_payment_methods", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  iban: varchar("iban", { length: 50 }).notNull(),
  bic: varchar("bic", { length: 20 }),
  accountName: varchar("account_name", { length: 200 }).notNull(),
  bankName: varchar("bank_name", { length: 200 }),
  country: euCorridorEnum("country").notNull(),
  isVerified: boolean("is_verified").default(false),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SepaPaymentMethod = typeof sepaPaymentMethods.$inferSelect;

export const diasporaCanadaProfiles = pgTable("diaspora_canada_profiles", {
  id: serial("user_id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  province: varchar("province", { length: 5 }),
  interacEmail: varchar("interac_email", { length: 200 }),
  interacPhone: varchar("interac_phone", { length: 30 }),
  fintracReportingRef: varchar("fintrac_reporting_ref", { length: 100 }),
  keycloakRoleId: varchar("keycloak_role_id", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DiasporaCanadaProfile = typeof diasporaCanadaProfiles.$inferSelect;

export const interacPaymentMethods = pgTable("interac_payment_methods", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  interacEmail: varchar("interac_email", { length: 200 }),
  interacPhone: varchar("interac_phone", { length: 30 }),
  bankName: varchar("bank_name", { length: 200 }),
  transitNumber: varchar("transit_number", { length: 10 }),
  institutionNumber: varchar("institution_number", { length: 5 }),
  accountNumberMasked: varchar("account_number_masked", { length: 20 }),
  isVerified: boolean("is_verified").default(false),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type InteracPaymentMethod = typeof interacPaymentMethods.$inferSelect;


// ─── v200 Gap Implementation Tables ─────────────────────────────────────────

// West Africa XOF corridor transfers
export const westAfricaTransfers = pgTable("west_africa_transfers", {
  id: serial("id").primaryKey(),
  transferId: varchar("transfer_id", { length: 100 }).notNull().unique(),
  userId: integer("user_id").notNull(),
  corridorCode: varchar("corridor_code", { length: 5 }).notNull(), // TG, NE, ML, BJ, GH
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }),
  amountXof: numeric("amount_xof", { precision: 18, scale: 2 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  feesNgn: numeric("fees_ngn", { precision: 18, scale: 2 }),
  recipientMobileMoney: varchar("recipient_mobile_money", { length: 30 }).notNull(),
  recipientName: varchar("recipient_name", { length: 100 }).notNull(),
  mojaloopDfspId: varchar("mojaloop_dfsp_id", { length: 50 }),
  mojaloopTxnId: varchar("mojaloop_txn_id", { length: 100 }),
  purposeCode: varchar("purpose_code", { length: 10 }).default("FAM"),
  status: varchar("status", { length: 30 }).default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type WestAfricaTransfer = typeof westAfricaTransfers.$inferSelect;

// Immigrant worker KYC tiers and limits
export const immigrantWorkerKyc = pgTable("immigrant_worker_kyc", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  kycTier: varchar("kyc_tier", { length: 20 }).default("tier1"), // tier1, tier2, tier3
  nin: varchar("nin", { length: 11 }),
  bvn: varchar("bvn", { length: 11 }),
  selfieVerified: boolean("selfie_verified").default(false),
  documentType: varchar("document_type", { length: 50 }),
  documentVerified: boolean("document_verified").default(false),
  monthlyLimitUsd: numeric("monthly_limit_usd", { precision: 12, scale: 2 }).default("500.00"),
  monthlyUsedUsd: numeric("monthly_used_usd", { precision: 12, scale: 2 }).default("0.00"),
  annualLimitUsd: numeric("annual_limit_usd", { precision: 12, scale: 2 }).default("5000.00"),
  annualUsedUsd: numeric("annual_used_usd", { precision: 12, scale: 2 }).default("0.00"),
  verificationProvider: varchar("verification_provider", { length: 50 }),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ImmigrantWorkerKyc = typeof immigrantWorkerKyc.$inferSelect;

// HNW client profiles
export const hnwClientProfiles = pgTable("hnw_client_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  aumTier: varchar("aum_tier", { length: 20 }).default("standard"), // standard, premium, elite
  negotiatedSpreadBps: numeric("negotiated_spread_bps", { precision: 6, scale: 2 }).default("150.00"),
  rmName: varchar("rm_name", { length: 100 }),
  rmEmail: varchar("rm_email", { length: 200 }),
  rmPhone: varchar("rm_phone", { length: 30 }),
  maxRateLockAmountNgn: numeric("max_rate_lock_amount_ngn", { precision: 18, scale: 2 }),
  preferredCurrencies: text("preferred_currencies"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type HnwClientProfile = typeof hnwClientProfiles.$inferSelect;

// HNW rate locks
export const hnwRateLocks = pgTable("hnw_rate_locks", {
  id: serial("id").primaryKey(),
  lockId: varchar("lock_id", { length: 100 }).notNull().unique(),
  userId: integer("user_id").notNull(),
  corridorCode: varchar("corridor_code", { length: 5 }).notNull(),
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  spreadBps: numeric("spread_bps", { precision: 6, scale: 2 }),
  status: varchar("status", { length: 20 }).default("active"), // active, executed, expired, cancelled
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type HnwRateLock = typeof hnwRateLocks.$inferSelect;

// HNW transfers
export const hnwTransfers = pgTable("hnw_transfers", {
  id: serial("id").primaryKey(),
  transferId: varchar("transfer_id", { length: 100 }).notNull().unique(),
  userId: integer("user_id").notNull(),
  rateLockId: varchar("rate_lock_id", { length: 100 }),
  corridorCode: varchar("corridor_code", { length: 5 }).notNull(),
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  recipientSwift: varchar("recipient_swift", { length: 11 }),
  recipientAccount: varchar("recipient_account", { length: 34 }),
  recipientName: varchar("recipient_name", { length: 100 }),
  purposeCode: varchar("purpose_code", { length: 10 }).default("PER"),
  status: varchar("status", { length: 30 }).default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type HnwTransfer = typeof hnwTransfers.$inferSelect;

// HNW RM contact requests
export const hnwRmRequests = pgTable("hnw_rm_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  message: text("message").notNull(),
  preferredContactTime: varchar("preferred_contact_time", { length: 100 }),
  topic: varchar("topic", { length: 50 }).default("general"),
  status: varchar("status", { length: 20 }).default("pending"), // pending, in_progress, resolved
  rmResponse: text("rm_response"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});
export type HnwRmRequest = typeof hnwRmRequests.$inferSelect;

// Correspondent banks
export const correspondentBanksV200 = pgTable("correspondent_banks_v200", {
  id: serial("id").primaryKey(),
  correspondentId: varchar("correspondent_id", { length: 100 }).notNull().unique(),
  bankName: varchar("bank_name", { length: 200 }).notNull(),
  swiftCode: varchar("swift_code", { length: 11 }).notNull(),
  countryCode: varchar("country_code", { length: 2 }),
  currency: varchar("currency", { length: 3 }),
  clearingLineUsd: numeric("clearing_line_usd", { precision: 18, scale: 2 }).default("0"),
  nostroBalanceUsd: numeric("nostro_balance_usd", { precision: 18, scale: 2 }).default("0"),
  vostroBalanceUsd: numeric("vostro_balance_usd", { precision: 18, scale: 2 }).default("0"),
  utilizationPct: numeric("utilization_pct", { precision: 5, scale: 2 }).default("0"),
  feeBps: numeric("fee_bps", { precision: 6, scale: 2 }).default("50"),
  settlementRail: varchar("settlement_rail", { length: 20 }).default("swift"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type CorrespondentBankV200 = typeof correspondentBanksV200.$inferSelect;

// Correspondent settlements
export const correspondentSettlements = pgTable("correspondent_settlements", {
  id: serial("id").primaryKey(),
  correspondentId: varchar("correspondent_id", { length: 100 }).notNull(),
  direction: varchar("direction", { length: 30 }).notNull(),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 3 }),
  status: varchar("status", { length: 20 }).default("pending"),
  reference: varchar("reference", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CorrespondentSettlement = typeof correspondentSettlements.$inferSelect;

// SME trade batches
export const smeTradeBatches = pgTable("sme_trade_batches", {
  id: serial("id").primaryKey(),
  batchId: varchar("batch_id", { length: 100 }).notNull().unique(),
  userId: integer("user_id").notNull(),
  corridorCode: varchar("corridor_code", { length: 5 }).notNull(),
  totalPayments: integer("total_payments").default(0),
  totalAmountUsd: numeric("total_amount_usd", { precision: 18, scale: 2 }),
  formMNumber: varchar("form_m_number", { length: 30 }),
  batchReference: varchar("batch_reference", { length: 100 }),
  status: varchar("status", { length: 30 }).default("processing"),
  succeeded: integer("succeeded").default(0),
  failed: integer("failed").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
export type SmeTradeBatch = typeof smeTradeBatches.$inferSelect;

// Diaspora profiles
export const diasporaProfiles = pgTable("diaspora_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  diasporaRegion: varchar("diaspora_region", { length: 20 }).notNull(), // usa, eu, uk, ca
  countryOfResidence: varchar("country_of_residence", { length: 2 }),
  homeCorridor: varchar("home_corridor", { length: 5 }).default("NG"),
  preferredPaymentRail: varchar("preferred_payment_rail", { length: 20 }),
  avgTransferAmountUsd: numeric("avg_transfer_amount_usd", { precision: 12, scale: 2 }).default("0"),
  transferFrequencyPerYear: numeric("transfer_frequency_per_year", { precision: 5, scale: 1 }).default("0"),
  totalTransferredYtdUsd: numeric("total_transferred_ytd_usd", { precision: 18, scale: 2 }).default("0"),
  crossSellScore: numeric("cross_sell_score", { precision: 4, scale: 3 }).default("0"),
  acquisitionChannel: varchar("acquisition_channel", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type DiasporaProfile = typeof diasporaProfiles.$inferSelect;

// Diaspora offer claims
export const diasporaOfferClaims = pgTable("diaspora_offer_claims", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  offerType: varchar("offer_type", { length: 50 }).notNull(),
  diasporaRegion: varchar("diaspora_region", { length: 20 }),
  status: varchar("status", { length: 20 }).default("active"),
  claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
});
export type DiasporaOfferClaim = typeof diasporaOfferClaims.$inferSelect;

// Generic outbound transfers table (for ACH/SEPA/EFT)
export const transfers = pgTable("outbound_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  transferType: varchar("transfer_type", { length: 20 }).default("outbound"),
  rail: varchar("rail", { length: 20 }), // ach, sepa, eft, swift, xof
  corridorCode: varchar("corridor_code", { length: 5 }),
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }),
  amountForeign: numeric("amount_foreign", { precision: 18, scale: 2 }),
  foreignCurrency: varchar("foreign_currency", { length: 3 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  feesNgn: numeric("fees_ngn", { precision: 18, scale: 2 }),
  recipientName: varchar("recipient_name", { length: 100 }),
  recipientAccount: varchar("recipient_account", { length: 34 }),
  recipientSwift: varchar("recipient_swift", { length: 11 }),
  purposeCode: varchar("purpose_code", { length: 10 }),
  status: varchar("status", { length: 30 }).default("pending"),
  externalRef: varchar("external_ref", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
export type Transfer = typeof transfers.$inferSelect;

// ─── Billing Engine Tables ────────────────────────────────────────────────────
export const billingTenantTypeEnum = pgEnum("billing_tenant_type", ["IMTO_PARTNER", "WHITE_LABEL", "ENTERPRISE_SENDER"]);
export const billingTenantStatusEnum = pgEnum("billing_tenant_status", ["PENDING", "ACTIVE", "SUSPENDED", "TERMINATED"]);
export const billingFeeModeEnum = pgEnum("billing_fee_mode", ["PERCENTAGE", "FLAT", "HYBRID"]);
export const billingPayoutMethodEnum = pgEnum("billing_payout_method", ["BANK_TRANSFER", "MOBILE_MONEY", "CASH_PICKUP", "WALLET", "CRYPTO"]);
export const billingSettlementStatusEnum = pgEnum("billing_settlement_status", ["PENDING", "SETTLED", "FAILED", "REVERSED"]);

export const billingTenants = pgTable("billing_tenants", {
  id: serial("id").primaryKey(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull().unique(),
  tenantName: varchar("tenant_name", { length: 255 }).notNull(),
  tenantType: billingTenantTypeEnum("tenant_type").notNull(),
  status: billingTenantStatusEnum("status").notNull().default("PENDING"),
  ownerEmail: varchar("owner_email", { length: 255 }).notNull(),
  ownerName: varchar("owner_name", { length: 255 }),
  keycloakRealmId: varchar("keycloak_realm_id", { length: 100 }),
  mojalaopDfspId: varchar("mojaloop_dfsp_id", { length: 50 }),
  onboardedAt: timestamp("onboarded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type BillingTenant = typeof billingTenants.$inferSelect;

export const billingConfigs = pgTable("billing_configs", {
  id: serial("id").primaryKey(),
  configId: varchar("config_id", { length: 100 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  version: varchar("version", { length: 50 }).notNull().default("1.0.0"),
  isActive: boolean("is_active").notNull().default(true),
  feeMode: billingFeeModeEnum("fee_mode").notNull().default("PERCENTAGE"),
  feePercentage: numeric("fee_percentage", { precision: 8, scale: 4 }),
  flatFeeMinor: integer("flat_fee_minor").default(0),
  feeCapMinor: integer("fee_cap_minor").default(2000),
  feeFloorMinor: integer("fee_floor_minor").default(100),
  fxSpreadPercentage: numeric("fx_spread_percentage", { precision: 8, scale: 4 }).notNull().default("0.8000"),
  hedgeCostPercentage: numeric("hedge_cost_percentage", { precision: 8, scale: 4 }).notNull().default("0.1500"),
  platformFeeSharePct: numeric("platform_fee_share_pct", { precision: 8, scale: 4 }).notNull().default("40.0000"),
  platformFxSharePct: numeric("platform_fx_share_pct", { precision: 8, scale: 4 }).notNull().default("100.0000"),
  overheadPerTxMinor: integer("overhead_per_tx_minor").notNull().default(50),
  updatedBy: varchar("updated_by", { length: 100 }).notNull(),
  changeReason: text("change_reason"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type BillingConfig = typeof billingConfigs.$inferSelect;

export const billingConfigHistory = pgTable("billing_config_history", {
  id: serial("id").primaryKey(),
  configId: varchar("config_id", { length: 100 }).notNull(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
  changedBy: varchar("changed_by", { length: 100 }).notNull(),
  changeReason: text("change_reason"),
  changedAtMs: bigint("changed_at_ms", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  notificationSent: boolean("notification_sent").notNull().default(false),
});
export type BillingConfigHistory = typeof billingConfigHistory.$inferSelect;

export const billingEvents = pgTable("billing_events", {
  id: serial("id").primaryKey(),
  eventId: varchar("event_id", { length: 100 }).notNull().unique(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  transactionId: varchar("transaction_id", { length: 100 }).notNull(),
  corridor: varchar("corridor", { length: 10 }).notNull(),
  sendCurrency: char("send_currency", { length: 3 }).notNull(),
  recvCurrency: char("recv_currency", { length: 3 }).notNull(),
  sendAmountMinor: bigint("send_amount_minor", { mode: "number" }).notNull(),
  recvAmountMinor: bigint("recv_amount_minor", { mode: "number" }).notNull(),
  transferFeeMinor: bigint("transfer_fee_minor", { mode: "number" }).notNull().default(0),
  platformFeeShareMinor: bigint("platform_fee_share_minor", { mode: "number" }).notNull().default(0),
  partnerFeeShareMinor: bigint("partner_fee_share_minor", { mode: "number" }).notNull().default(0),
  feeMode: billingFeeModeEnum("fee_mode").notNull(),
  midMarketRate: numeric("mid_market_rate", { precision: 20, scale: 8 }).notNull(),
  appliedRate: numeric("applied_rate", { precision: 20, scale: 8 }).notNull(),
  fxSpreadMinor: bigint("fx_spread_minor", { mode: "number" }).notNull().default(0),
  fxHedgeCostMinor: bigint("fx_hedge_cost_minor", { mode: "number" }).notNull().default(0),
  netFxRevenueMinor: bigint("net_fx_revenue_minor", { mode: "number" }).notNull().default(0),
  payoutMethod: billingPayoutMethodEnum("payout_method").notNull().default("BANK_TRANSFER"),
  payoutCostMinor: bigint("payout_cost_minor", { mode: "number" }).notNull().default(0),
  allocatedOverheadMinor: bigint("allocated_overhead_minor", { mode: "number" }).notNull().default(0),
  netPlatformProfitMinor: bigint("net_platform_profit_minor", { mode: "number" }).notNull().default(0),
  settlementStatus: billingSettlementStatusEnum("settlement_status").notNull().default("PENDING"),
  createdByUserId: varchar("created_by_user_id", { length: 100 }).notNull(),
  billingConfigVersion: varchar("billing_config_version", { length: 50 }).notNull(),
  eventTimestampMs: bigint("event_timestamp_ms", { mode: "number" }).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type BillingEvent = typeof billingEvents.$inferSelect;

export const billingAuditLog = pgTable("billing_audit_log", {
  id: serial("id").primaryKey(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  actorUserId: varchar("actor_user_id", { length: 100 }).notNull(),
  actorRole: varchar("actor_role", { length: 50 }).notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  occurredAtMs: bigint("occurred_at_ms", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type BillingAuditLog = typeof billingAuditLog.$inferSelect;

// ─── SWIFT GPI Transactions ───────────────────────────────────────────────────
export const swiftGpiStatusEnum = pgEnum("swift_gpi_status", ["ACCP", "ACSP", "ACSC", "RJCT", "PDNG"]);
export const swiftTransactions = pgTable("swift_transactions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  uetr: uuid("uetr").notNull().unique(),
  msgId: varchar("msg_id", { length: 128 }).notNull(),
  endToEndId: varchar("end_to_end_id", { length: 128 }),
  txId: varchar("tx_id", { length: 128 }),
  debtorName: varchar("debtor_name", { length: 200 }),
  debtorAccount: varchar("debtor_account", { length: 100 }),
  debtorBic: varchar("debtor_bic", { length: 20 }),
  creditorName: varchar("creditor_name", { length: 200 }),
  creditorAccount: varchar("creditor_account", { length: 100 }),
  creditorBic: varchar("creditor_bic", { length: 20 }),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  chargeBearer: varchar("charge_bearer", { length: 10 }),
  remittanceInfo: text("remittance_info"),
  status: swiftGpiStatusEnum("status").default("ACCP").notNull(),
  messageJson: json("message_json").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SwiftTransaction = typeof swiftTransactions.$inferSelect;

// ============================================================
// GLOBAL PAYROLL MODULE — May 2026
// ============================================================

export const payrollCompanyStatusEnum = pgEnum("payroll_company_status", ["active", "suspended", "pending_kyb"]);
export const payrollFrequencyEnum    = pgEnum("payroll_frequency",       ["weekly", "bi_weekly", "semi_monthly", "monthly"]);
export const payrollRunStatusEnum    = pgEnum("payroll_run_status",      ["draft", "pending_approval", "approved", "processing", "disbursed", "failed", "cancelled"]);
export const payrollItemStatusEnum   = pgEnum("payroll_item_status",     ["pending", "processing", "paid", "failed", "on_hold"]);
export const employmentTypeEnum      = pgEnum("employment_type",         ["full_time", "part_time", "contractor", "intern"]);
export const payrollJurisdictionEnum = pgEnum("payroll_jurisdiction",    ["NG", "GB", "US", "CA", "DE", "FR", "IT", "AE", "GH", "KE", "ZA"]);

export const payrollCompanies = pgTable("payroll_companies", {
  id:                 serial("id").primaryKey(),
  ownerId:            integer("owner_id").notNull().references(() => users.id),
  name:               varchar("name", { length: 200 }).notNull(),
  registrationNumber: varchar("registration_number", { length: 100 }),
  taxId:              varchar("tax_id", { length: 100 }),
  country:            varchar("country", { length: 4 }).notNull(),
  baseCurrency:       varchar("base_currency", { length: 8 }).default("USD"),
  status:             payrollCompanyStatusEnum("status").default("active"),
  logoUrl:            text("logo_url"),
  totalEmployees:     integer("total_employees").default(0),
  monthlyPayrollUsd:  numeric("monthly_payroll_usd", { precision: 18, scale: 2 }).default("0"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
});
export type PayrollCompany = typeof payrollCompanies.$inferSelect;

export const payrollEmployees = pgTable("payroll_employees", {
  id:               serial("id").primaryKey(),
  companyId:        integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  userId:           integer("user_id").references(() => users.id),
  employeeCode:     varchar("employee_code", { length: 50 }).notNull(),
  firstName:        varchar("first_name", { length: 100 }).notNull(),
  lastName:         varchar("last_name", { length: 100 }).notNull(),
  email:            varchar("email", { length: 200 }).notNull(),
  phone:            varchar("phone", { length: 30 }),
  jobTitle:         varchar("job_title", { length: 150 }),
  department:       varchar("department", { length: 100 }),
  employmentType:   employmentTypeEnum("employment_type").default("full_time"),
  jurisdiction:     payrollJurisdictionEnum("jurisdiction").notNull(),
  country:          varchar("country", { length: 4 }).notNull(),
  grossSalary:      numeric("gross_salary", { precision: 18, scale: 2 }).notNull(),
  salaryCurrency:   varchar("salary_currency", { length: 8 }).default("USD"),
  bankName:         varchar("bank_name", { length: 150 }),
  bankAccount:      varchar("bank_account", { length: 100 }),
  bankRoutingCode:  varchar("bank_routing_code", { length: 50 }),
  mobileMoneyNum:   varchar("mobile_money_num", { length: 30 }),
  preferredChannel: varchar("preferred_channel", { length: 20 }).default("bank"),
  taxCode:          varchar("tax_code", { length: 50 }),
  nationalId:       varchar("national_id", { length: 100 }),
  startDate:        timestamp("start_date"),
  endDate:          timestamp("end_date"),
  isActive:         boolean("is_active").default(true),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type PayrollEmployee = typeof payrollEmployees.$inferSelect;

export const payrollTaxConfigs = pgTable("payroll_tax_configs", {
  id:              serial("id").primaryKey(),
  jurisdiction:    payrollJurisdictionEnum("jurisdiction").notNull(),
  taxYear:         integer("tax_year").notNull(),
  brackets:        json("brackets").$type<Array<{ min: number; max: number | null; rate: number; flatAmount: number }>>().notNull(),
  socialSecurity:  numeric("social_security_rate", { precision: 6, scale: 4 }).default("0"),
  medicare:        numeric("medicare_rate",         { precision: 6, scale: 4 }).default("0"),
  pensionEmployee: numeric("pension_employee_rate", { precision: 6, scale: 4 }).default("0"),
  pensionEmployer: numeric("pension_employer_rate", { precision: 6, scale: 4 }).default("0"),
  nhf:             numeric("nhf_rate",              { precision: 6, scale: 4 }).default("0"),
  nhis:            numeric("nhis_rate",             { precision: 6, scale: 4 }).default("0"),
  effectiveFrom:   timestamp("effective_from").notNull(),
  effectiveTo:     timestamp("effective_to"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type PayrollTaxConfig = typeof payrollTaxConfigs.$inferSelect;

export const payrollRuns = pgTable("payroll_runs", {
  id:                serial("id").primaryKey(),
  companyId:         integer("company_id").notNull().references(() => payrollCompanies.id),
  runReference:      varchar("run_reference", { length: 80 }).notNull().unique(),
  periodStart:       timestamp("period_start").notNull(),
  periodEnd:         timestamp("period_end").notNull(),
  payDate:           timestamp("pay_date").notNull(),
  frequency:         payrollFrequencyEnum("frequency").notNull(),
  status:            payrollRunStatusEnum("status").default("draft"),
  totalGrossUsd:     numeric("total_gross_usd",     { precision: 18, scale: 2 }).default("0"),
  totalTaxUsd:       numeric("total_tax_usd",       { precision: 18, scale: 2 }).default("0"),
  totalDeductUsd:    numeric("total_deduct_usd",    { precision: 18, scale: 2 }).default("0"),
  totalNetUsd:       numeric("total_net_usd",       { precision: 18, scale: 2 }).default("0"),
  totalFeeUsd:       numeric("total_fee_usd",       { precision: 18, scale: 2 }).default("0"),
  employeeCount:     integer("employee_count").default(0),
  approvedByUserId:  integer("approved_by_user_id").references(() => users.id),
  approvedAt:        timestamp("approved_at"),
  disbursedAt:       timestamp("disbursed_at"),
  notes:             text("notes"),
  engineResponse:    json("engine_response").$type<Record<string, unknown>>(),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});
export type PayrollRun = typeof payrollRuns.$inferSelect;

export const payrollRunItems = pgTable("payroll_run_items", {
  id:               serial("id").primaryKey(),
  runId:            integer("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId:       integer("employee_id").notNull().references(() => payrollEmployees.id),
  grossSalary:      numeric("gross_salary",     { precision: 18, scale: 2 }).notNull(),
  grossCurrency:    varchar("gross_currency",   { length: 8 }).notNull(),
  grossUsd:         numeric("gross_usd",        { precision: 18, scale: 2 }).notNull(),
  fxRate:           numeric("fx_rate",          { precision: 18, scale: 8 }).default("1"),
  incomeTax:        numeric("income_tax",       { precision: 18, scale: 2 }).default("0"),
  socialSecurity:   numeric("social_security",  { precision: 18, scale: 2 }).default("0"),
  pension:          numeric("pension",          { precision: 18, scale: 2 }).default("0"),
  nhf:              numeric("nhf",              { precision: 18, scale: 2 }).default("0"),
  nhis:             numeric("nhis",             { precision: 18, scale: 2 }).default("0"),
  otherDeductions:  numeric("other_deductions", { precision: 18, scale: 2 }).default("0"),
  totalDeductions:  numeric("total_deductions", { precision: 18, scale: 2 }).default("0"),
  netPay:           numeric("net_pay",          { precision: 18, scale: 2 }).notNull(),
  netCurrency:      varchar("net_currency",     { length: 8 }).notNull(),
  netUsd:           numeric("net_usd",          { precision: 18, scale: 2 }).notNull(),
  remitFee:         numeric("remit_fee",        { precision: 18, scale: 2 }).default("0"),
  status:           payrollItemStatusEnum("status").default("pending"),
  transactionId:    integer("transaction_id").references(() => transactions.id),
  disbursedAt:      timestamp("disbursed_at"),
  failureReason:    text("failure_reason"),
  taxBreakdown:     json("tax_breakdown").$type<Record<string, number>>(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type PayrollRunItem = typeof payrollRunItems.$inferSelect;

export const payrollDisbursements = pgTable("payroll_disbursements", {
  id:             serial("id").primaryKey(),
  runId:          integer("run_id").notNull().references(() => payrollRuns.id),
  batchReference: varchar("batch_reference", { length: 80 }).notNull(),
  rail:           varchar("rail", { length: 30 }).notNull(),
  currency:       varchar("currency", { length: 8 }).notNull(),
  totalAmount:    numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  itemCount:      integer("item_count").default(0),
  status:         varchar("status", { length: 20 }).default("pending"),
  externalRef:    varchar("external_ref", { length: 200 }),
  sentAt:         timestamp("sent_at"),
  settledAt:      timestamp("settled_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type PayrollDisbursement = typeof payrollDisbursements.$inferSelect;

// ============================================================
// DIASPORA BOND SUBSCRIPTION — May 2026
// ============================================================

export const bondTypeEnum         = pgEnum("bond_type",          ["fgn_diaspora", "eurobond", "corporate", "sukuk", "green_bond", "infrastructure"]);
export const bondStatusEnum       = pgEnum("bond_status",        ["upcoming", "open", "closed", "matured", "defaulted"]);
export const bondCouponFreqEnum   = pgEnum("bond_coupon_freq",   ["monthly", "quarterly", "semi_annual", "annual"]);
export const subStatusEnum        = pgEnum("subscription_status",["pending_payment", "active", "matured", "sold", "cancelled"]);
export const smOrderStatusEnum    = pgEnum("sm_order_status",    ["open", "matched", "cancelled", "expired"]);
export const smOrderTypeEnum      = pgEnum("sm_order_type",      ["sell", "buy"]);

export const diasporaBonds = pgTable("diaspora_bonds", {
  id:                serial("id").primaryKey(),
  isin:              varchar("isin", { length: 20 }).unique(),
  name:              varchar("name", { length: 300 }).notNull(),
  issuer:            varchar("issuer", { length: 200 }).notNull(),
  bondType:          bondTypeEnum("bond_type").notNull(),
  currency:          varchar("currency", { length: 8 }).default("USD"),
  faceValue:         numeric("face_value",        { precision: 18, scale: 2 }).notNull(),
  minSubscription:   numeric("min_subscription",  { precision: 18, scale: 2 }).default("500"),
  maxSubscription:   numeric("max_subscription",  { precision: 18, scale: 2 }),
  couponRate:        numeric("coupon_rate",        { precision: 6, scale: 4 }).notNull(),
  couponFrequency:   bondCouponFreqEnum("coupon_frequency").default("semi_annual"),
  issueDate:         timestamp("issue_date").notNull(),
  maturityDate:      timestamp("maturity_date").notNull(),
  offerOpenDate:     timestamp("offer_open_date").notNull(),
  offerCloseDate:    timestamp("offer_close_date").notNull(),
  targetRaise:       numeric("target_raise",       { precision: 18, scale: 2 }),
  raisedAmount:      numeric("raised_amount",      { precision: 18, scale: 2 }).default("0"),
  totalUnits:        integer("total_units"),
  availableUnits:    integer("available_units"),
  status:            bondStatusEnum("status").default("upcoming"),
  ratingAgency:      varchar("rating_agency",      { length: 50 }),
  creditRating:      varchar("credit_rating",      { length: 10 }),
  prospectusUrl:     text("prospectus_url"),
  imageUrl:          text("image_url"),
  description:       text("description"),
  eligibleCountries: json("eligible_countries").$type<string[]>().default([]),
  isTaxExempt:       boolean("is_tax_exempt").default(false),
  yieldToMaturity:   numeric("yield_to_maturity",  { precision: 6, scale: 4 }),
  duration:          numeric("duration",           { precision: 8, scale: 4 }),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});
export type DiasporaBond = typeof diasporaBonds.$inferSelect;

export const bondSubscriptions = pgTable("bond_subscriptions", {
  id:                  serial("id").primaryKey(),
  userId:              integer("user_id").notNull().references(() => users.id),
  bondId:              integer("bond_id").notNull().references(() => diasporaBonds.id),
  subscriptionRef:     varchar("subscription_ref", { length: 80 }).notNull().unique(),
  units:               integer("units").notNull(),
  faceValue:           numeric("face_value",          { precision: 18, scale: 2 }).notNull(),
  purchasePrice:       numeric("purchase_price",       { precision: 18, scale: 2 }).notNull(),
  totalPaid:           numeric("total_paid",           { precision: 18, scale: 2 }).notNull(),
  currency:            varchar("currency",             { length: 8 }).default("USD"),
  status:              subStatusEnum("status").default("pending_payment"),
  transactionId:       integer("transaction_id").references(() => transactions.id),
  totalCouponsReceived:numeric("total_coupons_received",{ precision: 18, scale: 2 }).default("0"),
  maturityProceeds:    numeric("maturity_proceeds",    { precision: 18, scale: 2 }),
  accruedInterest:     numeric("accrued_interest",     { precision: 18, scale: 2 }).default("0"),
  currentValue:        numeric("current_value",        { precision: 18, scale: 2 }),
  yieldAtPurchase:     numeric("yield_at_purchase",    { precision: 6, scale: 4 }),
  purchasedAt:         timestamp("purchased_at").defaultNow().notNull(),
  maturedAt:           timestamp("matured_at"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});
export type BondSubscription = typeof bondSubscriptions.$inferSelect;

export const bondCouponPayments = pgTable("bond_coupon_payments", {
  id:               serial("id").primaryKey(),
  subscriptionId:   integer("subscription_id").notNull().references(() => bondSubscriptions.id, { onDelete: "cascade" }),
  bondId:           integer("bond_id").notNull().references(() => diasporaBonds.id),
  userId:           integer("user_id").notNull().references(() => users.id),
  couponNumber:     integer("coupon_number").notNull(),
  periodStart:      timestamp("period_start").notNull(),
  periodEnd:        timestamp("period_end").notNull(),
  scheduledDate:    timestamp("scheduled_date").notNull(),
  paidDate:         timestamp("paid_date"),
  grossAmount:      numeric("gross_amount",  { precision: 18, scale: 2 }).notNull(),
  withholdingTax:   numeric("withholding_tax",{ precision: 18, scale: 2 }).default("0"),
  netAmount:        numeric("net_amount",    { precision: 18, scale: 2 }).notNull(),
  currency:         varchar("currency",      { length: 8 }).default("USD"),
  status:           varchar("status",        { length: 20 }).default("scheduled"),
  transactionId:    integer("transaction_id").references(() => transactions.id),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});
export type BondCouponPayment = typeof bondCouponPayments.$inferSelect;

export const bondSecondaryMarketOrders = pgTable("bond_secondary_market_orders", {
  id:               serial("id").primaryKey(),
  subscriptionId:   integer("subscription_id").notNull().references(() => bondSubscriptions.id),
  sellerId:         integer("seller_id").notNull().references(() => users.id),
  buyerId:          integer("buyer_id").references(() => users.id),
  bondId:           integer("bond_id").notNull().references(() => diasporaBonds.id),
  orderType:        smOrderTypeEnum("order_type").default("sell"),
  units:            integer("units").notNull(),
  askPrice:         numeric("ask_price",    { precision: 18, scale: 2 }).notNull(),
  bidPrice:         numeric("bid_price",    { precision: 18, scale: 2 }),
  matchedPrice:     numeric("matched_price",{ precision: 18, scale: 2 }),
  totalValue:       numeric("total_value",  { precision: 18, scale: 2 }),
  currency:         varchar("currency",     { length: 8 }).default("USD"),
  status:           smOrderStatusEnum("status").default("open"),
  expiresAt:        timestamp("expires_at"),
  matchedAt:        timestamp("matched_at"),
  settlementTxId:   integer("settlement_tx_id").references(() => transactions.id),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type BondSecondaryMarketOrder = typeof bondSecondaryMarketOrders.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — CONTRACTOR PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────
export const contractorStatusEnum = pgEnum("contractor_status", ["active", "inactive", "suspended"]);
export const contractorInvoiceStatusEnum = pgEnum("contractor_invoice_status", [
  "draft", "submitted", "approved", "rejected", "paid", "cancelled"
]);

export const contractors = pgTable("contractors", {
  id:              serial("id").primaryKey(),
  ownerId:         integer("owner_id").notNull().references(() => users.id),
  companyId:       integer("company_id").references(() => payrollCompanies.id),
  fullName:        varchar("full_name", { length: 200 }).notNull(),
  email:           varchar("email", { length: 255 }).notNull(),
  phone:           varchar("phone", { length: 30 }),
  country:         varchar("country", { length: 4 }).notNull(),
  currency:        varchar("currency", { length: 8 }).default("USD").notNull(),
  bankName:        varchar("bank_name", { length: 200 }),
  bankAccount:     varchar("bank_account", { length: 100 }),
  bankRoutingCode: varchar("bank_routing_code", { length: 50 }),
  taxId:           varchar("tax_id", { length: 100 }),
  specialty:       varchar("specialty", { length: 200 }),
  hourlyRateUsd:   numeric("hourly_rate_usd", { precision: 10, scale: 2 }),
  status:          contractorStatusEnum("status").default("active"),
  kycVerified:     boolean("kyc_verified").default(false),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});
export type Contractor = typeof contractors.$inferSelect;

export const contractorInvoices = pgTable("contractor_invoices", {
  id:              serial("id").primaryKey(),
  contractorId:    integer("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  ownerId:         integer("owner_id").notNull().references(() => users.id),
  invoiceNumber:   varchar("invoice_number", { length: 50 }).notNull().unique(),
  description:     text("description").notNull(),
  lineItems:       json("line_items").$type<Array<{ description: string; quantity: number; unitPrice: number; total: number }>>().default([]),
  subtotalUsd:     numeric("subtotal_usd", { precision: 18, scale: 2 }).notNull(),
  taxAmountUsd:    numeric("tax_amount_usd", { precision: 18, scale: 2 }).default("0"),
  totalUsd:        numeric("total_usd", { precision: 18, scale: 2 }).notNull(),
  currency:        varchar("currency", { length: 8 }).default("USD").notNull(),
  dueDate:         timestamp("due_date"),
  paidAt:          timestamp("paid_at"),
  status:          contractorInvoiceStatusEnum("status").default("draft"),
  rejectionReason: text("rejection_reason"),
  paymentRef:      varchar("payment_ref", { length: 100 }),
  attachmentUrl:   text("attachment_url"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});
export type ContractorInvoice = typeof contractorInvoices.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — BUSINESS EXPENSE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
export const expenseCategoryEnum = pgEnum("expense_category", [
  "travel", "accommodation", "meals", "equipment", "software", "marketing",
  "professional_services", "utilities", "office_supplies", "training", "other"
]);
export const expenseStatusEnum = pgEnum("expense_status", [
  "draft", "submitted", "under_review", "approved", "rejected", "reimbursed"
]);
export const expensePolicyActionEnum = pgEnum("expense_policy_action", ["auto_approve", "require_review", "reject"]);

export const expensePolicies = pgTable("expense_policies", {
  id:              serial("id").primaryKey(),
  companyId:       integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  name:            varchar("name", { length: 200 }).notNull(),
  category:        expenseCategoryEnum("category").notNull(),
  maxAmountUsd:    numeric("max_amount_usd", { precision: 10, scale: 2 }).notNull(),
  requiresReceipt: boolean("requires_receipt").default(true),
  action:          expensePolicyActionEnum("action").default("require_review"),
  isActive:        boolean("is_active").default(true),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type ExpensePolicy = typeof expensePolicies.$inferSelect;

export const expenseReports = pgTable("expense_reports", {
  id:              serial("id").primaryKey(),
  companyId:       integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  submittedBy:     integer("submitted_by").notNull().references(() => users.id),
  approvedBy:      integer("approved_by").references(() => users.id),
  title:           varchar("title", { length: 300 }).notNull(),
  description:     text("description"),
  totalAmountUsd:  numeric("total_amount_usd", { precision: 18, scale: 2 }).default("0"),
  currency:        varchar("currency", { length: 8 }).default("USD"),
  status:          expenseStatusEnum("status").default("draft"),
  rejectionReason: text("rejection_reason"),
  reimbursedAt:    timestamp("reimbursed_at"),
  paymentRef:      varchar("payment_ref", { length: 100 }),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});
export type ExpenseReport = typeof expenseReports.$inferSelect;

export const expenseItems = pgTable("expense_items", {
  id:            serial("id").primaryKey(),
  reportId:      integer("report_id").notNull().references(() => expenseReports.id, { onDelete: "cascade" }),
  category:      expenseCategoryEnum("category").notNull(),
  description:   varchar("description", { length: 500 }).notNull(),
  amountUsd:     numeric("amount_usd", { precision: 10, scale: 2 }).notNull(),
  currency:      varchar("currency", { length: 8 }).default("USD"),
  expenseDate:   timestamp("expense_date").notNull(),
  receiptUrl:    text("receipt_url"),
  merchantName:  varchar("merchant_name", { length: 200 }),
  policyId:      integer("policy_id").references(() => expensePolicies.id),
  autoApproved:  boolean("auto_approved").default(false),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
export type ExpenseItem = typeof expenseItems.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — MERCHANT KYB REVIEW
// ─────────────────────────────────────────────────────────────────────────────
export const merchantKybStatusEnum = pgEnum("merchant_kyb_status", [
  "pending", "documents_requested", "under_review", "approved", "rejected", "suspended"
]);

export const merchantKybReviews = pgTable("merchant_kyb_reviews", {
  id:                  serial("id").primaryKey(),
  userId:              integer("user_id").notNull().references(() => users.id),
  businessName:        varchar("business_name", { length: 300 }).notNull(),
  registrationNumber:  varchar("registration_number", { length: 100 }),
  taxId:               varchar("tax_id", { length: 100 }),
  country:             varchar("country", { length: 4 }).notNull(),
  industry:            varchar("industry", { length: 100 }),
  website:             varchar("website", { length: 300 }),
  expectedMonthlyVol:  numeric("expected_monthly_vol", { precision: 18, scale: 2 }),
  businessRegDocUrl:   text("business_reg_doc_url"),
  directorIdDocUrl:    text("director_id_doc_url"),
  bankStatementDocUrl: text("bank_statement_doc_url"),
  amlPolicyDocUrl:     text("aml_policy_doc_url"),
  status:              merchantKybStatusEnum("status").default("pending"),
  reviewedBy:          integer("reviewed_by").references(() => users.id),
  reviewedAt:          timestamp("reviewed_at"),
  rejectionReason:     text("rejection_reason"),
  riskRating:          varchar("risk_rating", { length: 20 }).default("medium"),
  notes:               text("notes"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});
export type MerchantKybReview = typeof merchantKybReviews.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — INVOICE FINANCING
// ─────────────────────────────────────────────────────────────────────────────
export const invoiceFinancingStatusEnum = pgEnum("invoice_financing_status", [
  "draft", "submitted", "under_review", "approved", "funded", "repaying", "repaid", "defaulted", "rejected"
]);

export const invoiceFinancingApplications = pgTable("invoice_financing_applications", {
  id:                serial("id").primaryKey(),
  applicantId:       integer("applicant_id").notNull().references(() => users.id),
  invoiceNumber:     varchar("invoice_number", { length: 100 }).notNull(),
  debtorName:        varchar("debtor_name", { length: 300 }).notNull(),
  debtorCountry:     varchar("debtor_country", { length: 4 }),
  invoiceAmountUsd:  numeric("invoice_amount_usd", { precision: 18, scale: 2 }).notNull(),
  advanceRatePct:    numeric("advance_rate_pct", { precision: 5, scale: 2 }).default("80"),
  advanceAmountUsd:  numeric("advance_amount_usd", { precision: 18, scale: 2 }),
  feeRatePct:        numeric("fee_rate_pct", { precision: 5, scale: 2 }).default("2.5"),
  feeAmountUsd:      numeric("fee_amount_usd", { precision: 18, scale: 2 }),
  invoiceDueDate:    timestamp("invoice_due_date").notNull(),
  invoiceDocUrl:     text("invoice_doc_url"),
  contractDocUrl:    text("contract_doc_url"),
  status:            invoiceFinancingStatusEnum("status").default("draft"),
  fundedAt:          timestamp("funded_at"),
  repaidAt:          timestamp("repaid_at"),
  reviewedBy:        integer("reviewed_by").references(() => users.id),
  rejectionReason:   text("rejection_reason"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});
export type InvoiceFinancingApplication = typeof invoiceFinancingApplications.$inferSelect;

export const invoiceFinancingRepayments = pgTable("invoice_financing_repayments", {
  id:             serial("id").primaryKey(),
  applicationId:  integer("application_id").notNull().references(() => invoiceFinancingApplications.id, { onDelete: "cascade" }),
  amountUsd:      numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  paymentRef:     varchar("payment_ref", { length: 100 }),
  paidAt:         timestamp("paid_at").defaultNow().notNull(),
  notes:          text("notes"),
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — SUPPLY CHAIN FINANCE / LETTER OF CREDIT
// ─────────────────────────────────────────────────────────────────────────────
export const lcTypeEnum = pgEnum("lc_type", ["sight", "usance", "standby", "revolving"]);
export const lcStatusEnum = pgEnum("lc_status", [
  "draft", "submitted", "issued", "advised", "documents_presented",
  "documents_checked", "payment_authorised", "settled", "expired", "cancelled"
]);

export const lettersOfCredit = pgTable("letters_of_credit", {
  id:                 serial("id").primaryKey(),
  applicantId:        integer("applicant_id").notNull().references(() => users.id),
  lcNumber:           varchar("lc_number", { length: 50 }).notNull().unique(),
  lcType:             lcTypeEnum("lc_type").default("sight"),
  beneficiaryName:    varchar("beneficiary_name", { length: 300 }).notNull(),
  beneficiaryCountry: varchar("beneficiary_country", { length: 4 }).notNull(),
  beneficiaryBank:    varchar("beneficiary_bank", { length: 300 }),
  issuingBank:        varchar("issuing_bank", { length: 300 }).default("RemitFlow Trade Finance"),
  amountUsd:          numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  currency:           varchar("currency", { length: 8 }).default("USD"),
  goodsDescription:   text("goods_description").notNull(),
  shipmentPort:       varchar("shipment_port", { length: 200 }),
  destinationPort:    varchar("destination_port", { length: 200 }),
  latestShipDate:     timestamp("latest_ship_date"),
  expiryDate:         timestamp("expiry_date").notNull(),
  incoterms:          varchar("incoterms", { length: 20 }).default("CIF"),
  documentsRequired:  json("documents_required").$type<string[]>().default([]),
  status:             lcStatusEnum("status").default("draft"),
  issuedAt:           timestamp("issued_at"),
  settledAt:          timestamp("settled_at"),
  collateralPct:      numeric("collateral_pct", { precision: 5, scale: 2 }).default("10"),
  feeAmountUsd:       numeric("fee_amount_usd", { precision: 18, scale: 2 }),
  reviewedBy:         integer("reviewed_by").references(() => users.id),
  rejectionReason:    text("rejection_reason"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
});
export type LetterOfCredit = typeof lettersOfCredit.$inferSelect;

export const lcDocuments = pgTable("lc_documents", {
  id:            serial("id").primaryKey(),
  lcId:          integer("lc_id").notNull().references(() => lettersOfCredit.id, { onDelete: "cascade" }),
  documentType:  varchar("document_type", { length: 100 }).notNull(),
  documentUrl:   text("document_url").notNull(),
  uploadedBy:    integer("uploaded_by").notNull().references(() => users.id),
  verified:      boolean("verified").default(false),
  verifiedBy:    integer("verified_by").references(() => users.id),
  verifiedAt:    timestamp("verified_at"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — MULTI-ENTITY TREASURY
// ─────────────────────────────────────────────────────────────────────────────
export const entityGroupStatusEnum = pgEnum("entity_group_status", ["active", "suspended", "dissolved"]);
export const intercompanyTransferStatusEnum = pgEnum("intercompany_transfer_status", [
  "pending", "approved", "processing", "completed", "failed", "cancelled"
]);

export const entityGroups = pgTable("entity_groups", {
  id:           serial("id").primaryKey(),
  ownerId:      integer("owner_id").notNull().references(() => users.id),
  name:         varchar("name", { length: 300 }).notNull(),
  description:  text("description"),
  baseCurrency: varchar("base_currency", { length: 8 }).default("USD"),
  status:       entityGroupStatusEnum("status").default("active"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});
export type EntityGroup = typeof entityGroups.$inferSelect;

export const entityGroupMembers = pgTable("entity_group_members", {
  id:        serial("id").primaryKey(),
  groupId:   integer("group_id").notNull().references(() => entityGroups.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  role:      varchar("role", { length: 50 }).default("subsidiary"),
  addedAt:   timestamp("added_at").defaultNow().notNull(),
});

export const intercompanyTransfers = pgTable("intercompany_transfers", {
  id:            serial("id").primaryKey(),
  groupId:       integer("group_id").notNull().references(() => entityGroups.id),
  fromCompanyId: integer("from_company_id").notNull().references(() => payrollCompanies.id),
  toCompanyId:   integer("to_company_id").notNull().references(() => payrollCompanies.id),
  amountUsd:     numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  fromCurrency:  varchar("from_currency", { length: 8 }).notNull(),
  toCurrency:    varchar("to_currency", { length: 8 }).notNull(),
  fxRate:        numeric("fx_rate", { precision: 18, scale: 8 }),
  purpose:       varchar("purpose", { length: 300 }),
  status:        intercompanyTransferStatusEnum("status").default("pending"),
  approvedBy:    integer("approved_by").references(() => users.id),
  approvedAt:    timestamp("approved_at"),
  completedAt:   timestamp("completed_at"),
  paymentRef:    varchar("payment_ref", { length: 100 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});
export type IntercompanyTransfer = typeof intercompanyTransfers.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — PAYROLL TAX FILING
// ─────────────────────────────────────────────────────────────────────────────
export const taxFilingStatusEnum = pgEnum("tax_filing_status", [
  "draft", "calculated", "submitted", "acknowledged", "accepted", "rejected", "amended"
]);
export const taxAuthorityEnum = pgEnum("tax_authority", ["FIRS", "HMRC", "IRS", "KRA", "GRA", "SARS", "OTHER"]);

export const payrollTaxFilings = pgTable("payroll_tax_filings", {
  id:               serial("id").primaryKey(),
  companyId:        integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  payrollRunId:     integer("payroll_run_id").references(() => payrollRuns.id),
  taxAuthority:     taxAuthorityEnum("tax_authority").notNull(),
  jurisdiction:     varchar("jurisdiction", { length: 4 }).notNull(),
  periodStart:      timestamp("period_start").notNull(),
  periodEnd:        timestamp("period_end").notNull(),
  totalGrossUsd:    numeric("total_gross_usd", { precision: 18, scale: 2 }).notNull(),
  totalTaxUsd:      numeric("total_tax_usd", { precision: 18, scale: 2 }).notNull(),
  totalPensionUsd:  numeric("total_pension_usd", { precision: 18, scale: 2 }).default("0"),
  employeeCount:    integer("employee_count").notNull(),
  filingReference:  varchar("filing_reference", { length: 100 }),
  submittedAt:      timestamp("submitted_at"),
  acknowledgedAt:   timestamp("acknowledged_at"),
  status:           taxFilingStatusEnum("status").default("draft"),
  filingDocUrl:     text("filing_doc_url"),
  receiptUrl:       text("receipt_url"),
  rejectionReason:  text("rejection_reason"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type PayrollTaxFiling = typeof payrollTaxFilings.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — BUSINESS SAVINGS / FIXED DEPOSIT
// ─────────────────────────────────────────────────────────────────────────────
export const businessSavingsTypeEnum = pgEnum("business_savings_type", [
  "instant_access", "notice_30_day", "fixed_30", "fixed_90", "fixed_180", "fixed_365"
]);
export const businessSavingsStatusEnum = pgEnum("business_savings_status", [
  "active", "matured", "withdrawn", "cancelled"
]);

export const businessSavingsProducts = pgTable("business_savings_products", {
  id:            serial("id").primaryKey(),
  name:          varchar("name", { length: 200 }).notNull(),
  type:          businessSavingsTypeEnum("type").notNull(),
  currency:      varchar("currency", { length: 8 }).default("USD"),
  annualRatePct: numeric("annual_rate_pct", { precision: 5, scale: 2 }).notNull(),
  minDepositUsd: numeric("min_deposit_usd", { precision: 18, scale: 2 }).default("1000"),
  maxDepositUsd: numeric("max_deposit_usd", { precision: 18, scale: 2 }).default("10000000"),
  termDays:      integer("term_days"),
  isActive:      boolean("is_active").default(true),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
export type BusinessSavingsProduct = typeof businessSavingsProducts.$inferSelect;

export const businessSavingsAccounts = pgTable("business_savings_accounts", {
  id:                  serial("id").primaryKey(),
  companyId:           integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  ownerId:             integer("owner_id").notNull().references(() => users.id),
  productId:           integer("product_id").notNull().references(() => businessSavingsProducts.id),
  principalUsd:        numeric("principal_usd", { precision: 18, scale: 2 }).notNull(),
  currentBalanceUsd:   numeric("current_balance_usd", { precision: 18, scale: 2 }).notNull(),
  accruedInterestUsd:  numeric("accrued_interest_usd", { precision: 18, scale: 2 }).default("0"),
  startDate:           timestamp("start_date").notNull(),
  maturityDate:        timestamp("maturity_date"),
  lastInterestDate:    timestamp("last_interest_date"),
  status:              businessSavingsStatusEnum("status").default("active"),
  autoRenew:           boolean("auto_renew").default(false),
  withdrawnAt:         timestamp("withdrawn_at"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});
export type BusinessSavingsAccount = typeof businessSavingsAccounts.$inferSelect;

export const businessSavingsTxns = pgTable("business_savings_txns", {
  id:           serial("id").primaryKey(),
  accountId:    integer("account_id").notNull().references(() => businessSavingsAccounts.id, { onDelete: "cascade" }),
  type:         varchar("type", { length: 30 }).notNull(),
  amountUsd:    numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }).notNull(),
  description:  varchar("description", { length: 300 }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3 — EMBEDDED PAYROLL API
// ─────────────────────────────────────────────────────────────────────────────
export const embeddedPayrollApiKeyStatusEnum = pgEnum("embedded_payroll_api_key_status", ["active", "revoked", "expired"]);

export const embeddedPayrollApiKeys = pgTable("embedded_payroll_api_keys", {
  id:          serial("id").primaryKey(),
  tenantId:    integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  keyHash:     varchar("key_hash", { length: 128 }).notNull().unique(),
  keyPrefix:   varchar("key_prefix", { length: 12 }).notNull(),
  label:       varchar("label", { length: 200 }),
  environment: varchar("environment", { length: 10 }).default("sandbox"),
  status:      embeddedPayrollApiKeyStatusEnum("status").default("active"),
  lastUsedAt:  timestamp("last_used_at"),
  expiresAt:   timestamp("expires_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
export type EmbeddedPayrollApiKey = typeof embeddedPayrollApiKeys.$inferSelect;

export const embeddedPayrollRequests = pgTable("embedded_payroll_requests", {
  id:             serial("id").primaryKey(),
  tenantId:       integer("tenant_id").notNull().references(() => tenants.id),
  apiKeyId:       integer("api_key_id").notNull().references(() => embeddedPayrollApiKeys.id),
  externalRunId:  varchar("external_run_id", { length: 100 }),
  companyName:    varchar("company_name", { length: 200 }).notNull(),
  employeeCount:  integer("employee_count").notNull(),
  totalAmountUsd: numeric("total_amount_usd", { precision: 18, scale: 2 }).notNull(),
  currency:       varchar("currency", { length: 8 }).default("USD"),
  payloadHash:    varchar("payload_hash", { length: 128 }),
  status:         varchar("status", { length: 30 }).default("received"),
  processedAt:    timestamp("processed_at"),
  errorMessage:   text("error_message"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type EmbeddedPayrollRequest = typeof embeddedPayrollRequests.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3 — DIASPORA MORTGAGE / PROPERTY FINANCE
// ─────────────────────────────────────────────────────────────────────────────
export const mortgageStatusEnum = pgEnum("mortgage_status", [
  "enquiry", "application", "under_review", "conditionally_approved",
  "approved", "offer_issued", "completed", "active", "defaulted", "closed"
]);
export const mortgageTypeEnum = pgEnum("mortgage_type", [
  "purchase", "remortgage", "equity_release", "buy_to_let", "diaspora_home_build"
]);

export const mortgageApplications = pgTable("mortgage_applications", {
  id:                serial("id").primaryKey(),
  applicantId:       integer("applicant_id").notNull().references(() => users.id),
  mortgageType:      mortgageTypeEnum("mortgage_type").default("purchase"),
  propertyCountry:   varchar("property_country", { length: 4 }).notNull(),
  propertyAddress:   text("property_address"),
  propertyValueUsd:  numeric("property_value_usd", { precision: 18, scale: 2 }).notNull(),
  loanAmountUsd:     numeric("loan_amount_usd", { precision: 18, scale: 2 }).notNull(),
  depositAmountUsd:  numeric("deposit_amount_usd", { precision: 18, scale: 2 }).notNull(),
  ltvPct:            numeric("ltv_pct", { precision: 5, scale: 2 }),
  termYears:         integer("term_years").notNull(),
  interestRatePct:   numeric("interest_rate_pct", { precision: 5, scale: 2 }),
  monthlyPaymentUsd: numeric("monthly_payment_usd", { precision: 18, scale: 2 }),
  applicantCountry:  varchar("applicant_country", { length: 4 }),
  annualIncomeUsd:   numeric("annual_income_usd", { precision: 18, scale: 2 }),
  employmentStatus:  varchar("employment_status", { length: 50 }),
  creditScore:       integer("credit_score"),
  status:            mortgageStatusEnum("status").default("enquiry"),
  assignedAdvisorId: integer("assigned_advisor_id").references(() => users.id),
  offerExpiresAt:    timestamp("offer_expires_at"),
  completedAt:       timestamp("completed_at"),
  rejectionReason:   text("rejection_reason"),
  notes:             text("notes"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});
export type MortgageApplication = typeof mortgageApplications.$inferSelect;

export const mortgageRepayments = pgTable("mortgage_repayments", {
  id:              serial("id").primaryKey(),
  applicationId:   integer("application_id").notNull().references(() => mortgageApplications.id, { onDelete: "cascade" }),
  dueDate:         timestamp("due_date").notNull(),
  paidDate:        timestamp("paid_date"),
  principalUsd:    numeric("principal_usd", { precision: 18, scale: 2 }).notNull(),
  interestUsd:     numeric("interest_usd", { precision: 18, scale: 2 }).notNull(),
  totalUsd:        numeric("total_usd", { precision: 18, scale: 2 }).notNull(),
  balanceAfterUsd: numeric("balance_after_usd", { precision: 18, scale: 2 }),
  status:          varchar("status", { length: 20 }).default("pending"),
  paymentRef:      varchar("payment_ref", { length: 100 }),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type MortgageRepayment = typeof mortgageRepayments.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3 — BUSINESS CREDIT SCORING
// ─────────────────────────────────────────────────────────────────────────────
export const creditScoreStatusEnum = pgEnum("credit_score_status", ["pending", "calculated", "expired", "disputed"]);
export const creditApplicationStatusEnum = pgEnum("credit_application_status", [
  "draft", "submitted", "scoring", "approved", "rejected", "disbursed", "repaid", "defaulted"
]);

export const businessCreditScores = pgTable("business_credit_scores", {
  id:                 serial("id").primaryKey(),
  companyId:          integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  score:              integer("score").notNull(),
  grade:              varchar("grade", { length: 5 }).notNull(),
  transactionVolume:  numeric("transaction_volume", { precision: 18, scale: 2 }),
  avgMonthlyVolume:   numeric("avg_monthly_volume", { precision: 18, scale: 2 }),
  payrollConsistency: numeric("payroll_consistency", { precision: 5, scale: 2 }),
  kybScore:           integer("kyb_score"),
  paymentHistory:     numeric("payment_history", { precision: 5, scale: 2 }),
  utilizationRatio:   numeric("utilization_ratio", { precision: 5, scale: 2 }),
  accountAge:         integer("account_age"),
  maxCreditLimitUsd:  numeric("max_credit_limit_usd", { precision: 18, scale: 2 }),
  status:             creditScoreStatusEnum("status").default("pending"),
  calculatedAt:       timestamp("calculated_at"),
  expiresAt:          timestamp("expires_at"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
});
export type BusinessCreditScore = typeof businessCreditScores.$inferSelect;

export const creditApplications = pgTable("credit_applications", {
  id:              serial("id").primaryKey(),
  companyId:       integer("company_id").notNull().references(() => payrollCompanies.id, { onDelete: "cascade" }),
  applicantId:     integer("applicant_id").notNull().references(() => users.id),
  creditScoreId:   integer("credit_score_id").references(() => businessCreditScores.id),
  requestedUsd:    numeric("requested_usd", { precision: 18, scale: 2 }).notNull(),
  approvedUsd:     numeric("approved_usd", { precision: 18, scale: 2 }),
  interestRatePct: numeric("interest_rate_pct", { precision: 5, scale: 2 }),
  termMonths:      integer("term_months"),
  purpose:         varchar("purpose", { length: 300 }),
  status:          creditApplicationStatusEnum("status").default("draft"),
  disbursedAt:     timestamp("disbursed_at"),
  repaidAt:        timestamp("repaid_at"),
  rejectionReason: text("rejection_reason"),
  reviewedBy:      integer("reviewed_by").references(() => users.id),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});
export type CreditApplication = typeof creditApplications.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3 — CARBON CREDIT / ESG REPORTING
// ─────────────────────────────────────────────────────────────────────────────
export const esgReports = pgTable("esg_reports", {
  id:                      serial("id").primaryKey(),
  ownerId:                 integer("owner_id").notNull().references(() => users.id),
  reportingPeriod:         varchar("reporting_period", { length: 20 }).notNull(),
  totalRemittanceUsd:      numeric("total_remittance_usd", { precision: 18, scale: 2 }),
  co2OffsetKg:             numeric("co2_offset_kg", { precision: 18, scale: 2 }),
  financialInclusionCount: integer("financial_inclusion_count"),
  womenBeneficiaries:      integer("women_beneficiaries"),
  ruralReach:              integer("rural_reach"),
  jobsSupported:           integer("jobs_supported"),
  sdgGoals:                json("sdg_goals").$type<number[]>().default([]),
  carbonCertUrl:           text("carbon_cert_url"),
  publishedAt:             timestamp("published_at"),
  createdAt:               timestamp("created_at").defaultNow().notNull(),
  updatedAt:               timestamp("updated_at").defaultNow().notNull(),
});
export type EsgReport = typeof esgReports.$inferSelect;

export const carbonCredits = pgTable("carbon_credits", {
  id:               serial("id").primaryKey(),
  ownerId:          integer("owner_id").notNull().references(() => users.id),
  creditType:       varchar("credit_type", { length: 50 }).default("VCS"),
  vintageYear:      integer("vintage_year"),
  quantityTonnes:   numeric("quantity_tonnes", { precision: 10, scale: 3 }).notNull(),
  pricePerTonneUsd: numeric("price_per_tonne_usd", { precision: 10, scale: 2 }),
  totalValueUsd:    numeric("total_value_usd", { precision: 18, scale: 2 }),
  registryId:       varchar("registry_id", { length: 100 }),
  projectName:      varchar("project_name", { length: 300 }),
  projectCountry:   varchar("project_country", { length: 4 }),
  status:           varchar("status", { length: 20 }).default("active"),
  retiredAt:        timestamp("retired_at"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});
export type CarbonCredit = typeof carbonCredits.$inferSelect;

// ─── KYC Liveness Audit ───────────────────────────────────────────────────────
// Stores per-submission liveness pipeline results for compliance audit trail.
// Written by livenessCheckActivity (Temporal) and the extractDocument tRPC procedure.
export const kycLivenessAudit = pgTable("kyc_liveness_audit", {
  id:                    serial("id").primaryKey(),
  userId:                integer("user_id").notNull().references(() => users.id),
  kycDocId:              integer("kyc_doc_id").references(() => kycDocuments.id),
  // Layer 1: Passive liveness
  passiveScore:          numeric("passive_score", { precision: 5, scale: 4 }),
  passivePassed:         boolean("passive_passed"),
  passiveSpoofingType:   varchar("passive_spoofing_type", { length: 50 }),
  // Layer 2: Active liveness (video)
  activeBlinkCount:      integer("active_blink_count"),
  activeHeadMovementDeg: numeric("active_head_movement_deg", { precision: 6, scale: 2 }),
  activePassed:          boolean("active_passed"),
  // Layer 3: Deepfake detection
  deepfakeScore:         numeric("deepfake_score", { precision: 5, scale: 4 }),
  deepfakeMethod:        varchar("deepfake_method", { length: 100 }),
  deepfakeIndicators:    json("deepfake_indicators").$type<string[]>(),
  deepfakePassed:        boolean("deepfake_passed"),
  // Corridor: ISO-3166-1 alpha-2/3 country code of the sender
  corridorCode:          varchar("corridor_code", { length: 5 }).default(""),
  // Overall result
  overallLive:           boolean("overall_live").notNull().default(false),
  // Source: "temporal_workflow" | "trpc_extract" | "manual_review"
  source:                varchar("source", { length: 30 }).default("trpc_extract"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("kyc_liveness_audit_user_idx").on(t.userId),
  index("kyc_liveness_audit_doc_idx").on(t.kycDocId),
  index("kyc_liveness_audit_created_idx").on(t.createdAt),
]);
export type KycLivenessAudit = typeof kycLivenessAudit.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Property Escrow System — Diaspora Property Purchase with Milestone Protection
// ═══════════════════════════════════════════════════════════════════════════════

export const builderProfiles = pgTable("builder_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  companyName: varchar("company_name", { length: 300 }).notNull(),
  cacRegistrationNo: varchar("cac_registration_no", { length: 50 }),
  cacVerified: boolean("cac_verified").default(false),
  directorNames: json("director_names").$type<string[]>().default([]),
  directorIdsVerified: boolean("director_ids_verified").default(false),
  registeredAddress: text("registered_address"),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 200 }),
  website: varchar("website", { length: 300 }),
  yearsInOperation: integer("years_in_operation").default(0),
  projectsCompleted: integer("projects_completed").default(0),
  projectsInProgress: integer("projects_in_progress").default(0),
  averageRating: numeric("average_rating", { precision: 3, scale: 2 }).default("0.00"),
  totalReviews: integer("total_reviews").default(0),
  financialHealthScore: numeric("financial_health_score", { precision: 5, scale: 2 }),
  insurancePolicyNo: varchar("insurance_policy_no", { length: 100 }),
  insuranceVerified: boolean("insurance_verified").default(false),
  kybStatus: varchar("kyb_status", { length: 20 }).default("pending"),
  kybSubmittedAt: timestamp("kyb_submitted_at"),
  kybVerifiedAt: timestamp("kyb_verified_at"),
  kybRejectionReason: text("kyb_rejection_reason"),
  documents: json("documents").$type<{ name: string; url: string; type: string }[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_builder_profiles_user").on(t.userId),
  index("idx_builder_profiles_status").on(t.kybStatus),
]);
export type BuilderProfile = typeof builderProfiles.$inferSelect;

export const propertyEscrowPlans = pgTable("property_escrow_plans", {
  id: serial("id").primaryKey(),
  planId: varchar("plan_id", { length: 50 }).unique().notNull(),
  buyerId: integer("buyer_id").notNull().references(() => users.id),
  builderId: integer("builder_id").notNull().references(() => builderProfiles.id),
  listingId: integer("listing_id").notNull().references(() => realEstateListings.id),
  totalPriceNgn: numeric("total_price_ngn", { precision: 24, scale: 2 }).notNull(),
  totalPriceUsd: numeric("total_price_usd", { precision: 18, scale: 2 }).notNull(),
  depositPct: numeric("deposit_pct", { precision: 5, scale: 2 }).default("10.00"),
  depositPaid: boolean("deposit_paid").default(false),
  paymentCurrency: varchar("payment_currency", { length: 10 }).default("GBP"),
  installmentCount: integer("installment_count").notNull(),
  installmentAmount: numeric("installment_amount", { precision: 18, scale: 2 }).notNull(),
  installmentFrequency: varchar("installment_frequency", { length: 20 }).default("monthly"),
  fxRateLocked: numeric("fx_rate_locked", { precision: 18, scale: 8 }),
  fxLockExpiresAt: timestamp("fx_lock_expires_at"),
  smartContractId: varchar("smart_contract_id", { length: 50 }),
  agreementId: integer("agreement_id"),
  tigerBeetleEscrowAccount: bigint("tigerbeetle_escrow_account", { mode: "bigint" }),
  totalPaidUsd: numeric("total_paid_usd", { precision: 18, scale: 2 }).default("0.00"),
  totalReleasedUsd: numeric("total_released_usd", { precision: 18, scale: 2 }).default("0.00"),
  status: varchar("status", { length: 30 }).default("draft"),
  nextPaymentDate: timestamp("next_payment_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_escrow_plans_buyer").on(t.buyerId),
  index("idx_escrow_plans_builder").on(t.builderId),
  index("idx_escrow_plans_listing").on(t.listingId),
  index("idx_escrow_plans_status").on(t.status),
]);
export type PropertyEscrowPlan = typeof propertyEscrowPlans.$inferSelect;

export const propertyMilestones = pgTable("property_milestones", {
  id: serial("id").primaryKey(),
  milestoneId: varchar("milestone_id", { length: 50 }).unique().notNull(),
  escrowPlanId: integer("escrow_plan_id").notNull().references(() => propertyEscrowPlans.id),
  sequenceNumber: integer("sequence_number").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  releasePct: numeric("release_pct", { precision: 5, scale: 2 }).notNull(),
  releaseAmountUsd: numeric("release_amount_usd", { precision: 18, scale: 2 }).notNull(),
  deadline: timestamp("deadline").notNull(),
  verificationType: varchar("verification_type", { length: 30 }).default("inspector"),
  status: varchar("status", { length: 30 }).default("pending"),
  cureNoticeSentAt: timestamp("cure_notice_sent_at"),
  cureNoticeExpiresAt: timestamp("cure_notice_expires_at"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectedReason: text("rejected_reason"),
  fundsReleased: boolean("funds_released").default(false),
  fundsReleasedAt: timestamp("funds_released_at"),
  tigerBeetleTransferId: bigint("tigerbeetle_transfer_id", { mode: "bigint" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_milestones_plan").on(t.escrowPlanId),
  index("idx_milestones_status").on(t.status),
  index("idx_milestones_deadline").on(t.deadline),
]);
export type PropertyMilestone = typeof propertyMilestones.$inferSelect;

export const milestoneEvidence = pgTable("milestone_evidence", {
  id: serial("id").primaryKey(),
  evidenceId: varchar("evidence_id", { length: 50 }).unique().notNull(),
  milestoneId: integer("milestone_id").notNull().references(() => propertyMilestones.id),
  submittedBy: integer("submitted_by").notNull().references(() => users.id),
  evidenceType: varchar("evidence_type", { length: 30 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: varchar("file_name", { length: 300 }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }),
  description: text("description"),
  gpsLatitude: numeric("gps_latitude", { precision: 10, scale: 7 }),
  gpsLongitude: numeric("gps_longitude", { precision: 10, scale: 7 }),
  metadata: json("metadata").$type<Record<string, unknown>>().default({}),
  verified: boolean("verified").default(false),
  verifiedBy: integer("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_evidence_milestone").on(t.milestoneId),
  index("idx_evidence_submitted").on(t.submittedBy),
]);
export type MilestoneEvidence = typeof milestoneEvidence.$inferSelect;

export const propertyEscrowDisputes = pgTable("property_escrow_disputes", {
  id: serial("id").primaryKey(),
  disputeId: varchar("dispute_id", { length: 50 }).unique().notNull(),
  escrowPlanId: integer("escrow_plan_id").notNull().references(() => propertyEscrowPlans.id),
  milestoneId: integer("milestone_id").references(() => propertyMilestones.id),
  raisedBy: integer("raised_by").notNull().references(() => users.id),
  disputeType: varchar("dispute_type", { length: 30 }).notNull(),
  severity: varchar("severity", { length: 10 }).default("medium"),
  description: text("description").notNull(),
  evidenceIds: json("evidence_ids").$type<string[]>().default([]),
  status: varchar("status", { length: 30 }).default("open"),
  resolution: text("resolution"),
  refundAmountUsd: numeric("refund_amount_usd", { precision: 18, scale: 2 }),
  refundInitiatedAt: timestamp("refund_initiated_at"),
  refundCompletedAt: timestamp("refund_completed_at"),
  assignedMediator: integer("assigned_mediator").references(() => users.id),
  cureDeadline: timestamp("cure_deadline"),
  autoRefundDate: timestamp("auto_refund_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_prop_disputes_plan").on(t.escrowPlanId),
  index("idx_prop_disputes_status").on(t.status),
  index("idx_prop_disputes_raised").on(t.raisedBy),
]);
export type PropertyEscrowDispute = typeof propertyEscrowDisputes.$inferSelect;

export const escrowPaymentSchedule = pgTable("escrow_payment_schedule", {
  id: serial("id").primaryKey(),
  escrowPlanId: integer("escrow_plan_id").notNull().references(() => propertyEscrowPlans.id),
  installmentNumber: integer("installment_number").notNull(),
  dueDate: timestamp("due_date").notNull(),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  amountLocal: numeric("amount_local", { precision: 24, scale: 2 }),
  fxRateUsed: numeric("fx_rate_used", { precision: 18, scale: 8 }),
  status: varchar("status", { length: 20 }).default("scheduled"),
  paidAt: timestamp("paid_at"),
  transactionId: integer("transaction_id").references(() => transactions.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_escrow_schedule_plan").on(t.escrowPlanId),
  index("idx_escrow_schedule_due").on(t.dueDate),
  index("idx_escrow_schedule_status").on(t.status),
]);
export type EscrowPaymentScheduleEntry = typeof escrowPaymentSchedule.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P2P Instant Payments (Zelle-style) — Alias Directory + Payment Requests
// ═══════════════════════════════════════════════════════════════════════════════

export const p2pAliasTypeEnum = pgEnum("p2p_alias_type", ["phone", "email"]);
export const p2pAliasStatusEnum = pgEnum("p2p_alias_status", ["active", "pending_verification", "suspended", "deactivated"]);
export const p2pRequestStatusEnum = pgEnum("p2p_request_status", ["pending", "approved", "declined", "expired", "cancelled"]);
export const p2pTransferStatusEnum = pgEnum("p2p_transfer_status", ["initiated", "alias_resolved", "quoted", "compliance_cleared", "debited", "fx_converted", "settling", "completed", "failed", "compensated", "disputed", "escrowed", "streaming", "scheduled", "pending", "cancelled", "favorite"]);
export const p2pTransferRailEnum = pgEnum("p2p_transfer_rail", ["internal", "mojaloop", "papss", "mpesa", "upi", "pix", "sepa", "fednow", "swift", "batch", "ilp_stream", "escrow", "favorite", "scheduled"]);

export const paymentAliases = pgTable("payment_aliases", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  aliasType: p2pAliasTypeEnum("alias_type").notNull(),
  aliasValue: varchar("alias_value", { length: 320 }).notNull(),
  normalizedValue: varchar("normalized_value", { length: 320 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  walletId: integer("wallet_id"),
  country: varchar("country", { length: 3 }).notNull(),
  fspId: varchar("fsp_id", { length: 64 }).default("remitflow-fsp"),
  status: p2pAliasStatusEnum("status").default("active").notNull(),
  isPrimary: boolean("is_primary").default(false),
  verifiedAt: timestamp("verified_at"),
  mojaloopRegistered: boolean("mojaloop_registered").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payment_aliases_normalized_unique").on(t.normalizedValue, t.aliasType),
  index("payment_aliases_user_idx").on(t.userId),
  index("payment_aliases_country_idx").on(t.country),
]);
export type PaymentAlias = typeof paymentAliases.$inferSelect;

export const p2pPaymentRequests = pgTable("p2p_payment_requests", {
  id: serial("id").primaryKey(),
  requesterId: integer("requester_id").notNull(),
  requesterAlias: varchar("requester_alias", { length: 320 }).notNull(),
  payerAlias: varchar("payer_alias", { length: 320 }).notNull(),
  payerId: integer("payer_id"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  note: varchar("note", { length: 500 }),
  status: p2pRequestStatusEnum("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  respondedAt: timestamp("responded_at"),
  transferId: integer("transfer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("p2p_payment_requests_payer_idx").on(t.payerAlias),
  index("p2p_payment_requests_requester_idx").on(t.requesterId),
  index("p2p_payment_requests_status_idx").on(t.status),
]);
export type P2pPaymentRequest = typeof p2pPaymentRequests.$inferSelect;

export const p2pTransfers = pgTable("p2p_transfers", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull(),
  senderAlias: varchar("sender_alias", { length: 320 }),
  receiverAlias: varchar("receiver_alias", { length: 320 }).notNull(),
  receiverId: integer("receiver_id"),
  receiverFspId: varchar("receiver_fsp_id", { length: 64 }),
  sendAmount: numeric("send_amount", { precision: 18, scale: 2 }).notNull(),
  sendCurrency: varchar("send_currency", { length: 8 }).notNull(),
  receiveAmount: numeric("receive_amount", { precision: 18, scale: 2 }),
  receiveCurrency: varchar("receive_currency", { length: 8 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  fee: numeric("fee", { precision: 18, scale: 2 }).default("0.00"),
  rail: p2pTransferRailEnum("rail"),
  corridorCode: varchar("corridor_code", { length: 10 }),
  status: p2pTransferStatusEnum("status").default("initiated").notNull(),
  mojaloopTransferId: varchar("mojaloop_transfer_id", { length: 64 }),
  ilpCondition: varchar("ilp_condition", { length: 128 }),
  ilpFulfillment: varchar("ilp_fulfillment", { length: 128 }),
  amlCheckId: varchar("aml_check_id", { length: 64 }),
  fraudScore: numeric("fraud_score", { precision: 5, scale: 4 }),
  paymentRequestId: integer("payment_request_id"),
  note: varchar("note", { length: 500 }),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).unique(),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  failureReason: varchar("failure_reason", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("p2p_transfers_sender_idx").on(t.senderId),
  index("p2p_transfers_receiver_idx").on(t.receiverId),
  index("p2p_transfers_status_idx").on(t.status),
  index("p2p_transfers_idempotency_idx").on(t.idempotencyKey),
  index("p2p_transfers_corridor_idx").on(t.corridorCode),
]);
