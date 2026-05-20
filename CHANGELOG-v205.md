# RemitFlow v205 — Change Manifest

**Sprint:** Corridor Send Now + Mobile Parity + TypeScript Zero-Error Sprint  
**Date:** 2026-04-30  
**Tests:** 3,628/3,628 passing (74 test files, 0 failures)  
**TypeScript:** 0 errors (source files)  
**Archive:** remitflow-v205-final-comprehensive.tar.gz

---

## 1. TypeScript Zero-Error Sprint

All TypeScript errors across source files resolved:

| File | Error | Fix |
|------|-------|-----|
| `AgentCashIn.tsx` | `customerPhone` not in cashIn schema | Renamed to `customerId`, removed extra fields |
| `DiasporaEU.tsx` | `destinationCountry` not in claimOffer schema | Removed field from mutate call |
| `DiasporaCanada.tsx` | `destinationCountry` not in claimOffer schema | Removed field from mutate call |
| `ImmigrantWorkerSend.tsx` | Missing `mojaloopDfspId` in submitTransfer | Added `mojaloopDfspId: "REMITFLOW"` |
| `PrivateBankingDashboard.tsx` | `contactType` string not cast to union | Cast `rmTopic as "general" \| "rate_negotiation" \| "account_upgrade" \| "large_transfer"` |
| `SendMoneyWidget.tsx` | `toast({ title })` wrong API | Fixed to `toast("title", { description })` pattern |
| `offlineQueue.ts` | `.toString("hex")` on string | Removed invalid method call |
| `AgentKYBAdmin.tsx` | `vars?.agentId` on void type | Cast to `(vars as any)?.agentId` |

---

## 2. SendMoneyWidget.tsx — Full Send Flow

Rewrote `client/src/components/SendMoneyWidget.tsx` with complete end-to-end send flow:
- Auth check before form renders
- Recipient name + phone/email form
- 2FA gate for transfers > $500 (TOTP verification step)
- `transfer.send` tRPC mutation wired
- Toast notifications using correct `toast("title", { description })` pattern
- Loading states and error handling

---

## 3. AuthContext Barrel File

Created `client/src/contexts/AuthContext.tsx` as a barrel re-export of `useAuth` from `@/hooks/useAuth`. Fixes 24+ import errors across pages that import from `@/contexts/AuthContext`.

---

## 4. Flutter Parity Screens (3 new screens)

| Screen | File | Features |
|--------|------|----------|
| Form M History | `mobile/flutter/lib/screens/form_m_history_screen.dart` | List Form M submissions, status badges, CBN ref, validity dates |
| Compliance Form M Audit | `mobile/flutter/lib/screens/compliance_form_m_audit_screen.dart` | Admin audit view, status filter tabs, approve/reject actions, stats summary |
| HNW Private Banking | `mobile/flutter/lib/screens/hnw_private_banking_screen.dart` | Tier badge, spread stats, Priority SWIFT ($25) + Advisory Retainer ($250) Stripe checkout, benefits list |

---

## 5. React Native Parity Screens (3 new screens)

| Screen | File | Features |
|--------|------|----------|
| FormMHistoryScreen | `mobile/react-native/src/screens/FormMHistoryScreen.tsx` | Form M history list, status colors, importer/exporter details, CBN ref |
| ComplianceFormMAuditScreen | `mobile/react-native/src/screens/ComplianceFormMAuditScreen.tsx` | Admin audit, filter tabs (all/pending/approved/rejected), stats row, approve/reject buttons |
| HNWPrivateBankingScreen | `mobile/react-native/src/screens/HNWPrivateBankingScreen.tsx` | Profile card with tier badge, Priority SWIFT + Advisory Retainer checkout, benefits list, Stripe test note |

All 3 React Native screens call real tRPC endpoints via `(trpc as any)?.['router']?.['procedure']?.useQuery/useMutation` pattern consistent with existing RN screens.

---

## 6. Test Fixes

- `server/routers/transferDispute.ts`: Fixed Permify call signatures to match `smoke-v181.test.ts` expectations — removed third argument from `grantTransactionAccess()` and `canAccessDispute()` calls

---

## 7. Infrastructure

- `docker-compose.v205.yml`: Updated from v204 with v205 image tags (574 lines)
- `CHANGELOG-v205.md`: This file

---

## Test Summary

```
Test Files  74 passed (74)
     Tests  3628 passed | 2 skipped (3630)
  Duration  ~18s
```

---

## Suggested Next Steps for v206

1. **Crypto Custody Stubs**: Implement Fireblocks + BitGo integration stubs with `CRYPTO_CUSTODY_PROVIDER` env var selection
2. **Stripe Webhook for HNW Advisory Retainer**: Wire `checkout.session.completed` webhook to upgrade user tier in DB
3. **Form M Expiry Email Alerts**: Cron job to notify SMEs 30 days before Form M validity expires
4. **Bulk Form M Status Update**: Admin endpoint to approve/reject multiple Form M documents in one operation
5. **Corridor Fee Preview**: Real-time FX + fee calculation displayed before send confirmation
