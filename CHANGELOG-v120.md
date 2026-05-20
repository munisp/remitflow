# RemitFlow v120 — Comprehensive Production-Readiness Sprint

**Date:** 2026-04-25  
**Baseline:** v118 (checkpoint `ee1b8b75`) → v119 (checkpoint `3dfd0ab3`) → v120 (this release)

---

## Summary

This sprint completed a full production-readiness audit and implementation pass across the entire RemitFlow codebase. All gaps identified in the audit were addressed end-to-end.

---

## v118 — Routing Bug Fix

### Bug Fixed
- **Critical routing bug in `client/src/App.tsx`**: The `<Route component={NotFound} />` catch-all was placed at line 600, making 14 routes permanently unreachable. All routes below it were silently returning 404 instead of rendering their pages.

### Routes Unblocked (14 total)
| Route | Component |
|---|---|
| `/admin/aml-batch` | AMLBatchEnginePage |
| `/admin/settlement-netting` | SettlementNettingPage |
| `/admin/liquidity-stress` | LiquidityStressTestPage |
| `/wallet/multi-currency-v2` | MultiCurrencyWalletV2Page |
| `/admin/cross-border-compliance` | CrossBorderCompliancePage |
| `/admin/merchant-kyb` | MerchantKYBPage |
| `/admin/document-ocr` | DocumentOCRPage |
| `/admin/fx-options` | FXOptionsPricingPage |
| `/admin/regulatory-reporting` | RegulatoryReportingPage |
| `/admin/revenue-share` | AdminRevenueShare |
| `/partner/revenue-share` | RevenueSharePWA |
| `/admin/digital-agreements` | AdminDigitalAgreements |
| `/partners/apply` | PartnerApply |
| `/admin/chat-agent` | ChatAgentDashboard |

### Additional Fix
- Removed duplicate `/admin/load-test` route (was registered twice)

---

## v119 — Sidebar Navigation Reorganization + PWA Dashboard

### Sidebar Reorganization
The sidebar was rewritten from 15 version-tagged sections (e.g., "Operations v89", "Monitoring v90", "Production Tools v101") with duplicates into **13 clean logical categories**:

| Category | Items |
|---|---|
| Money | Wallet, Send Money, Receive Money, Transfer Tracking, Scheduled Transfers, Recurring, Batch Payments, Virtual Account, QR Pay, Direct Debit, Rate Lock, Split Bill |
| FX & Rates | Live FX Calculator, Rate Alerts, FX Alerts, FX Hedging, Rate Calculator, FX Options Pricing |
| Payments | Payment Methods, Cards, BNPL, Checkout SDK, Payment Rails, Open Banking, Wise Transfer, Mojaloop |
| Grow & Invest | Savings Goals, Savings, Investment Portfolio, Transfer Goals, NGX Stock Market, Real Estate Hub, Startup Deal Room, Talent Bridge, AfriMarket, Beyond Remittance |
| Community | Community Feed, Community Hub, Community Leaderboard, Diaspora UK, Family Dashboard |
| Compliance | KYC, KYC Admin Queue, KYC Lifecycle, AML Batch Engine, Sanctions Screening, Compliance Alerts, Compliance Reporting, Compliance Watchlist, Regulatory Reporting, Travel Rule, GDPR, Consent Management, Document Vault, Security Settings, MFA Settings |
| Account | Dashboard, Profile, Settings, Notifications, Notification Preferences, Notification Center, Beneficiaries, Beneficiary Manager, Referral, Referral Dashboard, Disputes, Support, Live Chat, Stablecoin, CBDC |
| Partners | Partner Onboard, Partner Self-Service, Partner Analytics, Partner Payouts, Partner Applications, Apply as Partner, Revenue Share, Digital Agreements, PWA Dashboard |
| Treasury & Risk | Treasury Management, Treasury Dashboard, Liquidity Stress Test, Settlement Netting, Multi-Currency Ledger, Multi-Currency Wallet V2, Multi-Hop Routing, Smart Routing, Circuit Breaker, FX Options Pricing |
| Admin | Admin Home, Admin Users, Admin KYC, Admin Compliance, Admin Analytics, Admin Tenants, Tenant Admin, Tenant Config, Tenant Dashboard, Merchant KYB, Merchant Onboarding, Fee Rules CRUD, Fee Rules V2, Promo Codes, Invite Codes, Feature Flags, A/B Testing, Bulk Actions, Bulk User Actions, Revenue Share Admin, Digital Agreements Admin, Cron Jobs, System Config, System Health, Admin Microservices, Agent Network, Load Test, Sandbox Scenarios |
| Developer | API Keys, API Key Manager, Webhook Manager, Webhook Admin, Webhook Retry, API Usage Dashboard, API Changelog, Checkout SDK, Document OCR, Payment Performance |
| AI/ML | AI Metrics Dashboard, Ollama Chat, Chat Agent, Similar Transactions, Vector Search, Smart Routing V2, Fraud Monitor, Security Attack Simulator |
| Monitoring & Ops | System Health V2, SLA Monitor, Real-Time Monitor, Grafana Dashboard, Kafka Dashboard, Lakehouse, Lakehouse Analytics, Data Pipelines, Reconciliation V2, Ledger Reconciliation, Audit Logs, Audit Log Admin, Audit Log Viewer, Security Dashboard, Security Events Log, Security Audit Report, Security Score, Account Health, Admin Readiness, Admin Nav Analytics |

### PWA Dashboard (`/pwa-dashboard`)
- New page with 13 category cards showing all 130+ routes as searchable, clickable tiles
- Search filter to find any route by name
- Expand/collapse per category
- SPA navigation (no full page reload)
- Added to sidebar under Partners → PWA Dashboard

---

## v120 — Mobile Parity + Audit + Tests

### Audit Results
| Area | Finding |
|---|---|
| TypeScript errors | 0 real errors (`tsc --noEmit` exits 0); 166 watcher errors are stale from pre-v117 |
| Orphan routers | 0 orphans — all 36 router files are imported in `appRouter` |
| TODO/FIXME | 0 actionable items in server code |
| Read-only pages | 60 pages are correctly read-only (dashboards, audit logs, monitoring) |
| Country landing pages | Already wired to live FX via `trpc.fx.rates.useQuery()` in `CountryLandingPage` component |
| CRUD completeness | All pages that need mutations have them (1–19 mutations per page) |

### Bug Fixed
- **`/admin/digital-agreements`**: `<Select.Item value="">` (empty string) caused a crash. Changed to `value="all"` and updated the query filter to treat `"all"` as no filter.

### React Native — 20 New Screens Added
All screens use `trpc.*` hooks for real API calls:

| Screen | tRPC Procedures |
|---|---|
| CardsScreen | `cards.list`, `cards.create`, `cards.freeze`, `cards.unfreeze`, `cards.delete` |
| SavingsGoalsScreen | `savingsGoals.list`, `savingsGoals.create`, `savingsGoals.delete` |
| BNPLScreen | `bnpl.eligibility`, `bnpl.plans`, `bnpl.apply` |
| StablecoinScreen | `stablecoin.balances`, `stablecoin.swap` |
| DisputesScreen | `disputes.list`, `disputes.create` |
| ReferralScreen | `referral.stats`, `referral.info` |
| BatchPaymentsScreen | `batchPayments.list`, `batchPayments.create`, `batchPayments.cancel` |
| RateLockScreen | `fx.locks`, `fx.lockRate` |
| RateCalculatorScreen | `fx.calculate`, `fx.rates` |
| AirtimeScreen | `airtime.topup`, `airtime.history` |
| BillPaymentScreen | `bills.list`, `bills.pay` |
| QRPayScreen | `qr.myCode`, `qr.info` |
| DirectDebitScreen | `directDebit.mandates`, `directDebit.create`, `directDebit.cancel` |
| RecurringPaymentsScreen | `recurring.list`, `recurring.create`, `recurring.pause`, `recurring.cancel` |
| VirtualAccountScreen | `virtualAccounts.list`, `virtualAccounts.create` |
| SettingsScreen | `auth.me`, `profile.update` |
| SupportScreen | `support.listSessions`, `support.chat` |
| SplitBillScreen | `splitBill.list`, `splitBill.create` |
| CBDCScreen | `cbdc.balances`, `cbdc.transfer` |
| CheckoutSDKScreen | `checkout.apiKeys`, `checkout.createKey` |

### Flutter — 20 New Screens Added
Matching screens created in `mobile/flutter/lib/screens/` with identical feature coverage.

### Navigation Updated
- `RootNavigator.tsx` (React Native): Updated from 15 to 35 screens
- `app.dart` (Flutter): Updated from 15 to 35 routes

### Tests
- **New test file**: `server/smoke-v120-mobile-parity.test.ts` (36 tests)
- **Total tests**: 1216 passing across 25 test files (up from 1180 / 24)

### Test Coverage for New Screens
| Screen | Tests |
|---|---|
| Cards | card field validation, freeze/unfreeze toggle |
| Savings Goals | progress %, completion check, daily contribution |
| BNPL | installment calc, eligibility check, status badge mapping |
| Disputes | field validation, status transitions |
| Referral | earnings calc, code validation |
| Batch Payments | total calc, status validation |
| Rate Lock | expiry check, savings calc |
| Airtime | amount validation, phone number validation |
| Bill Payment | field validation |
| QR Pay | data format, URL parsing |
| Direct Debit | mandate field validation |
| Recurring Payments | next date calc, frequency labels |
| Virtual Account | account number length |
| Split Bill | per-person calc, unequal shares |
| Stablecoin | non-negative balance, 1:1 USD peg |
| CBDC | balance field validation |
| Checkout SDK | API key masking |
| Rate Calculator | fee calc, zero amount |

---

## File Change Summary

| Category | Files Changed/Added |
|---|---|
| `client/src/App.tsx` | Fixed routing bug (NotFound moved to end) |
| `client/src/components/DashboardLayout.tsx` | Sidebar rewritten: 15 sections → 13 categories |
| `client/src/pages/PWADashboard.tsx` | New file |
| `client/src/pages/AdminDigitalAgreements.tsx` | Fixed empty Select.Item value |
| `mobile/react-native/src/screens/` | 20 new screen files |
| `mobile/react-native/src/navigation/RootNavigator.tsx` | Updated: 15 → 35 screens |
| `mobile/flutter/lib/screens/` | 20 new screen files |
| `mobile/flutter/lib/app.dart` | Updated: 15 → 35 routes |
| `server/smoke-v120-mobile-parity.test.ts` | New file: 36 tests |
| `CHANGELOG-v120.md` | This file |

---

## Test Results

```
Test Files  25 passed (25)
     Tests  1216 passed (1216)
  Duration  8.33s
```

All tests pass. No regressions introduced.
