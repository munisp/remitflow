/**
 * RemitFlow — Drizzle ORM Insert Type Exports
 * Auto-generated: provides $inferInsert types for all tables
 * that previously only had $inferSelect types.
 */
import type {
  users,
  wallets,
  transactions,
  beneficiaries,
  cards,
  savingsGoals,
  fxAlerts,
  kycDocuments,
  notifications,
  auditLogs,
  virtualAccounts,
  recurringPayments,
  scheduledTransferRuns,
  batchPayments,
  referrals,
  disputes,
  bnplPlans,
  cbdcWallets,
  stablecoinWallets,
  mojaloopTransfers,
  posTerminals,
  agentAccounts,
  kybRecords,
  idempotencyKeys,
  outboxEvents,
  erasureRequests,
  chatSessions,
  chatMessages,
  complianceCases,
  caseComments,
  impersonationTokens,
  fraudAlerts,
  analyticsThresholds,
  marketListings,
  marketOrders,
  talentProfiles,
  talentOpportunities,
  talentBookings,
  communityFunds,
  fundProposals,
  fundVotes,
  diasporaCollectives,
  diasporaCollectiveMembers,
  investmentOpportunities,
  marketRatings,
  familyMembers,
  familyBudgets,
  investmentAssets,
  userInvestments,
  investmentWatchlist,
  investmentOrders,
  investmentPriceHistory,
  tenants,
  tenantUsers,
  featureFlags,
  tenantFeatureFlags,
  userFeatureFlags,
  whiteLabelConfigs,
  travelRuleRecords,
  partnerInviteCodes,
  tenantOnboardingSessions,
  partnerPayouts,
  webhookEndpoints,
  webhookDeliveries,
  apiKeys,
  paymentGatewayLogs,
  complianceWatchlist,
  systemConfig,
  ngxStocks,
  stockWatchlists,
  ngxOrders,
  realEstateListings,
  realEstateInvestments,
  startupDeals,
  startupInvestments,
  paypalTransactions,
  flutterwaveTransactions,
  corridorMarginHistory,
  pushSubscriptions,
  apiKeyUsageLogs,
  stripeReceipts,
  fxAlertTriggerHistory,
  treasuryPositions,
  slaIncidents,
  chargebackCases,
  smartRoutingDecisions,
  complianceReports,
  developerSandboxSessions,
  sandboxScenarios,
  complianceAlerts,
  complianceAlertNotes,
  securityEvents,
  mfaSettings,
  transferAuditTrail,
  feeRules,
  promoCodes,
  promoRedemptions,
  dailyVolumeSnapshots,
  userNotifPrefs,
  scheduledTransfers,
  exchangeRateAlerts,
  nifiPipelineRuns,
  dbtRunHistory,
  airflowDagRuns,
  tenantConfigs,
  partnerApplications,
  partnerApplicationComments,
  partnerApiKeys,
  partnerWebhooks,
  userOnboardingProgress,
  complianceEmailConfig,
  abExperiments,
  abAssignments,
  abEvents,
  referralBonuses,
  documentVaultTable,
  rateAlertHistory,
  docReminderPrefs,
  docReminderLog,
  velocityRules,
  velocityOverrides,
  velocityWhitelist,
  kycLifecycle,
  kycLifecycleHistory,
  documentRenewals,
  webhookRetryQueue,
  apiKeyRotationLog,
  batchPaymentItems,
  systemConfigAuditLog,
  kafkaConsumerMetrics,
  transactionExports,
  ipLoginHistory,
  cbdcMintBurnLog,
  communityActivityFeed,
  ctrAutoFlags,
  mojaloopFsps,
  bulkUserActionLog,
  stripeWebhookRetryLog,
  revenueShareAgreements,
  revenueShareTiers,
  revenueShareLedger,
  revenueShareReports,
  chatSessionMeta,
  chatAgentStatus,
  chatCannedResponses,
  agreementTemplates,
  partnerDigitalAgreements,
  agreementSignatures,
  cronJobs,
  apiChangelogs,
  securityIncidents,
  paymentRequests,
  splitBillGroups,
  splitBillParticipants,
  pushNotificationPreferences,
  userLockouts,
  bricspayTransfers,
  mbridgeTransfers,
  ghipssTransfers,
  africbdcTransfers,
  papssTransfers,
  railHealthStatus,
  settlementAccounts,
  bmatchRateSnapshots,
  walletFundingEvents,
  bdcPartners,
  bdcLiquidityRequests,
  cbnComplianceExports,
  cbnCorridors,
  outboundAnnualUsage,
  crossSellOffers,
  westAfricanCorridors,
  xofPayoutAccounts,
  ecowasComplianceChecks,
  immigrantWorkerProfiles,
  tieredKycSessions,
  agentCashinTransactions,
  hnwProfiles,
  hnwFxRates,
  hnwRelationshipManagers,
  hnwPortfolios,
  correspondentBanks,
  clearingLines,
  correspondentRiskScores,
  derisikingAlerts,
  smeTradeBulkBatches,
  smeTradePayments,
  formMDocuments,
  diasporaUsaProfiles,
  achPaymentMethods,
  usComplianceDisclosures,
  diasporaEuProfiles,
  sepaPaymentMethods,
  diasporaCanadaProfiles,
  interacPaymentMethods,
  westAfricaTransfers,
  immigrantWorkerKyc,
  hnwClientProfiles,
  hnwRateLocks,
  hnwTransfers,
  hnwRmRequests,
  correspondentBanksV200,
  correspondentSettlements,
  smeTradeBatches,
  diasporaProfiles,
  diasporaOfferClaims,
  transfers,
  billingTenants,
  billingConfigs,
  billingConfigHistory,
  billingEvents,
  billingAuditLog,
  swiftTransactions,
  payrollCompanies,
  payrollEmployees,
  payrollTaxConfigs,
  payrollRuns,
  payrollRunItems,
  payrollDisbursements,
  diasporaBonds,
  bondSubscriptions,
  bondCouponPayments,
  bondSecondaryMarketOrders,
  contractors,
  contractorInvoices,
  expensePolicies,
  expenseReports,
  expenseItems,
  merchantKybReviews,
  invoiceFinancingApplications,
  lettersOfCredit,
  entityGroups,
  intercompanyTransfers,
  payrollTaxFilings,
  businessSavingsProducts,
  businessSavingsAccounts,
  embeddedPayrollApiKeys,
  embeddedPayrollRequests,
  mortgageApplications,
  mortgageRepayments,
  businessCreditScores,
  creditApplications,
  esgReports,
  carbonCredits,
  kycLivenessAudit,
  builderProfiles,
  propertyEscrowPlans,
  propertyMilestones,
  milestoneEvidence,
  propertyEscrowDisputes,
  escrowPaymentSchedule,
  paymentAliases,
  p2pPaymentRequests,
} from "./schema";

// ─── Insert Types for all tables ─────────────────────────────────────────────
export type InsertUser = typeof users.$inferInsert;
export type InsertWallet = typeof wallets.$inferInsert;
export type InsertTransaction = typeof transactions.$inferInsert;
export type InsertBeneficiary = typeof beneficiaries.$inferInsert;
export type InsertCard = typeof cards.$inferInsert;
export type InsertSavingsGoal = typeof savingsGoals.$inferInsert;
export type InsertFxAlert = typeof fxAlerts.$inferInsert;
export type InsertKycDocument = typeof kycDocuments.$inferInsert;
export type InsertNotification = typeof notifications.$inferInsert;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
export type InsertVirtualAccount = typeof virtualAccounts.$inferInsert;
export type InsertRecurringPayment = typeof recurringPayments.$inferInsert;
export type InsertScheduledTransferRun = typeof scheduledTransferRuns.$inferInsert;
export type InsertBatchPayment = typeof batchPayments.$inferInsert;
export type InsertReferral = typeof referrals.$inferInsert;
export type InsertDispute = typeof disputes.$inferInsert;
export type InsertBnplPlan = typeof bnplPlans.$inferInsert;
export type InsertCbdcWallet = typeof cbdcWallets.$inferInsert;
export type InsertStablecoinWallet = typeof stablecoinWallets.$inferInsert;
export type InsertMojaloopTransfer = typeof mojaloopTransfers.$inferInsert;
export type InsertPosTerminal = typeof posTerminals.$inferInsert;
export type InsertAgentAccount = typeof agentAccounts.$inferInsert;
export type InsertKybRecord = typeof kybRecords.$inferInsert;
export type InsertIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type InsertOutboxEvent = typeof outboxEvents.$inferInsert;
export type InsertErasureRequest = typeof erasureRequests.$inferInsert;
export type InsertChatSession = typeof chatSessions.$inferInsert;
export type InsertChatMessage = typeof chatMessages.$inferInsert;
export type InsertComplianceCase = typeof complianceCases.$inferInsert;
export type InsertCaseComment = typeof caseComments.$inferInsert;
export type InsertImpersonationToken = typeof impersonationTokens.$inferInsert;
export type InsertFraudAlert = typeof fraudAlerts.$inferInsert;
export type InsertAnalyticsThreshold = typeof analyticsThresholds.$inferInsert;
export type InsertMarketListing = typeof marketListings.$inferInsert;
export type InsertMarketOrder = typeof marketOrders.$inferInsert;
export type InsertTalentProfile = typeof talentProfiles.$inferInsert;
export type InsertTalentOpportunity = typeof talentOpportunities.$inferInsert;
export type InsertTalentBooking = typeof talentBookings.$inferInsert;
export type InsertCommunityFund = typeof communityFunds.$inferInsert;
export type InsertFundProposal = typeof fundProposals.$inferInsert;
export type InsertFundVote = typeof fundVotes.$inferInsert;
export type InsertDiasporaCollective = typeof diasporaCollectives.$inferInsert;
export type InsertDiasporaCollectiveMember = typeof diasporaCollectiveMembers.$inferInsert;
export type InsertInvestmentOpportunity = typeof investmentOpportunities.$inferInsert;
export type InsertMarketRating = typeof marketRatings.$inferInsert;
export type InsertFamilyMember = typeof familyMembers.$inferInsert;
export type InsertFamilyBudget = typeof familyBudgets.$inferInsert;
export type InsertInvestmentAsset = typeof investmentAssets.$inferInsert;
export type InsertUserInvestment = typeof userInvestments.$inferInsert;
export type InsertInvestmentWatchlistItem = typeof investmentWatchlist.$inferInsert;
export type InsertInvestmentOrder = typeof investmentOrders.$inferInsert;
export type InsertInvestmentPriceHistory = typeof investmentPriceHistory.$inferInsert;
export type InsertTenant = typeof tenants.$inferInsert;
export type InsertTenantUser = typeof tenantUsers.$inferInsert;
export type InsertFeatureFlag = typeof featureFlags.$inferInsert;
export type InsertTenantFeatureFlag = typeof tenantFeatureFlags.$inferInsert;
export type InsertUserFeatureFlag = typeof userFeatureFlags.$inferInsert;
export type InsertWhiteLabelConfig = typeof whiteLabelConfigs.$inferInsert;
export type InsertTravelRuleRecord = typeof travelRuleRecords.$inferInsert;
export type InsertPartnerInviteCode = typeof partnerInviteCodes.$inferInsert;
export type InsertTenantOnboardingSession = typeof tenantOnboardingSessions.$inferInsert;
export type InsertPartnerPayout = typeof partnerPayouts.$inferInsert;
export type InsertWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type InsertWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type InsertApiKey = typeof apiKeys.$inferInsert;
export type InsertPaymentGatewayLog = typeof paymentGatewayLogs.$inferInsert;
export type InsertComplianceWatchlistEntry = typeof complianceWatchlist.$inferInsert;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;
export type InsertNgxStock = typeof ngxStocks.$inferInsert;
export type InsertStockWatchlist = typeof stockWatchlists.$inferInsert;
export type InsertNgxOrder = typeof ngxOrders.$inferInsert;
export type InsertRealEstateListing = typeof realEstateListings.$inferInsert;
export type InsertRealEstateInvestment = typeof realEstateInvestments.$inferInsert;
export type InsertStartupDeal = typeof startupDeals.$inferInsert;
export type InsertStartupInvestment = typeof startupInvestments.$inferInsert;
export type InsertPaypalTransaction = typeof paypalTransactions.$inferInsert;
export type InsertFlutterwaveTransaction = typeof flutterwaveTransactions.$inferInsert;
export type InsertCorridorMarginHistory = typeof corridorMarginHistory.$inferInsert;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;
export type InsertApiKeyUsageLog = typeof apiKeyUsageLogs.$inferInsert;
export type InsertStripeReceipt = typeof stripeReceipts.$inferInsert;
export type InsertFxAlertTriggerHistory = typeof fxAlertTriggerHistory.$inferInsert;
export type InsertTreasuryPosition = typeof treasuryPositions.$inferInsert;
export type InsertSlaIncident = typeof slaIncidents.$inferInsert;
export type InsertChargebackCase = typeof chargebackCases.$inferInsert;
export type InsertSmartRoutingDecision = typeof smartRoutingDecisions.$inferInsert;
export type InsertComplianceReport = typeof complianceReports.$inferInsert;
export type InsertDeveloperSandboxSession = typeof developerSandboxSessions.$inferInsert;
export type InsertSandboxScenario = typeof sandboxScenarios.$inferInsert;
export type InsertComplianceAlert = typeof complianceAlerts.$inferInsert;
export type InsertComplianceAlertNote = typeof complianceAlertNotes.$inferInsert;
export type InsertSecurityEvent = typeof securityEvents.$inferInsert;
export type InsertMfaSetting = typeof mfaSettings.$inferInsert;
export type InsertTransferAuditTrailEntry = typeof transferAuditTrail.$inferInsert;
export type InsertFeeRule = typeof feeRules.$inferInsert;
export type InsertPromoCode = typeof promoCodes.$inferInsert;
export type InsertPromoRedemption = typeof promoRedemptions.$inferInsert;
export type InsertDailyVolumeSnapshot = typeof dailyVolumeSnapshots.$inferInsert;
export type InsertUserNotifPref = typeof userNotifPrefs.$inferInsert;
export type InsertScheduledTransfer = typeof scheduledTransfers.$inferInsert;
export type InsertExchangeRateAlert = typeof exchangeRateAlerts.$inferInsert;
export type InsertNifiPipelineRun = typeof nifiPipelineRuns.$inferInsert;
export type InsertDbtRunHistory = typeof dbtRunHistory.$inferInsert;
export type InsertAirflowDagRun = typeof airflowDagRuns.$inferInsert;
export type InsertTenantConfig = typeof tenantConfigs.$inferInsert;
export type InsertPartnerApplication = typeof partnerApplications.$inferInsert;
export type InsertPartnerApplicationComment = typeof partnerApplicationComments.$inferInsert;
export type InsertPartnerApiKey = typeof partnerApiKeys.$inferInsert;
export type InsertPartnerWebhook = typeof partnerWebhooks.$inferInsert;
export type InsertUserOnboardingProgress = typeof userOnboardingProgress.$inferInsert;
export type InsertComplianceEmailConfig = typeof complianceEmailConfig.$inferInsert;
export type InsertAbExperiment = typeof abExperiments.$inferInsert;
export type InsertAbAssignment = typeof abAssignments.$inferInsert;
export type InsertAbEvent = typeof abEvents.$inferInsert;
export type InsertReferralBonus = typeof referralBonuses.$inferInsert;
export type InsertDocumentVaultEntry = typeof documentVaultTable.$inferInsert;
export type InsertRateAlertHistory = typeof rateAlertHistory.$inferInsert;
export type InsertDocReminderPrefs = typeof docReminderPrefs.$inferInsert;
export type InsertDocReminderLog = typeof docReminderLog.$inferInsert;
export type InsertVelocityRule = typeof velocityRules.$inferInsert;
export type InsertVelocityOverride = typeof velocityOverrides.$inferInsert;
export type InsertVelocityWhitelist = typeof velocityWhitelist.$inferInsert;
export type InsertKycLifecycle = typeof kycLifecycle.$inferInsert;
export type InsertKycLifecycleHistory = typeof kycLifecycleHistory.$inferInsert;
export type InsertDocumentRenewal = typeof documentRenewals.$inferInsert;
export type InsertWebhookRetryQueueEntry = typeof webhookRetryQueue.$inferInsert;
export type InsertApiKeyRotationLog = typeof apiKeyRotationLog.$inferInsert;
export type InsertBatchPaymentItem = typeof batchPaymentItems.$inferInsert;
export type InsertSystemConfigAuditLog = typeof systemConfigAuditLog.$inferInsert;
export type InsertKafkaConsumerMetric = typeof kafkaConsumerMetrics.$inferInsert;
export type InsertTransactionExport = typeof transactionExports.$inferInsert;
export type InsertIpLoginHistory = typeof ipLoginHistory.$inferInsert;
export type InsertCbdcMintBurnLog = typeof cbdcMintBurnLog.$inferInsert;
export type InsertCommunityActivityFeedItem = typeof communityActivityFeed.$inferInsert;
export type InsertCtrAutoFlag = typeof ctrAutoFlags.$inferInsert;
export type InsertMojaloopFsp = typeof mojaloopFsps.$inferInsert;
export type InsertBulkUserActionLog = typeof bulkUserActionLog.$inferInsert;
export type InsertStripeWebhookRetryLog = typeof stripeWebhookRetryLog.$inferInsert;
export type InsertRevenueShareAgreement = typeof revenueShareAgreements.$inferInsert;
export type InsertRevenueShareTier = typeof revenueShareTiers.$inferInsert;
export type InsertRevenueShareLedgerEntry = typeof revenueShareLedger.$inferInsert;
export type InsertRevenueShareReport = typeof revenueShareReports.$inferInsert;
export type InsertChatSessionMeta = typeof chatSessionMeta.$inferInsert;
export type InsertChatAgentStatus = typeof chatAgentStatus.$inferInsert;
export type InsertChatCannedResponse = typeof chatCannedResponses.$inferInsert;
export type InsertAgreementTemplate = typeof agreementTemplates.$inferInsert;
export type InsertPartnerDigitalAgreement = typeof partnerDigitalAgreements.$inferInsert;
export type InsertAgreementSignature = typeof agreementSignatures.$inferInsert;
export type InsertCronJob = typeof cronJobs.$inferInsert;
export type InsertApiChangelog = typeof apiChangelogs.$inferInsert;
export type InsertSecurityIncident = typeof securityIncidents.$inferInsert;
export type InsertPaymentRequest = typeof paymentRequests.$inferInsert;
export type InsertSplitBillGroup = typeof splitBillGroups.$inferInsert;
export type InsertSplitBillParticipant = typeof splitBillParticipants.$inferInsert;
export type InsertPushNotificationPreference = typeof pushNotificationPreferences.$inferInsert;
export type InsertUserLockout = typeof userLockouts.$inferInsert;
export type InsertBRICSPayTransfer = typeof bricspayTransfers.$inferInsert;
export type InsertMBridgeTransfer = typeof mbridgeTransfers.$inferInsert;
export type InsertGhIPSSTransfer = typeof ghipssTransfers.$inferInsert;
export type InsertAfriCBDCTransfer = typeof africbdcTransfers.$inferInsert;
export type InsertPAPSSTransfer = typeof papssTransfers.$inferInsert;
export type InsertRailHealthStatus = typeof railHealthStatus.$inferInsert;
export type InsertSettlementAccount = typeof settlementAccounts.$inferInsert;
export type InsertBmatchRateSnapshot = typeof bmatchRateSnapshots.$inferInsert;
export type InsertWalletFundingEvent = typeof walletFundingEvents.$inferInsert;
export type InsertBdcPartner = typeof bdcPartners.$inferInsert;
export type InsertBdcLiquidityRequest = typeof bdcLiquidityRequests.$inferInsert;
export type InsertCbnComplianceExport = typeof cbnComplianceExports.$inferInsert;
export type InsertCbnCorridor = typeof cbnCorridors.$inferInsert;
export type InsertOutboundAnnualUsage = typeof outboundAnnualUsage.$inferInsert;
export type InsertCrossSellOffer = typeof crossSellOffers.$inferInsert;
export type InsertWestAfricanCorridor = typeof westAfricanCorridors.$inferInsert;
export type InsertXofPayoutAccount = typeof xofPayoutAccounts.$inferInsert;
export type InsertEcowasComplianceCheck = typeof ecowasComplianceChecks.$inferInsert;
export type InsertImmigrantWorkerProfile = typeof immigrantWorkerProfiles.$inferInsert;
export type InsertTieredKycSession = typeof tieredKycSessions.$inferInsert;
export type InsertAgentCashinTransaction = typeof agentCashinTransactions.$inferInsert;
export type InsertHnwProfile = typeof hnwProfiles.$inferInsert;
export type InsertHnwFxRate = typeof hnwFxRates.$inferInsert;
export type InsertHnwRelationshipManager = typeof hnwRelationshipManagers.$inferInsert;
export type InsertHnwPortfolio = typeof hnwPortfolios.$inferInsert;
export type InsertCorrespondentBank = typeof correspondentBanks.$inferInsert;
export type InsertClearingLine = typeof clearingLines.$inferInsert;
export type InsertCorrespondentRiskScore = typeof correspondentRiskScores.$inferInsert;
export type InsertDerisikingAlert = typeof derisikingAlerts.$inferInsert;
export type InsertSmeTradeBulkBatch = typeof smeTradeBulkBatches.$inferInsert;
export type InsertSmeTradePayment = typeof smeTradePayments.$inferInsert;
export type InsertFormMDocument = typeof formMDocuments.$inferInsert;
export type InsertDiasporaUsaProfile = typeof diasporaUsaProfiles.$inferInsert;
export type InsertAchPaymentMethod = typeof achPaymentMethods.$inferInsert;
export type InsertUsComplianceDisclosure = typeof usComplianceDisclosures.$inferInsert;
export type InsertDiasporaEuProfile = typeof diasporaEuProfiles.$inferInsert;
export type InsertSepaPaymentMethod = typeof sepaPaymentMethods.$inferInsert;
export type InsertDiasporaCanadaProfile = typeof diasporaCanadaProfiles.$inferInsert;
export type InsertInteracPaymentMethod = typeof interacPaymentMethods.$inferInsert;
export type InsertWestAfricaTransfer = typeof westAfricaTransfers.$inferInsert;
export type InsertImmigrantWorkerKyc = typeof immigrantWorkerKyc.$inferInsert;
export type InsertHnwClientProfile = typeof hnwClientProfiles.$inferInsert;
export type InsertHnwRateLock = typeof hnwRateLocks.$inferInsert;
export type InsertHnwTransfer = typeof hnwTransfers.$inferInsert;
export type InsertHnwRmRequest = typeof hnwRmRequests.$inferInsert;
export type InsertCorrespondentBankV200 = typeof correspondentBanksV200.$inferInsert;
export type InsertCorrespondentSettlement = typeof correspondentSettlements.$inferInsert;
export type InsertSmeTradeBatch = typeof smeTradeBatches.$inferInsert;
export type InsertDiasporaProfile = typeof diasporaProfiles.$inferInsert;
export type InsertDiasporaOfferClaim = typeof diasporaOfferClaims.$inferInsert;
export type InsertTransfer = typeof transfers.$inferInsert;
export type InsertBillingTenant = typeof billingTenants.$inferInsert;
export type InsertBillingConfig = typeof billingConfigs.$inferInsert;
export type InsertBillingConfigHistory = typeof billingConfigHistory.$inferInsert;
export type InsertBillingEvent = typeof billingEvents.$inferInsert;
export type InsertBillingAuditLog = typeof billingAuditLog.$inferInsert;
export type InsertSwiftTransaction = typeof swiftTransactions.$inferInsert;
export type InsertPayrollCompany = typeof payrollCompanies.$inferInsert;
export type InsertPayrollEmployee = typeof payrollEmployees.$inferInsert;
export type InsertPayrollTaxConfig = typeof payrollTaxConfigs.$inferInsert;
export type InsertPayrollRun = typeof payrollRuns.$inferInsert;
export type InsertPayrollRunItem = typeof payrollRunItems.$inferInsert;
export type InsertPayrollDisbursement = typeof payrollDisbursements.$inferInsert;
export type InsertDiasporaBond = typeof diasporaBonds.$inferInsert;
export type InsertBondSubscription = typeof bondSubscriptions.$inferInsert;
export type InsertBondCouponPayment = typeof bondCouponPayments.$inferInsert;
export type InsertBondSecondaryMarketOrder = typeof bondSecondaryMarketOrders.$inferInsert;
export type InsertContractor = typeof contractors.$inferInsert;
export type InsertContractorInvoice = typeof contractorInvoices.$inferInsert;
export type InsertExpensePolicy = typeof expensePolicies.$inferInsert;
export type InsertExpenseReport = typeof expenseReports.$inferInsert;
export type InsertExpenseItem = typeof expenseItems.$inferInsert;
export type InsertMerchantKybReview = typeof merchantKybReviews.$inferInsert;
export type InsertInvoiceFinancingApplication = typeof invoiceFinancingApplications.$inferInsert;
export type InsertLetterOfCredit = typeof lettersOfCredit.$inferInsert;
export type InsertEntityGroup = typeof entityGroups.$inferInsert;
export type InsertIntercompanyTransfer = typeof intercompanyTransfers.$inferInsert;
export type InsertPayrollTaxFiling = typeof payrollTaxFilings.$inferInsert;
export type InsertBusinessSavingsProduct = typeof businessSavingsProducts.$inferInsert;
export type InsertBusinessSavingsAccount = typeof businessSavingsAccounts.$inferInsert;
export type InsertEmbeddedPayrollApiKey = typeof embeddedPayrollApiKeys.$inferInsert;
export type InsertEmbeddedPayrollRequest = typeof embeddedPayrollRequests.$inferInsert;
export type InsertMortgageApplication = typeof mortgageApplications.$inferInsert;
export type InsertMortgageRepayment = typeof mortgageRepayments.$inferInsert;
export type InsertBusinessCreditScore = typeof businessCreditScores.$inferInsert;
export type InsertCreditApplication = typeof creditApplications.$inferInsert;
export type InsertEsgReport = typeof esgReports.$inferInsert;
export type InsertCarbonCredit = typeof carbonCredits.$inferInsert;
export type InsertKycLivenessAudit = typeof kycLivenessAudit.$inferInsert;
export type InsertBuilderProfile = typeof builderProfiles.$inferInsert;
export type InsertPropertyEscrowPlan = typeof propertyEscrowPlans.$inferInsert;
export type InsertPropertyMilestone = typeof propertyMilestones.$inferInsert;
export type InsertMilestoneEvidence = typeof milestoneEvidence.$inferInsert;
export type InsertPropertyEscrowDispute = typeof propertyEscrowDisputes.$inferInsert;
export type InsertEscrowPaymentScheduleEntry = typeof escrowPaymentSchedule.$inferInsert;
export type InsertPaymentAlias = typeof paymentAliases.$inferInsert;
export type InsertP2pPaymentRequest = typeof p2pPaymentRequests.$inferInsert;
