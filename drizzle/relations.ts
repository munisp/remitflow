/**
 * Drizzle ORM Relations — P0 Database 2.1
 *
 * Defines type-safe relations between 262 tables for eager loading
 * and type-safe JOINs via `with:` syntax.
 */
import { relations } from "drizzle-orm";
import {
  users, wallets, transactions, beneficiaries, cards, savingsGoals,
  fxAlerts, kycDocuments, notifications, auditLogs, virtualAccounts,
  recurringPayments, scheduledTransferRuns, batchPayments, referrals,
  disputes, supportTickets, rateLocks, directDebitMandates, consentRecords,
  bnplPlans, cbdcWallets, stablecoinWallets, mojaloopTransfers,
  posTerminals, agentAccounts, kybRecords, idempotencyKeys, outboxEvents,
  erasureRequests, notificationPreferences, chatSessions, chatMessages,
  complianceCases, caseComments, impersonationTokens, fraudAlerts,
  familyMembers, familyBudgets, investmentAssets, userInvestments,
  investmentOrders, tenantUsers, webhookEndpoints, webhookDeliveries,
  apiKeys, paymentGatewayLogs, complianceWatchlist,
} from "./schema";

// ─── User Relations ──────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  wallets: many(wallets),
  transactions: many(transactions),
  beneficiaries: many(beneficiaries),
  cards: many(cards),
  savingsGoals: many(savingsGoals),
  fxAlerts: many(fxAlerts),
  kycDocuments: many(kycDocuments),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
  virtualAccounts: many(virtualAccounts),
  recurringPayments: many(recurringPayments),
  batchPayments: many(batchPayments),
  referrals: many(referrals),
  disputes: many(disputes),
  supportTickets: many(supportTickets),
  rateLocks: many(rateLocks),
  directDebitMandates: many(directDebitMandates),
  consentRecords: many(consentRecords),
  bnplPlans: many(bnplPlans),
  cbdcWallets: many(cbdcWallets),
  stablecoinWallets: many(stablecoinWallets),
  chatSessions: many(chatSessions),
  complianceCases: many(complianceCases),
  impersonationTokens: many(impersonationTokens),
  fraudAlerts: many(fraudAlerts),
  familyMembers: many(familyMembers),
  familyBudgets: many(familyBudgets),
  userInvestments: many(userInvestments),
  investmentOrders: many(investmentOrders),
  erasureRequests: many(erasureRequests),
}));

// ─── Wallet Relations ────────────────────────────────────
export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
}));

// ─── Transaction Relations ───────────────────────────────
export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  beneficiary: one(beneficiaries, { fields: [transactions.beneficiaryId], references: [beneficiaries.id] }),
}));

// ─── Beneficiary Relations ───────────────────────────────
export const beneficiariesRelations = relations(beneficiaries, ({ one, many }) => ({
  user: one(users, { fields: [beneficiaries.userId], references: [users.id] }),
  transactions: many(transactions),
}));

// ─── Card Relations ──────────────────────────────────────
export const cardsRelations = relations(cards, ({ one }) => ({
  user: one(users, { fields: [cards.userId], references: [users.id] }),
}));

// ─── Savings Goal Relations ──────────────────────────────
export const savingsGoalsRelations = relations(savingsGoals, ({ one }) => ({
  user: one(users, { fields: [savingsGoals.userId], references: [users.id] }),
}));

// ─── FX Alert Relations ──────────────────────────────────
export const fxAlertsRelations = relations(fxAlerts, ({ one }) => ({
  user: one(users, { fields: [fxAlerts.userId], references: [users.id] }),
}));

// ─── KYC Document Relations ──────────────────────────────
export const kycDocumentsRelations = relations(kycDocuments, ({ one }) => ({
  user: one(users, { fields: [kycDocuments.userId], references: [users.id] }),
}));

// ─── Notification Relations ──────────────────────────────
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

// ─── Audit Log Relations ─────────────────────────────────
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

// ─── Virtual Account Relations ───────────────────────────
export const virtualAccountsRelations = relations(virtualAccounts, ({ one }) => ({
  user: one(users, { fields: [virtualAccounts.userId], references: [users.id] }),
}));

// ─── Recurring Payment Relations ─────────────────────────
export const recurringPaymentsRelations = relations(recurringPayments, ({ one, many }) => ({
  user: one(users, { fields: [recurringPayments.userId], references: [users.id] }),
  runs: many(scheduledTransferRuns),
}));

// ─── Scheduled Transfer Run Relations ────────────────────
export const scheduledTransferRunsRelations = relations(scheduledTransferRuns, ({ one }) => ({
  recurringPayment: one(recurringPayments, { fields: [scheduledTransferRuns.recurringPaymentId], references: [recurringPayments.id] }),
}));

// ─── Batch Payment Relations ─────────────────────────────
export const batchPaymentsRelations = relations(batchPayments, ({ one }) => ({
  user: one(users, { fields: [batchPayments.userId], references: [users.id] }),
}));

// ─── Referral Relations ──────────────────────────────────
export const referralsRelations = relations(referrals, ({ one }) => ({
  referrer: one(users, { fields: [referrals.referrerId], references: [users.id] }),
}));

// ─── Dispute Relations ───────────────────────────────────
export const disputesRelations = relations(disputes, ({ one }) => ({
  user: one(users, { fields: [disputes.userId], references: [users.id] }),
  transaction: one(transactions, { fields: [disputes.transactionId], references: [transactions.id] }),
}));

// ─── Support Ticket Relations ────────────────────────────
export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user: one(users, { fields: [supportTickets.userId], references: [users.id] }),
}));

// ─── Rate Lock Relations ─────────────────────────────────
export const rateLocksRelations = relations(rateLocks, ({ one }) => ({
  user: one(users, { fields: [rateLocks.userId], references: [users.id] }),
}));

// ─── Direct Debit Mandate Relations ──────────────────────
export const directDebitMandatesRelations = relations(directDebitMandates, ({ one }) => ({
  user: one(users, { fields: [directDebitMandates.userId], references: [users.id] }),
}));

// ─── Consent Record Relations ────────────────────────────
export const consentRecordsRelations = relations(consentRecords, ({ one }) => ({
  user: one(users, { fields: [consentRecords.userId], references: [users.id] }),
}));

// ─── BNPL Plan Relations ─────────────────────────────────
export const bnplPlansRelations = relations(bnplPlans, ({ one }) => ({
  user: one(users, { fields: [bnplPlans.userId], references: [users.id] }),
}));

// ─── CBDC Wallet Relations ───────────────────────────────
export const cbdcWalletsRelations = relations(cbdcWallets, ({ one }) => ({
  user: one(users, { fields: [cbdcWallets.userId], references: [users.id] }),
}));

// ─── Stablecoin Wallet Relations ─────────────────────────
export const stablecoinWalletsRelations = relations(stablecoinWallets, ({ one }) => ({
  user: one(users, { fields: [stablecoinWallets.userId], references: [users.id] }),
}));

// ─── Mojaloop Transfer Relations ─────────────────────────
export const mojaloopTransfersRelations = relations(mojaloopTransfers, ({ one }) => ({
  user: one(users, { fields: [mojaloopTransfers.userId], references: [users.id] }),
}));

// ─── POS Terminal Relations ──────────────────────────────
export const posTerminalsRelations = relations(posTerminals, ({ one }) => ({
  agent: one(agentAccounts, { fields: [posTerminals.agentId], references: [agentAccounts.id] }),
}));

// ─── Agent Account Relations ─────────────────────────────
export const agentAccountsRelations = relations(agentAccounts, ({ one, many }) => ({
  user: one(users, { fields: [agentAccounts.userId], references: [users.id] }),
  posTerminals: many(posTerminals),
}));

// ─── Chat Session Relations ──────────────────────────────
export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  messages: many(chatMessages),
}));

// ─── Chat Message Relations ──────────────────────────────
export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, { fields: [chatMessages.sessionId], references: [chatSessions.id] }),
}));

// ─── Compliance Case Relations ───────────────────────────
export const complianceCasesRelations = relations(complianceCases, ({ one, many }) => ({
  user: one(users, { fields: [complianceCases.userId], references: [users.id] }),
  comments: many(caseComments),
}));

// ─── Case Comment Relations ──────────────────────────────
export const caseCommentsRelations = relations(caseComments, ({ one }) => ({
  case: one(complianceCases, { fields: [caseComments.caseId], references: [complianceCases.id] }),
}));

// ─── Family Member Relations ─────────────────────────────
export const familyMembersRelations = relations(familyMembers, ({ one }) => ({
  user: one(users, { fields: [familyMembers.userId], references: [users.id] }),
}));

// ─── Family Budget Relations ─────────────────────────────
export const familyBudgetsRelations = relations(familyBudgets, ({ one }) => ({
  user: one(users, { fields: [familyBudgets.userId], references: [users.id] }),
}));

// ─── User Investment Relations ───────────────────────────
export const userInvestmentsRelations = relations(userInvestments, ({ one }) => ({
  user: one(users, { fields: [userInvestments.userId], references: [users.id] }),
  asset: one(investmentAssets, { fields: [userInvestments.assetId], references: [investmentAssets.id] }),
}));

// ─── Investment Order Relations ──────────────────────────
export const investmentOrdersRelations = relations(investmentOrders, ({ one }) => ({
  user: one(users, { fields: [investmentOrders.userId], references: [users.id] }),
  asset: one(investmentAssets, { fields: [investmentOrders.assetId], references: [investmentAssets.id] }),
}));

// ─── Webhook Endpoint Relations ──────────────────────────
export const webhookEndpointsRelations = relations(webhookEndpoints, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}));

// ─── Webhook Delivery Relations ──────────────────────────
export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, { fields: [webhookDeliveries.endpointId], references: [webhookEndpoints.id] }),
}));

// ─── Fraud Alert Relations ───────────────────────────────
export const fraudAlertsRelations = relations(fraudAlerts, ({ one }) => ({
  user: one(users, { fields: [fraudAlerts.userId], references: [users.id] }),
}));

// ─── Notification Preferences Relations ──────────────────
export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, { fields: [notificationPreferences.userId], references: [users.id] }),
}));
