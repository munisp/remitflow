# Changelog

All notable changes to RemitFlow are documented in this file.

## [27.0.0] - 2026-05-14

### Added
- Stripe webhook event idempotency deduplication (prevents double-credit on retries)
- CBDC QR deep-link flow: QR codes now encode shareable URLs that auto-populate the receive dialog
- CBDC QR "Share Link" / "Copy Link" buttons with `navigator.share()` + clipboard fallback
- Stripe Card tab as default payment method in Wallet top-up dialog
- Composite database indexes on 10 core tables (wallets, transactions, beneficiaries, cards, savingsGoals, kycDocuments, auditLogs, idempotencyKeys, cbdcWallets, notifications)
- Unique constraint on `idempotencyKeys.key` for safe deduplication
- robots.txt and sitemap.xml for SEO
- All 9 remaining eagerly-imported pages converted to lazy-loaded code-split chunks

### Changed
- `logger.ts` rewritten with a flexible wrapper accepting both `(msg, val)` and `({ key: val }, msg)` call patterns (eliminates all Pino TS2769 overload errors)
- Postgres connection pool hardened: `idle_timeout=30s`, `max_lifetime=1800s`, `connect_timeout=10s`
- Stripe wallet top-up wrapped in atomic `db.transaction()` to prevent partial balance/record splits
- `generatePaymentRequest` changed from query to mutation (correct semantics)
- `frequency` field in `RunSchema` (global payroll) now has `.default("monthly")`
- Input validation hardened across 12+ procedures: max-length constraints on CBDC transfer, stablecoin swap, FX alerts, recurring payments, M-Pesa send, support tickets, lock rate, beneficiaries

### Fixed
- AdminScheduledJobs.tsx TS2339 errors (null guard on mutation variables)
- kycProviderWebhook.ts type errors (SanctionsScreenInput, ComplianceCheckInput, broadcastAdminEvent)
- CBDC.tsx TS2345 error (qrData vs qrPayload field name)
- smoke-heartbeat-admin.test.ts: changed `beforeEach` to `beforeAll` to fix 10s timeout

## [26.0.0] - 2026-05-13

### Added
- Heartbeat admin procedures: `heartbeatList`, `heartbeatLogs`, `heartbeatPause`, `heartbeatResume`
- Smoke tests for all heartbeat admin procedures (27 tests)

### Fixed
- All 47 Pino TS2769 logger overload errors via flexible logger wrapper

## [25.0.0] - 2026-05-13

### Added
- Stripe Card tab in Wallet top-up dialog (4 payment methods: Card, PayPal, Flutterwave, Bank)
- CBDC QR deep-link URL encoding in `generatePaymentRequest`
- `frequency` default in `RunSchema` for global payroll

### Fixed
- 0 TypeScript errors (was 54 errors across 20+ files)
- AdminScheduledJobs.tsx, CBDC.tsx, kycProviderWebhook.ts targeted fixes
