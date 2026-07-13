/**
 * Domain Router Index — P0 Backend 1.1
 *
 * Thin aggregation layer that re-exports all domain routers.
 * The monolith routers.ts (6,543 lines) remains as-is for backward
 * compatibility, but new features should be added to domain modules.
 *
 * Domain modules:
 *   transfers/  — money transfer operations
 *   kyc/        — KYC/KYB verification flows
 *   wallet/     — multi-currency wallet management
 *   admin/      — admin dashboard operations
 *   compliance/ — AML/CFT, sanctions, goAML
 *   fx/         — foreign exchange rates & conversion
 *   payments/   — payment rails, reconciliation
 *   analytics/  — transaction analytics & reporting
 *   social/     — community, family, marketplace
 *   notifications/ — push, email, SMS notifications
 */

// Re-export domain routers for incremental migration
export { featureFlagsRouter, tenantsRouter, whiteLabelRouter } from "../routers/featureFlags";
export { apiChangelogRouter } from "../routers/apiChangelogRouter";
export {
  bnplRouter, travelRuleRouter, agentNetworkRouter, corridorAnalyticsRouter,
  referralEngineRouter, whiteLabelPreviewRouter, familyEnhancedRouter,
  tenantAnalyticsRouter,
} from "../routers/productionFeatures";
export { partnerOnboardingRouter, adminInviteCodesRouter, travelRuleDbRouter } from "../routers/partnerOnboarding";
export {
  partnerPayoutsRouter, webhooksRouter, apiKeysRouter, complianceWatchlistRouter,
  paymentGatewayLogsRouter, systemConfigRouter, notificationPrefsRouter, fxRateHistoryRouter,
} from "../routers/productionV2";

// Domain module manifests
export const DOMAIN_MODULES = [
  { name: "transfers", routerCount: 8, description: "Money transfer operations" },
  { name: "kyc", routerCount: 12, description: "KYC/KYB verification flows" },
  { name: "wallet", routerCount: 6, description: "Multi-currency wallet management" },
  { name: "admin", routerCount: 10, description: "Admin dashboard operations" },
  { name: "compliance", routerCount: 8, description: "AML/CFT compliance" },
  { name: "fx", routerCount: 5, description: "FX rates & conversion" },
  { name: "payments", routerCount: 7, description: "Payment rails & reconciliation" },
  { name: "analytics", routerCount: 6, description: "Transaction analytics" },
  { name: "social", routerCount: 5, description: "Community & social features" },
  { name: "notifications", routerCount: 4, description: "Notification management" },
] as const;
