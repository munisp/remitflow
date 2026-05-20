# RemitFlow v117 Change Manifest
**Date:** 2026-04-25  
**Tests:** 1180 passing, 0 failing  
**TypeScript:** 0 errors  
**DB migrations:** 0023_wandering_masque.sql applied (split_bill_groups, split_bill_participants)

---

## New Files Added (9)

| File | Lines | Description |
|------|-------|-------------|
| `server/routers/splitBill.ts` | 233 | Split Bill router — create group, list, getGroup, cancel, resendEmail. Uses `splitBillGroups` + `splitBillParticipants` tables. Sends branded emails via `sendEmail`. |
| `server/routers/rateLock.ts` | 165 | Rate Lock / Forward Contract router — lock, list, cancel, preview. Uses existing `rateLocks` table. Sends email on lock confirmation and expiry warning. |
| `server/routers/scheduledTransfers.ts` | 205 | Scheduled Transfers router (v117) — create, list, cancel, executeNow. Uses existing `scheduledTransfers` table. |
| `client/src/pages/SplitBill.tsx` | 205 | Split Bill PWA page — create form with N participants, copy payment links, view/cancel existing groups. Wired to `trpc.splitBill.*`. |
| `server/smoke-splitBill-rateLock.test.ts` | 60 | Smoke tests for splitBill and rateLock routers (4 tests). |
| `server/smoke-requestMoney.test.ts` | 101 | Smoke tests for requestMoney router (8 tests). |
| `scripts/seed-v116.mjs` | 80 | Seed script for `payment_requests` table (PostgreSQL). |
| `docker-compose.dev.yml` | 120 | Local dev docker-compose (PostgreSQL, Redis, MinIO, MailHog, Adminer). |
| `CHANGELOG-v117.md` | this file | Change manifest. |

---

## Modified Files (6)

| File | Change |
|------|--------|
| `server/routers.ts` | Added imports + appRouter entries for `splitBillRouter`, `rateLockRouter`, `scheduledTransfersV117Router` (lines 153-155, 5079-5081). Added `admin.listAllTransactions` and `admin.monitorStats` procedures. |
| `drizzle/schema.ts` | Added `splitBillGroups` and `splitBillParticipants` table definitions (end of file). |
| `client/src/App.tsx` | Added lazy imports + routes for `SplitBill`, `RequestMoney`, `PayRequest`, `TransactionReceipt`. |
| `client/src/components/DashboardLayout.tsx` | Added "Split Bill" nav item under Send Money. |
| `client/src/pages/APIChangelog.tsx` | Wired to `trpc.apiChangelog.list` (replaced static mock data). |
| `client/src/pages/SecurityAttackSimulator.tsx` | Wired `trpc.securityEvents.log` on simulate button (logs to DB). |

---

## Previous Versions

| Version | Files | Size | Key Changes |
|---------|-------|------|-------------|
| v113 | 13,441 | 271 MB | React Native + Flutter mobile apps (12 screens each) |
| v114 | 13,448 | 271 MB | Biometric login, push notifications, deep links (RN + Flutter) |
| v115 | 13,456 | 271 MB | Request Money flow, TransactionReceipt, mobile onboarding wizards |
| v116 | 13,463 | 271 MB | 1173 tests, audit fixes, rateLimitedProcedure coverage |
| **v117** | **13,472** | **271 MB** | **Split Bill, Rate Lock, Scheduled Transfers, 1180 tests** |
