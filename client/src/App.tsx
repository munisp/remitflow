import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";
import { PWAInstallPrompt, PWAOfflineBanner, PWAUpdateBanner } from "./components/PWAInstallPrompt";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { ConnectionQualityIndicator } from "./components/ConnectionQualityIndicator";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { Loader2 } from "lucide-react";
const AMLBatchEnginePage = lazy(() => import("@/pages/AMLBatchEnginePage"));
const PBACPolicies = lazy(() => import("@/pages/PBACPolicies"));
const SettlementNettingPage = lazy(() => import("@/pages/SettlementNettingPage"));
const LiquidityStressTestPage = lazy(() => import("@/pages/LiquidityStressTestPage"));
const MultiCurrencyWalletV2Page = lazy(() => import("@/pages/MultiCurrencyWalletV2Page"));
const CrossBorderCompliancePage = lazy(() => import("@/pages/CrossBorderCompliancePage"));
const MerchantKYBPage = lazy(() => import("@/pages/MerchantKYBPage"));
const DocumentOCRPage = lazy(() => import("@/pages/DocumentOCRPage"));
const FXOptionsPricingPage = lazy(() => import("@/pages/FXOptionsPricingPage"));


// Core pages
const Home = lazy(() => import("./pages/Home"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Core Banking
const FXAlerts = lazy(() => import("./pages/FXAlerts"));
const Wallet = lazy(() => import("./pages/Wallet"));
const SendMoney = lazy(() => import("./pages/SendMoney"));
const ReceiveMoney = lazy(() => import("./pages/ReceiveMoney"));
const Transactions = lazy(() => import("./pages/Transactions"));
const ExchangeRates = lazy(() => import("./pages/ExchangeRates"));

// Payments & Services
const Airtime = lazy(() => import("./pages/Airtime"));
const Bills = lazy(() => import("./pages/Bills"));
const VirtualAccount = lazy(() => import("./pages/VirtualAccount"));
const Cards = lazy(() => import("./pages/Cards"));
const BatchPayments = lazy(() => import("./pages/BatchPayments"));
const TransferTracking = lazy(() => import("./pages/TransferTracking"));
const RecurringPayments = lazy(() => import("./pages/RecurringPayments"));
const QRCode = lazy(() => import("./pages/QRCode"));
const DirectDebit = lazy(() => import("./pages/DirectDebit"));
const MPesa = lazy(() => import("./pages/MPesa"));
const WiseTransfer = lazy(() => import("./pages/WiseTransfer"));

// Compliance & Identity
const KYCVerification = lazy(() => import("./pages/KYCVerification"));
const PropertyKYC = lazy(() => import("./pages/PropertyKYC"));
const TravelRule = lazy(() => import("./pages/TravelRule"));
const FCACompliance = lazy(() => import("./pages/FCACompliance"));
const GDPRData = lazy(() => import("./pages/GDPRData"));
const ConsentManagement = lazy(() => import("./pages/ConsentManagement"));
const DPIA = lazy(() => import("./pages/DPIA"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const Disputes = lazy(() => import("./pages/Disputes"));

// Advanced Fintech
const Mojaloop = lazy(() => import("./pages/Mojaloop"));
const CBDC = lazy(() => import("./pages/CBDC"));
const BNPL = lazy(() => import("./pages/BNPL"));
const Stablecoin = lazy(() => import("./pages/Stablecoin"));
const SavingsGoals = lazy(() => import("./pages/SavingsGoals"));
const Referral = lazy(() => import("./pages/Referral"));
const CorridorPricing = lazy(() => import("./pages/CorridorPricing"));
const CheckoutSDK = lazy(() => import("./pages/CheckoutSDK"));

// Account & Settings
const Profile = lazy(() => import("./pages/Profile"));
const SecuritySettings = lazy(() => import("./pages/SecuritySettings"));
const Notifications = lazy(() => import("./pages/Notifications"));
const NotificationPreferences = lazy(() => import("./pages/NotificationPreferences"));
const Settings = lazy(() => import("./pages/Settings"));
const Support = lazy(() => import("./pages/Support"));
const LiveChat = lazy(() => import("./pages/LiveChat"));
const Help = lazy(() => import("./pages/Help"));
const Beneficiaries = lazy(() => import("./pages/Beneficiaries"));
const PaymentMethods = lazy(() => import("./pages/PaymentMethods"));

// Operations
const POSManagement = lazy(() => import("./pages/POSManagement"));
const AgentNetwork = lazy(() => import("./pages/AgentNetwork"));
const APIChangelog = lazy(() => import("./pages/APIChangelog"));
const AccountHealth = lazy(() => import("./pages/AccountHealth"));
const PaymentPerformance = lazy(() => import("./pages/PaymentPerformance"));
const RateLock = lazy(() => import("./pages/RateLock"));
const RateCalculator = lazy(() => import("./pages/RateCalculator"));
// v6 New Features
const FraudMonitor = lazy(() => import("./pages/FraudMonitor"));
const FXRateAlerts = lazy(() => import("./pages/FXRateAlerts"));
// v20 Analytics
const Analytics = lazy(() => import("./pages/Analytics"));
// v25 Admin
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
// v26 Admin KYC
const AdminKYC = lazy(() => import("./pages/AdminKYC"));
// v27 Admin Compliance
const AdminCompliance = lazy(() => import("./pages/AdminCompliance"));
// v29 Admin Audit Log
const AdminAuditLog = lazy(() => import("./pages/AdminAuditLog"));
// v30 Admin Home
const AdminHome = lazy(() => import("./pages/AdminHome"));
// v35 Admin Analytics
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const TransferAnalytics = lazy(() => import("./pages/TransferAnalytics"));
const TransferDisputeForm = lazy(() => import("./pages/TransferDisputeForm"));
const AdminDisputes = lazy(() => import("./pages/AdminDisputes"));
// v41 Polyglot Microservices
const AdminMicroservices = lazy(() => import("./pages/AdminMicroservices"));
// v77 Corridor Pricing Admin
const CorridorPricingAdmin = lazy(() => import("./pages/CorridorPricingAdmin"));
// v46 Nav Analytics
const AdminNavAnalytics = lazy(() => import("./pages/AdminNavAnalytics"));
// v62 Admin Tools
const AdminSeedData = lazy(() => import("./pages/AdminSeedData"));
const AdminStripeTest = lazy(() => import("./pages/AdminStripeTest"));
const AdminReadiness = lazy(() => import("./pages/AdminReadiness"));
const AdminScheduledJobs = lazy(() => import("./pages/AdminScheduledJobs"));
// v65 Feature Flags & Tenants
const AdminFeatureFlags = lazy(() => import("./pages/AdminFeatureFlags"));
const AdminTenants = lazy(() => import("./pages/AdminTenants"));
const AdminWhiteLabel = lazy(() => import("./pages/AdminWhiteLabel"));
// v68 Partner Onboarding & White Label
const PartnerOnboard = lazy(() => import("./pages/PartnerOnboard"));
const MyTenants = lazy(() => import("./pages/MyTenants"));
const TenantDashboard = lazy(() => import("./pages/TenantDashboard"));
const AdminInviteCodes = lazy(() => import("./pages/AdminInviteCodes"));
const BdcOnboardingEmailPreview = lazy(() => import("./pages/BdcOnboardingEmailPreview"));
const PartnerAnalytics = lazy(() => import("./pages/PartnerAnalytics"));
// v73 Production Completeness
const PartnerPayouts = lazy(() => import("./pages/PartnerPayouts"));
const WebhookManager = lazy(() => import("./pages/WebhookManager"));
const APIKeyManager = lazy(() => import("./pages/APIKeyManager"));
const ComplianceWatchlistPage = lazy(() => import("./pages/ComplianceWatchlistPage"));
const SystemConfigPage = lazy(() => import("./pages/SystemConfigPage"));

const PageLoader = () => (
  <div className="flex items-center justify-center h-full min-h-[60vh]">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const KYC = lazy(() => import("./pages/KYC"));
const Savings = lazy(() => import("./pages/Savings"));
const Recurring = lazy(() => import("./pages/Recurring"));
const DiasporaInvest = lazy(() => import("./pages/DiasporaInvest"));
// v74 Diaspora Investment Hub
const NGXStockMarket = lazy(() => import("./pages/NGXStockMarket"));
const RealEstateHub = lazy(() => import("./pages/RealEstateHub"));
const StartupDealRoom = lazy(() => import("./pages/StartupDealRoom"));
const InvestmentPortfolio = lazy(() => import("./pages/InvestmentPortfolio"));
const TransferGoals = lazy(() => import("./pages/TransferGoals"));
// v40 Diaspora Modules
const TalentBridge = lazy(() => import("./pages/TalentBridge"));
const Community = lazy(() => import("./pages/Community"));
const AfriMarket = lazy(() => import("./pages/AfriMarket"));
// v43 Family Dashboard
const FamilyDashboard = lazy(() => import("./pages/FamilyDashboard"));
// v44 Community Hub
const CommunityHub = lazy(() => import("./pages/CommunityHub"));
// v49 Investment & Community Leaderboard
const BeyondRemittance = lazy(() => import("./pages/BeyondRemittance"));
const CommunityLeaderboard = lazy(() => import("./pages/CommunityLeaderboard"));
// v58 Country Landing Pages
const SendToNigeria = lazy(() => import("./pages/SendToNigeria"));
const SendToGhana = lazy(() => import("./pages/SendToGhana"));
const SendToKenya = lazy(() => import("./pages/SendToKenya"));
const SendToSenegal = lazy(() => import("./pages/SendToSenegal"));
const SendToCameroon = lazy(() => import("./pages/SendToCameroon"));
const SendToSouthAfrica = lazy(() => import("./pages/SendToSouthAfrica"));
const SendToUganda = lazy(() => import("./pages/SendToUganda"));
const SendToTanzania = lazy(() => import("./pages/SendToTanzania"));
const DiasporaUK = lazy(() => import("./pages/DiasporaUK"));
// v81 PWA Features Showcase
const PWAFeatures = lazy(() => import("./pages/PWAFeatures"));
// v82 Production Features
const TreasuryManagement = lazy(() => import("./pages/TreasuryManagement"));
const SLAMonitor = lazy(() => import("./pages/SLAMonitor"));
const DocumentVault = lazy(() => import("./pages/DocumentVault"));
const ChargebackManager = lazy(() => import("./pages/ChargebackManager"));
const NotificationCenter = lazy(() => import("./pages/NotificationCenter"));
const FXHedging = lazy(() => import("./pages/FXHedging"));
// v84 Production Features
const StripeReceipts = lazy(() => import("./pages/StripeReceipts"));
const APIUsageDashboard = lazy(() => import("./pages/APIUsageDashboard"));
const SmartRoutingDashboard = lazy(() => import("./pages/SmartRoutingDashboard"));
const ComplianceReporting = lazy(() => import("./pages/ComplianceReporting"));
const DeveloperSandbox = lazy(() => import("./pages/DeveloperSandbox"));
const VAPIDPushManager = lazy(() => import("./pages/VAPIDPushManager"));
// v85 Production Features
const SandboxScenarios = lazy(() => import("./pages/SandboxScenarios"));
const ComplianceAlerts = lazy(() => import("./pages/ComplianceAlerts"));
const ComplianceAnalytics = lazy(() => import("./pages/ComplianceAnalytics"));
const MLRODashboard = lazy(() => import("./pages/MLRODashboard"));
const SARHistory = lazy(() => import("./pages/SARHistory"));
const OfficerWorkload = lazy(() => import("./pages/OfficerWorkload"));
const SecurityEventsLog = lazy(() => import("./pages/SecurityEventsLog"));
const MFASettings = lazy(() => import("./pages/MFASettings"));
const FeeRulesEngine = lazy(() => import("./pages/FeeRulesEngine"));
const GlobalSearch = lazy(() => import("./pages/GlobalSearch"));
const TransferAuditTrail = lazy(() => import("./pages/TransferAuditTrail"));
const AdminBulkActions = lazy(() => import("./pages/AdminBulkActions"));
// v86 Production Features
const PromoCodesAdmin = lazy(() => import("./pages/PromoCodesAdmin"));
const DailyVolumeWidget = lazy(() => import("./pages/DailyVolumeWidget"));
const ScheduledTransfersV2 = lazy(() => import("./pages/ScheduledTransfersV2"));
const LiveFXCalculator = lazy(() => import("./pages/LiveFXCalculator"));
// v87 — AI/ML Integration Layer
const AIHub = lazy(() => import("./pages/AIHub"));
const VectorSearchPage = lazy(() => import("./pages/VectorSearchPage"));
const KnowledgeGraphPage = lazy(() => import("./pages/KnowledgeGraphPage"));
const OllamaChatPage = lazy(() => import("./pages/OllamaChatPage"));
const ARTAgentPage = lazy(() => import("./pages/ARTAgentPage"));
const KGQAPage = lazy(() => import("./pages/KGQAPage"));
const LakehousePage = lazy(() => import("./pages/LakehousePage"));
const CocoIndexPage = lazy(() => import("./pages/CocoIndexPage"));
const SimilarTransactionsPage = lazy(() => import("./pages/SimilarTransactionsPage"));
const AIMetricsDashboard = lazy(() => import("./pages/AIMetricsDashboard"));
const GPUTrainingEngine = lazy(() => import("./pages/GPUTrainingEngine"));
// v89 — Production Hardening & Data Pipelines
const WebhookRetryPage = lazy(() => import("./pages/WebhookRetryPage"));
const TenantConfigPage = lazy(() => import("./pages/TenantConfigPage"));
const PartnerPayoutsV2Page = lazy(() => import("./pages/PartnerPayoutsV2Page"));
const ComplianceScoringPage = lazy(() => import("./pages/ComplianceScoringPage"));
const SmartRoutingV2Page = lazy(() => import("./pages/SmartRoutingV2Page"));
const NotificationCenterV2Page = lazy(() => import("./pages/NotificationCenterV2Page"));
const AuditTrailV2Page = lazy(() => import("./pages/AuditTrailV2Page"));
const FeeRulesCRUDPage = lazy(() => import("./pages/FeeRulesCRUDPage"));
const FeeNegotiationPage = lazy(() => import("./pages/FeeNegotiationPage"));
const MultiHopRoutingPage = lazy(() => import("./pages/MultiHopRoutingPage"));
const TransferLimitsV2Page = lazy(() => import("./pages/TransferLimitsV2Page"));
const ReconciliationV2Page = lazy(() => import("./pages/ReconciliationV2Page"));
const FeeRulesCRUDV2Page = lazy(() => import("./pages/FeeRulesCRUDV2Page"));
const SystemHealthDashboardV2 = lazy(() => import("./pages/SystemHealthDashboardV2"));
const FXHedgingPage = lazy(() => import("./pages/FXHedgingPage"));
const TreasuryDashboardPage = lazy(() => import("./pages/TreasuryDashboardPage"));
const LiquidityMonitorPage = lazy(() => import("./pages/LiquidityMonitorPage"));
const MerchantOnboardingPage = lazy(() => import("./pages/MerchantOnboardingPage"));
const CarbonOffsetPage = lazy(() => import("./pages/CarbonOffsetPage"));
const SWIFTTrackerPage = lazy(() => import("./pages/SWIFTTrackerPage"));
const LoyaltyRewardsV2Page = lazy(() => import("./pages/LoyaltyRewardsV2Page"));
const NotificationCenterPage = lazy(() => import("./pages/NotificationCenterPage"));
const KYCLifecyclePage = lazy(() => import("./pages/KYCLifecyclePage"));
const MultiCurrencyLedgerPage = lazy(() => import("./pages/MultiCurrencyLedgerPage"));
const DataPipelinesPage = lazy(() => import("./pages/DataPipelinesPage"));
// v92 — Production Finalization
const TransactionSearch = lazy(() => import("./pages/TransactionSearch"));
const KYCAdminQueue = lazy(() => import("./pages/KYCAdminQueue"));
const LivenessAuditPage = lazy(() => import("./pages/LivenessAuditPage"));
const TransferLimits = lazy(() => import("./pages/TransferLimits"));
const BrandingPreview = lazy(() => import("./pages/BrandingPreview"));
const SecurityAuditReport = lazy(() => import("./pages/SecurityAuditReport"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
// v94 features
const ABTestingAdmin = lazy(() => import("./pages/ABTestingAdmin"));
const ReferralDashboard = lazy(() => import("./pages/ReferralDashboard"));
const DocumentVaultPage = lazy(() => import("./pages/DocumentVaultPage"));
const RateAlertHistoryPage = lazy(() => import("./pages/RateAlertHistoryPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
// v91 — Partner Applications & Onboarding
const PartnerApply = lazy(() => import("./pages/PartnerApply"));
const PartnerApplicationStatus = lazy(() => import("./pages/PartnerApplicationStatus"));
const AdminPartnerApplications = lazy(() => import("./pages/AdminPartnerApplications"));
const PartnerSelfService = lazy(() => import("./pages/PartnerSelfService"));
const UserOnboarding = lazy(() => import("./pages/UserOnboarding"));
const ComplianceEmailConfig = lazy(() => import("./pages/ComplianceEmailConfig"));
// v90 — Production Complete
const RealTimeTransactionMonitor = lazy(() => import("./pages/RealTimeTransactionMonitor"));
const FraudDetectionV2Page = lazy(() => import("./pages/FraudDetectionV2Page"));
const FXStreamingPage = lazy(() => import("./pages/FXStreamingPage"));
const SanctionsScreeningPage = lazy(() => import("./pages/SanctionsScreeningPage"));
const PaymentRailsPage = lazy(() => import("./pages/PaymentRailsPage"));
const RegulatoryReportingPage = lazy(() => import("./pages/RegulatoryReportingPage"));
const OpenBankingPage = lazy(() => import("./pages/OpenBankingPage"));
const GrafanaDashboardPage = lazy(() => import("./pages/GrafanaDashboardPage"));
const BulkPaymentsV2Page = lazy(() => import("./pages/BulkPaymentsV2Page"));
const DisputeManagementPage = lazy(() => import("./pages/DisputeManagementPage"));
const RevenueAnalyticsPage = lazy(() => import("./pages/RevenueAnalyticsPage"));
const ComplianceMetricsDashboard = lazy(() => import("./pages/ComplianceMetricsDashboard"));
const BeneficiaryManager = lazy(() => import("./pages/BeneficiaryManager"));
const PromoCodeAdmin = lazy(() => import("./pages/PromoCodeAdmin"));
const FeatureFlagAdmin = lazy(() => import("./pages/FeatureFlagAdmin"));
const SystemConfigAdmin = lazy(() => import("./pages/SystemConfigAdmin"));
const AuditLogViewer = lazy(() => import("./pages/AuditLogViewer"));
const TenantAdmin = lazy(() => import("./pages/TenantAdmin"));
const WebhookAdmin = lazy(() => import("./pages/WebhookAdmin"));
const ApiKeyAdminPage = lazy(() => import("./pages/ApiKeyAdminPage"));
const AuditLogAdmin = lazy(() => import("./pages/AuditLogAdmin"));
const FeatureFlagsAdmin = lazy(() => import("./pages/FeatureFlagsAdmin"));
const TenantFeatureFlagsAdmin = lazy(() => import("./pages/TenantFeatureFlagsAdmin"));
const BatchPaymentAdmin = lazy(() => import("./pages/BatchPaymentAdmin"));
const DocumentVaultRenewal = lazy(() => import("./pages/DocumentVaultRenewal"));
const VelocityCheckDashboard = lazy(() => import("./pages/VelocityCheckDashboard"));
const StripePaymentHistory = lazy(() => import("./pages/StripePaymentHistory"));
const KYCLifecycleTracker = lazy(() => import("./pages/KYCLifecycleTracker"));
// v98 New Pages
const KafkaDashboardV98 = lazy(() => import("./pages/KafkaDashboard"));
const TransactionExportV98 = lazy(() => import("./pages/TransactionExport"));
const CTRComplianceV98 = lazy(() => import("./pages/CTRCompliance"));
const CBDCAdminV98 = lazy(() => import("./pages/CBDCAdmin"));
const CommunityFeedV98 = lazy(() => import("./pages/CommunityFeed"));
const SecurityScoreV98 = lazy(() => import("./pages/SecurityScore"));
const BulkUserActionsV98 = lazy(() => import("./pages/BulkUserActions"));
const StripeRetryAdminV98 = lazy(() => import("./pages/StripeRetryAdmin"));
const IPLoginHistoryV98 = lazy(() => import("./pages/IPLoginHistory"));
const LedgerReconciliationV98 = lazy(() => import("./pages/LedgerReconciliation"));
const RevenueAnalyticsV98 = lazy(() => import("./pages/RevenueAnalytics"));
const GDPRErasureV98 = lazy(() => import("./pages/GDPRErasure"));
const CircuitBreakerDashboard = lazy(() => import("./pages/CircuitBreakerDashboard"));
const LoadTestDashboard = lazy(() => import("./pages/LoadTestDashboard"));
const CronJobsAdmin = lazy(() => import("./pages/CronJobsAdmin"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const PaymentCancel = lazy(() => import("./pages/PaymentCancel"));
const SelfUnlock = lazy(() => import("./pages/SelfUnlock"));
const RevenueSharePWA = lazy(() => import("./pages/RevenueSharePWA"));
const AdminRevenueShare = lazy(() => import("./pages/AdminRevenueShare"));
const AdminDigitalAgreements = lazy(() => import("./pages/AdminDigitalAgreements"));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard"));
const ServicesHealthDashboard = lazy(() => import("./pages/ServicesHealthDashboard"));
const LakehouseAnalytics = lazy(() => import("./pages/LakehouseAnalytics"));
const SecurityAttackSimulator = lazy(() => import("./pages/SecurityAttackSimulator"));
const ChatAgentDashboard = lazy(() => import("./pages/ChatAgentDashboard"));
// v115 Production Features
const RequestMoney = lazy(() => import("./pages/RequestMoney"));
const SplitBill = lazy(() => import("./pages/SplitBill"));
const TransactionReceipt = lazy(() => import("./pages/TransactionReceipt"));
const PayRequest = lazy(() => import("./pages/PayRequest"));
const AgentRegister = lazy(() => import("@/pages/AgentRegister"));
const SupportTickets = lazy(() => import("@/pages/SupportTickets"));
const AgentKYBAdmin = lazy(() => import("@/pages/AgentKYBAdmin"));
const PWADashboard = lazy(() => import("./pages/PWADashboard"));
// v197 Outbound Revenue Capture
const SendFromNigeria = lazy(() => import("./pages/SendFromNigeria"));
const EducationPayments = lazy(() => import("./pages/EducationPayments"));
const MedicalTourism = lazy(() => import("./pages/MedicalTourism"));
const FormalizationDashboard = lazy(() => import("./pages/FormalizationDashboard"));
const OutboundRevenueModel = lazy(() => import("./pages/OutboundRevenueModel"));
const RecipientOnboarding = lazy(() => import("./pages/RecipientOnboarding"));

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={LandingPage} />
              <Route path="/app" component={Home} />
        <Route path="/dashboard" component={Dashboard} />
        {/* Core Banking */}
        <Route path="/wallet" component={Wallet} />
        <Route path="/send" component={SendMoney} />
        <Route path="/send-money" component={SendMoney} />
        <Route path="/receive" component={ReceiveMoney} />
        <Route path="/transactions" component={Transactions} />
        <Route path="/exchange" component={ExchangeRates} />
        {/* Payments & Services */}
        <Route path="/airtime" component={Airtime} />
        <Route path="/bills" component={Bills} />
        <Route path="/virtual-account" component={VirtualAccount} />
        <Route path="/cards" component={Cards} />
        <Route path="/batch-payments" component={BatchPayments} />
        <Route path="/fx-alerts" component={FXAlerts} />
        <Route path="/tracking" component={TransferTracking} />
        <Route path="/recurring" component={RecurringPayments} />
        <Route path="/qr-code" component={QRCode} />
        <Route path="/request-money" component={RequestMoney} />
          <Route path="/split-bill" component={SplitBill} />
        <Route path="/transactions/:id/receipt" component={TransactionReceipt} />
        <Route path="/pay/:token" component={PayRequest} />
        <Route path="/direct-debit" component={DirectDebit} />
        <Route path="/mpesa" component={MPesa} />
        <Route path="/wise" component={WiseTransfer} />
        {/* Compliance */}
        <Route path="/kyc" component={KYCVerification} />
        <Route path="/kyc-verification" component={KYCVerification} />
        <Route path="/property-kyc" component={PropertyKYC} />
        <Route path="/travel-rule" component={TravelRule} />
        <Route path="/fca-compliance" component={FCACompliance} />
        <Route path="/gdpr" component={GDPRData} />
        <Route path="/consent" component={ConsentManagement} />
        <Route path="/dpia" component={DPIA} />
        <Route path="/audit-logs" component={AuditLogs} />
        <Route path="/disputes" component={Disputes} />
        {/* Advanced Fintech */}
        <Route path="/mojaloop" component={Mojaloop} />
        <Route path="/cbdc" component={CBDC} />
        <Route path="/bnpl" component={BNPL} />
        <Route path="/stablecoin" component={Stablecoin} />
        <Route path="/savings" component={SavingsGoals} />
        <Route path="/referral" component={Referral} />
        <Route path="/corridors" component={CorridorPricing} />
        <Route path="/checkout-sdk" component={CheckoutSDK} />
        {/* Account */}
        <Route path="/profile" component={Profile} />
        <Route path="/security" component={SecuritySettings} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/notification-preferences" component={NotificationPreferences} />
        <Route path="/settings" component={Settings} />
        <Route path="/support" component={Support} />
        <Route path="/live-chat" component={LiveChat} />
        <Route path="/help" component={Help} />
        <Route path="/beneficiaries" component={Beneficiaries} />
        <Route path="/payment-methods" component={PaymentMethods} />
        {/* Operations */}
        <Route path="/pos" component={POSManagement} />
        <Route path="/agents" component={AgentNetwork} />
        <Route path="/changelog" component={APIChangelog} />
        <Route path="/account-health" component={AccountHealth} />
        <Route path="/payment-performance" component={PaymentPerformance} />
        <Route path="/rate-lock" component={RateLock} />
                <Route path="/kyc-basic" component={KYC} />
        <Route path="/savings-basic" component={Savings} />
        <Route path="/recurring-basic" component={Recurring} />
        <Route path="/calculator" component={RateCalculator} />
        {/* v6 New Features */}
        <Route path="/fraud-monitor" component={FraudMonitor} />
        <Route path="/rate-alerts" component={FXRateAlerts} />
        {/* v20 Analytics */}
        <Route path="/analytics" component={Analytics} />
        {/* v25 Admin */}
        <Route path="/admin/users" component={AdminUsers} />
        {/* v26 Admin KYC */}
        <Route path="/admin/kyc" component={AdminKYC} />
        {/* v27 Admin Compliance */}
        <Route path="/admin/compliance" component={AdminCompliance} />
        {/* v29 Admin Audit Log */}
        <Route path="/admin/audit-log" component={AdminAuditLog} />
        {/* v35 Admin Analytics */}
        <Route path="/admin/analytics" component={AdminAnalytics} />
        <Route path="/admin/transfer-analytics" component={TransferAnalytics} />
        <Route path="/admin/disputes" component={AdminDisputes} />
        <Route path="/transfers/:id/dispute" component={TransferDisputeForm} />
        {/* v41 Polyglot Microservices */}
        <Route path="/admin/microservices" component={AdminMicroservices} />
        {/* v77 Corridor Pricing Admin */}
        <Route path="/admin/corridor-pricing" component={CorridorPricingAdmin} />
        {/* v46 Nav Analytics */}
        <Route path="/admin/nav-analytics" component={AdminNavAnalytics} />
        {/* v62 Admin Tools */}
        <Route path="/admin/seed-data" component={AdminSeedData} />
        <Route path="/admin/stripe-test" component={AdminStripeTest} />
        <Route path="/admin/readiness" component={AdminReadiness} />
        <Route path="/admin/scheduled-jobs" component={AdminScheduledJobs} />
        {/* v65 Feature Flags & Tenants */}
        <Route path="/admin/feature-flags" component={AdminFeatureFlags} />
        <Route path="/admin/tenants" component={AdminTenants} />
        <Route path="/admin/white-label" component={AdminWhiteLabel} />
        {/* v68 Partner Onboarding & White Label */}
        <Route path="/partner/onboard" component={PartnerOnboard} />
        {/* v91 Partner Applications & Onboarding */}
        <Route path="/partner/apply" component={PartnerApply} />
        <Route path="/partner/application/:slug" component={PartnerApplicationStatus} />
        <Route path="/partner/portal" component={PartnerSelfService} />
        <Route path="/admin/partner-applications" component={AdminPartnerApplications} />
        <Route path="/onboarding" component={UserOnboarding} />
        <Route path="/admin/compliance-email" component={ComplianceEmailConfig} />
        <Route path="/partner/my-tenants" component={MyTenants} />
        <Route path="/tenant/:slug/dashboard" component={TenantDashboard} />
        <Route path="/admin/invite-codes" component={AdminInviteCodes} />
        <Route path="/admin/email-preview/bdc-onboarding" component={BdcOnboardingEmailPreview} />
        {/* v197 Outbound Revenue Capture Routes */}
        <Route path="/send-abroad" component={SendFromNigeria} />
        <Route path="/education-payments" component={EducationPayments} />
        <Route path="/medical-tourism" component={MedicalTourism} />
        <Route path="/formalization" component={FormalizationDashboard} />
        <Route path="/admin/revenue-model" component={OutboundRevenueModel} />
        <Route path="/recipient-onboarding" component={RecipientOnboarding} />
        <Route path="/admin/partner-analytics" component={PartnerAnalytics} />
        {/* v73 Production Pages */}
        <Route path="/admin/partner-payouts" component={PartnerPayouts} />
        <Route path="/developer/webhooks" component={WebhookManager} />
        <Route path="/developer/api-keys" component={APIKeyManager} />
        <Route path="/admin/compliance-watchlist" component={ComplianceWatchlistPage} />
        <Route path="/admin/system-config" component={SystemConfigPage} />
        {/* v74 Diaspora Investment Hub */}
        <Route path="/invest/portfolio" component={InvestmentPortfolio} />
        <Route path="/invest/stocks" component={NGXStockMarket} />
        <Route path="/invest/real-estate" component={RealEstateHub} />
        <Route path="/invest/startups" component={StartupDealRoom} />
        {/* v39 Diaspora Products */}
        <Route path="/invest" component={DiasporaInvest} />
        <Route path="/diaspora-invest" component={DiasporaInvest} />
        <Route path="/goals" component={TransferGoals} />
        <Route path="/talent" component={TalentBridge} />
        <Route path="/talent-bridge" component={TalentBridge} />
        <Route path="/community" component={Community} />
        {/* v42 AfriMarket */}
        <Route path="/marketplace" component={AfriMarket} />
        <Route path="/afrimarket" component={AfriMarket} />
        {/* v43 Family Dashboard */}
        <Route path="/family" component={FamilyDashboard} />
        {/* v44 Community Hub */}
        <Route path="/community-hub" component={CommunityHub} />
        {/* v49 Investment & Community Leaderboard */}
        <Route path="/beyond-remittance" component={BeyondRemittance} />
        <Route path="/community/leaderboard" component={CommunityLeaderboard} />
        {/* v58 Country Landing Pages */}
        <Route path="/send-to-nigeria" component={SendToNigeria} />
        <Route path="/send-to-ghana" component={SendToGhana} />
        <Route path="/send-to-kenya" component={SendToKenya} />
        <Route path="/send-to-senegal" component={SendToSenegal} />
        <Route path="/send-to-cameroon" component={SendToCameroon} />
        <Route path="/send-to-south-africa" component={SendToSouthAfrica} />
        <Route path="/send-to-uganda" component={SendToUganda} />
        <Route path="/send-to-tanzania" component={SendToTanzania} />
        <Route path="/diaspora-uk" component={DiasporaUK} />
        {/* v30 Admin Home */}
        <Route path="/admin" component={AdminHome} />
        {/* v81 PWA Features Showcase */}
        <Route path="/pwa-features" component={PWAFeatures} />
        {/* v82 Production Features */}
        <Route path="/treasury" component={TreasuryManagement} />
        <Route path="/sla-monitor" component={SLAMonitor} />
        <Route path="/document-vault" component={DocumentVault} />
        <Route path="/chargebacks" component={ChargebackManager} />
        <Route path="/notification-center" component={NotificationCenter} />
        <Route path="/fx-hedging" component={FXHedging} />
        {/* v84 Production Features */}
        <Route path="/stripe-receipts" component={StripeReceipts} />
        <Route path="/api-usage" component={APIUsageDashboard} />
        <Route path="/smart-routing" component={SmartRoutingDashboard} />
        <Route path="/compliance-reporting" component={ComplianceReporting} />
        <Route path="/developer-sandbox" component={DeveloperSandbox} />
        <Route path="/push-notifications" component={VAPIDPushManager} />
        {/* v85 Production Features */}
        <Route path="/sandbox-scenarios" component={SandboxScenarios} />
        <Route path="/compliance-alerts" component={ComplianceAlerts} />
        <Route path="/admin/compliance-analytics" component={ComplianceAnalytics} />
        <Route path="/admin/mlro" component={MLRODashboard} />
        <Route path="/admin/sar-history" component={SARHistory} />
        <Route path="/admin/officer-workload" component={OfficerWorkload} />
        <Route path="/security-events" component={SecurityEventsLog} />
        <Route path="/mfa-settings" component={MFASettings} />
        <Route path="/fee-rules" component={FeeRulesEngine} />
        <Route path="/search" component={GlobalSearch} />
        <Route path="/transfer-audit" component={TransferAuditTrail} />
        <Route path="/admin/bulk-actions" component={AdminBulkActions} />
        {/* v86 Production Features */}
        <Route path="/admin/promo-codes" component={PromoCodesAdmin} />
        <Route path="/daily-volume" component={DailyVolumeWidget} />
        <Route path="/scheduled-transfers" component={ScheduledTransfersV2} />
        <Route path="/fx-calculator" component={LiveFXCalculator} />
        {/* v87 — AI/ML Integration Layer */}
        <Route path="/ai-hub" component={AIHub} />
        <Route path="/vector-search" component={VectorSearchPage} />
        <Route path="/knowledge-graph" component={KnowledgeGraphPage} />
        <Route path="/ollama-chat" component={OllamaChatPage} />
        <Route path="/art-agent" component={ARTAgentPage} />
        <Route path="/kgqa" component={KGQAPage} />
        <Route path="/lakehouse" component={LakehousePage} />
        <Route path="/cocoindex" component={CocoIndexPage} />
        {/* v88 — AI Metrics & Similarity */}
        <Route path="/similar-transactions" component={SimilarTransactionsPage} />
        <Route path="/ai-metrics" component={AIMetricsDashboard} />
        <Route path="/gpu-training" component={GPUTrainingEngine} />
        {/* v89 — Production Hardening & Data Pipelines */}
        <Route path="/webhook-retry" component={WebhookRetryPage} />
        <Route path="/tenant-config" component={TenantConfigPage} />
        <Route path="/partner-payouts-v2" component={PartnerPayoutsV2Page} />
        <Route path="/compliance-scoring" component={ComplianceScoringPage} />
        <Route path="/smart-routing-v2" component={SmartRoutingV2Page} />
        <Route path="/notifications-v2" component={NotificationCenterV2Page} />
        <Route path="/audit-trail-v2" component={AuditTrailV2Page} />
        <Route path="/fee-rules-crud" component={FeeRulesCRUDPage} />
        <Route path="/fee-negotiation" component={FeeNegotiationPage} />
        <Route path="/multi-hop-routing" component={MultiHopRoutingPage} />
        <Route path="/transfer-limits-v2" component={TransferLimitsV2Page} />
        <Route path="/reconciliation-v2" component={ReconciliationV2Page} />
        <Route path="/fee-rules-v2" component={FeeRulesCRUDV2Page} />
        <Route path="/system-health-v2" component={SystemHealthDashboardV2} />
        <Route path="/fx-hedging" component={FXHedgingPage} />
        <Route path="/treasury" component={TreasuryDashboardPage} />
        <Route path="/liquidity" component={LiquidityMonitorPage} />
        <Route path="/merchant-onboarding" component={MerchantOnboardingPage} />
        <Route path="/carbon-offset" component={CarbonOffsetPage} />
        <Route path="/swift-tracker" component={SWIFTTrackerPage} />
        <Route path="/loyalty-v2" component={LoyaltyRewardsV2Page} />
        <Route path="/notifications" component={NotificationCenterPage} />
        <Route path="/kyc-lifecycle" component={KYCLifecyclePage} />
        <Route path="/ledger" component={MultiCurrencyLedgerPage} />
        <Route path="/data-pipelines" component={DataPipelinesPage} />
        {/* v90 — Production Complete */}
        <Route path="/realtime-monitor" component={RealTimeTransactionMonitor} />
        <Route path="/fraud-detection-v2" component={FraudDetectionV2Page} />
        <Route path="/fx-streaming" component={FXStreamingPage} />
        <Route path="/sanctions-screening" component={SanctionsScreeningPage} />
        <Route path="/payment-rails" component={PaymentRailsPage} />
        <Route path="/regulatory-reporting" component={RegulatoryReportingPage} />
        <Route path="/open-banking" component={OpenBankingPage} />
        <Route path="/grafana" component={GrafanaDashboardPage} />
        <Route path="/bulk-payments-v2" component={BulkPaymentsV2Page} />
        <Route path="/disputes" component={DisputeManagementPage} />
        <Route path="/revenue-analytics" component={RevenueAnalyticsPage} />
        {/* v92 — Production Finalization */}
        <Route path="/transactions/search" component={TransactionSearch} />
        <Route path="/admin/kyc-queue" component={KYCAdminQueue} />
        <Route path="/admin/liveness-audit" component={LivenessAuditPage} />
        <Route path="/transfer-limits" component={TransferLimits} />
        <Route path="/partner/branding-preview" component={BrandingPreview} />
        <Route path="/admin/security-audit" component={SecurityAuditReport} />
        <Route path="/admin/security-dashboard" component={SecurityDashboard} />
        <Route path="/admin/services-health" component={ServicesHealthDashboard} />
        <Route path="/admin/lakehouse-analytics" component={LakehouseAnalytics} />
        <Route path="/admin/attack-simulator" component={SecurityAttackSimulator} />
              <Route path="/settings/notifications" component={NotificationSettings} />
        {/* v94 features */}
        <Route path="/ab-testing" component={ABTestingAdmin} />
        <Route path="/referral-dashboard" component={ReferralDashboard} />
        <Route path="/document-vault-v2" component={DocumentVaultPage} />
        <Route path="/rate-alert-history" component={RateAlertHistoryPage} />
        <Route path="/admin/compliance-metrics" component={ComplianceMetricsDashboard} />
        <Route path="/admin/beneficiaries" component={BeneficiaryManager} />
        <Route path="/admin/promo-codes" component={PromoCodeAdmin} />
        <Route path="/admin/feature-flags" component={FeatureFlagAdmin} />
        <Route path="/admin/system-config" component={SystemConfigAdmin} />
        <Route path="/admin/system-config-v2" component={SystemConfigAdmin} />
        <Route path="/admin/audit-logs" component={AuditLogViewer} />
        <Route path="/admin/tenants" component={TenantAdmin} />
        <Route path="/admin/webhooks" component={WebhookAdmin} />
        <Route path="/admin/api-keys" component={ApiKeyAdminPage} />
        <Route path="/admin/audit-logs" component={AuditLogAdmin} />
        <Route path="/admin/feature-flags-v2" component={FeatureFlagsAdmin} />
        <Route path="/admin/tenant-feature-flags" component={TenantFeatureFlagsAdmin} />
        <Route path="/admin/batch-payments" component={BatchPaymentAdmin} />
        <Route path="/admin/document-renewal" component={DocumentVaultRenewal} />
        <Route path="/admin/velocity-checks" component={VelocityCheckDashboard} />
        <Route path="/payments/history" component={StripePaymentHistory} />
        <Route path="/admin/kyc-lifecycle" component={KYCLifecycleTracker} />
        {/* v98 Routes */}
        <Route path="/admin/kafka" component={KafkaDashboardV98} />
        <Route path="/transactions/export" component={TransactionExportV98} />
        <Route path="/admin/ctr-compliance" component={CTRComplianceV98} />
        <Route path="/admin/cbdc" component={CBDCAdminV98} />
        <Route path="/community-feed" component={CommunityFeedV98} />
        <Route path="/admin/security-score" component={SecurityScoreV98} />
        <Route path="/admin/bulk-users" component={BulkUserActionsV98} />
        <Route path="/admin/stripe-webhooks" component={StripeRetryAdminV98} />
        <Route path="/admin/ip-login-history" component={IPLoginHistoryV98} />
        <Route path="/fx-rate-alerts" component={FXRateAlerts} />
        <Route path="/admin/ledger-reconciliation" component={LedgerReconciliationV98} />
        <Route path="/admin/revenue" component={RevenueAnalyticsV98} />
        <Route path="/settings/privacy" component={GDPRErasureV98} />
        <Route path="/admin/circuit-breakers" component={CircuitBreakerDashboard} />
        <Route path="/admin/load-test" component={LoadTestDashboard} />
        <Route path="/admin/cron-jobs" component={CronJobsAdmin} />
          <Route path="/payment/success" component={PaymentSuccess} />
          <Route path="/payment/cancel" component={PaymentCancel} />
          <Route path="/unlock" component={SelfUnlock} />
          <Route path="/admin/aml-batch" component={AMLBatchEnginePage} />
          <Route path="/admin/settlement-netting" component={SettlementNettingPage} />
          <Route path="/admin/liquidity-stress" component={LiquidityStressTestPage} />
          <Route path="/wallet/multi-currency-v2" component={MultiCurrencyWalletV2Page} />
          <Route path="/admin/cross-border-compliance" component={CrossBorderCompliancePage} />
          <Route path="/admin/merchant-kyb" component={MerchantKYBPage} />
          <Route path="/admin/document-ocr" component={DocumentOCRPage} />
          <Route path="/admin/fx-options" component={FXOptionsPricingPage} />
          <Route path="/admin/regulatory-reporting" component={RegulatoryReportingPage} />
          <Route path="/admin/revenue-share" component={AdminRevenueShare} />
          <Route path="/partner/revenue-share" component={RevenueSharePWA} />
          <Route path="/admin/digital-agreements" component={AdminDigitalAgreements} />
          <Route path="/partners/apply" component={PartnerApply} />
          <Route path="/admin/chat-agent" component={ChatAgentDashboard} />
        <Route path="/pwa-dashboard" component={PWADashboard} />
        <Route path="/admin/pbac-policies" component={PBACPolicies} />
        <Route path="/send-crypto" component={lazy(() => import('./pages/SendCrypto'))} />
        <Route path="/admin/rails-health" component={lazy(() => import('./pages/RailsHealthDashboard'))} />
        <Route path="/agent/pos" component={lazy(() => import('./pages/AgentPOS'))} />
        <Route path="/agent/register" component={AgentRegister} />
              <Route path="/support/tickets" component={SupportTickets} />
        <Route path="/admin/agent-kyb" component={AgentKYBAdmin} />
        <Route path="/transfers" component={lazy(() => import('./pages/MyTransfers'))} />
        <Route path="/admin/cbn-compliance" component={lazy(() => import('./pages/CbnComplianceDashboard'))} />
        <Route path="/compliance/rates" component={lazy(() => import('./pages/PapssCompliance'))} />
        <Route path="/partners/bdc" component={lazy(() => import('./pages/BDCPartnerPortal'))} />
        {/* v200 — West African XOF Corridors */}
        <Route path="/send/togo" component={lazy(() => import('./pages/SendToTogo'))} />
        <Route path="/send/niger" component={lazy(() => import('./pages/SendToNiger'))} />
        <Route path="/send/mali" component={lazy(() => import('./pages/SendToMali'))} />
        <Route path="/send/benin" component={lazy(() => import('./pages/SendToBenin'))} />
        {/* v200 — Immigrant Worker & Tiered KYC */}
        <Route path="/send/immigrant-worker" component={lazy(() => import('./pages/ImmigrantWorkerSend'))} />
        <Route path="/kyc/tiered" component={lazy(() => import('./pages/TieredKYCFlow'))} />
        <Route path="/agent/cash-in" component={lazy(() => import('./pages/AgentCashIn'))} />
        {/* v200 — HNW Private Banking */}
        <Route path="/private-banking" component={lazy(() => import('./pages/PrivateBankingDashboard'))} />
        {/* v200 — Correspondent Bank Admin */}
        <Route path="/admin/correspondent-banks" component={lazy(() => import('./pages/CorrespondentBankAdmin'))} />
        {/* v200 — SME Trade Payments */}
        <Route path="/sme/trade-payment" component={lazy(() => import('./pages/SMETradePayment'))} />
        {/* v203 — Form M UI */}
        <Route path="/sme/form-m-history" component={lazy(() => import('./pages/SmeTradeFormMHistory'))} />
        <Route path="/compliance/form-m-audit" component={lazy(() => import('./pages/ComplianceFormMAudit'))} />
        {/* v200 — Diaspora Acquisition */}
        <Route path="/diaspora/usa" component={lazy(() => import('./pages/DiasporaUSA'))} />
        <Route path="/diaspora/italy" component={lazy(() => import('./pages/DiasporaItaly'))} />
        <Route path="/diaspora/canada" component={lazy(() => import('./pages/DiasporaCanada'))} />
        <Route path="/diaspora/eu" component={lazy(() => import('./pages/DiasporaEU'))} />
        <Route path="/admin/component-showcase" component={lazy(() => import('./pages/ComponentShowcase'))} />
        {/* v206 — Billing Engine Dashboard */}
        <Route path="/admin/billing-engine" component={lazy(() => import('./pages/BillingEngineDashboard'))} />
        <Route path="/admin/tenants/new" component={lazy(() => import('./pages/TenantOnboardingWizard'))} />
        <Route path="/treasury/float-income" component={lazy(() => import('./pages/FloatIncomeDashboard'))} />
        <Route path="/marketplace/cross-sell" component={lazy(() => import('./pages/CrossSellMarketplace'))} />
        {/* v214 — Business Presentation Deck */}
        <Route path="/presentation" component={lazy(() => import('./pages/PresentationDeck'))} />
        {/* Global Payroll & Diaspora Bond */}
        <Route path="/payroll" component={lazy(() => import('./pages/GlobalPayroll'))} />
        <Route path="/bonds" component={lazy(() => import('./pages/DiasporaBondMarket'))} />
        {/* Tier 1 — Business Finance */}
        <Route path="/expense-management" component={lazy(() => import('./pages/ExpenseManagement'))} />
        <Route path="/contractor-payments" component={lazy(() => import('./pages/ContractorPayments'))} />
        <Route path="/merchant-kyb" component={lazy(() => import('./pages/MerchantKYBReview'))} />
        <Route path="/payroll-tax" component={lazy(() => import('./pages/PayrollTaxFiling'))} />
        {/* Tier 2 — Trade Finance */}
        <Route path="/business-savings" component={lazy(() => import('./pages/BusinessSavings'))} />
        <Route path="/bond-market" component={lazy(() => import('./pages/BondSecondaryMarket'))} />
        <Route path="/letter-of-credit" component={lazy(() => import('./pages/LetterOfCredit'))} />
        <Route path="/invoice-financing" component={lazy(() => import('./pages/InvoiceFinancing'))} />
        <Route path="/payroll-run" component={lazy(() => import('./pages/PayrollRun'))} />
        {/* Tier 3 — Advanced Products */}
        <Route path="/embedded-payroll-api" component={lazy(() => import('./pages/EmbeddedPayrollAPI'))} />
        <Route path="/diaspora-mortgage" component={lazy(() => import('./pages/DiasporaMortgage'))} />
        <Route path="/credit-scoring" component={lazy(() => import('./pages/BusinessCreditScoring'))} />
        <Route path="/esg-reporting" component={lazy(() => import('./pages/ESGReporting'))} />
        <Route path="/bill-payment" component={lazy(() => import('./pages/BillPayment'))} />
        <Route path="/qr-pay" component={lazy(() => import('./pages/QRPay'))} />
        <Route path="/transaction-history" component={lazy(() => import('./pages/TransactionHistory'))} />
        <Route path="/hnw-private-banking" component={lazy(() => import('./pages/HNWPrivateBanking'))} />
        <Route path="/trisa-compliance" component={lazy(() => import('./pages/TrisaCompliance'))} />
        <Route path="/business-kpi" component={lazy(() => import('./pages/BusinessKPIDashboard'))} />
        <Route path="/smart-notifications" component={lazy(() => import('./pages/SmartNotifications'))} />
        <Route path="/recipient-tracking" component={lazy(() => import('./pages/RecipientTracking'))} />
        <Route path="/advanced-fx" component={lazy(() => import('./pages/AdvancedFX'))} />
        <Route path="/agent-intelligence" component={lazy(() => import('./pages/AgentIntelligenceDashboard'))} />
        <Route path="/sme-dashboard" component={lazy(() => import('./pages/SMEDashboard'))} />
        <Route path="/remit-ai" component={lazy(() => import('./pages/RemitAIChat'))} />
        <Route path="/micro-insurance" component={lazy(() => import('./pages/MicroInsurance'))} />
        <Route path="/savings-circles" component={lazy(() => import('./pages/SavingsCircles'))} />
        <Route path="/baas-portal" component={lazy(() => import('./pages/BaaSPortal'))} />
        <Route path="/programmable-money" component={lazy(() => import('./pages/ProgrammableMoney'))} />
        <Route path="/regulatory-reports" component={lazy(() => import('./pages/RegulatoryReports'))} />
        <Route path="/support-tickets" component={lazy(() => import('./pages/SupportTickets'))} />
        <Route path="/ab-testing" component={lazy(() => import('./pages/ABTestingDashboard'))} />
        <Route path="/referral-dashboard" component={lazy(() => import('./pages/ReferralDashboard'))} />
        <Route component={NotFound} />
        </Switch>
    </Suspense>
  );
}

function VersionChecker() {
  useVersionCheck();
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable={true}>
        <TooltipProvider>
          <VersionChecker />
          <PWAOfflineBanner />
          <PWAUpdateBanner />
          <Toaster richColors position="top-right" />
          {/* Global connection quality badge — visible on all pages */}
          <div className="fixed bottom-16 right-3 z-50 md:bottom-4">
            <ConnectionQualityIndicator variant="badge" />
          </div>
          <Router />
          <PWAInstallPrompt />
          <MobileBottomNav />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
