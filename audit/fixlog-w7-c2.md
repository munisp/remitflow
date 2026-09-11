# Fixlog — Wave 7, Coder 2 (branch `w7-c2`, base `audit-fixes` @ d2772d9)

Pattern D (missing TOTP step-up) + Pattern A items A7/A9/A10. Contracts used:
Contract 1 (`assertFeatureEligible` from `server/_core/featureGuard.ts`) and
Contract 2 (canonical `getTotpEnrollment`/`verifyTOTP` step-up, fail-closed on
`dbAvailable === false`). No new deps, no schema changes.

## D2 — `server/routers/productionV85.ts`
- **`mfa.verify` (~:795-809, fix at :802):** previously accepted ANY 6-digit
  code (`/^\d{6}$/` regex only). Now calls `verifyTOTP(input.code, setting.totpSecret)`
  against the enrolled secret from `mfa_settings`; invalid => UNAUTHORIZED and
  `failedAttempts` incremented (existing behavior kept).
- **`mfa.disable` (~:824, fix at :830):** accepted `code` but never verified it.
  Now resolves enrollment via `getTotpEnrollment`; lookup unavailable =>
  INTERNAL_SERVER_ERROR (fail closed); enrolled => code verified via
  `verifyTOTP`, invalid => UNAUTHORIZED. Verification is mandatory whenever an
  enrollment exists — never silently skipped (account-security mutation rule).

## D3 — `server/routers/transferCore.ts` `send` (fix at :73)
- Added `totpCode: z.string().regex(/^\d{6}$/).optional()` to the input schema
  and a Contract 2 gate before the pipeline runs. Enrolled => PRECONDITION_FAILED
  without code, UNAUTHORIZED on bad code; enrollment lookup failure fails closed.

## D — `server/routers/scheduledTransfers.ts` `create` (fix at :37)
- Same Contract 2 step-up (`totpCode` added to schema). Scheduled transfers
  authorize future money movement; enrolled users must pass 2FA at creation.

## D5 + A10 — `server/routers/stablecoinEnhanced.ts`
- Added shared `requireTotpStepUp` helper (:31, Contract 2 semantics).
- Step-up added to `send` (:706), `withdrawToBank` (:690), `swap` (:698),
  `createVirtualCard` (:721) — each with `totpCode` in the input schema.
- A10: `assertFeatureEligible(ctx, { flag: "stablecoin", minPlan: "growth",
  featureName: "Stablecoin services" })` on `onramp` (:172) and `offramp` (:327).
  Existing KYC tier-limit checks kept unchanged.

## D11 — `server/routers/posAgentCashFlow.ts` `cashOut` (fix at :253)
- Contract 2 step-up with `totpCode` in schema; fail-closed on lookup errors.

## D12 + A7 — `server/routers/v75Features.ts`
- `virtualCards.create` (:243): `totpCode` in schema + Contract 2 step-up
  (verified against the DB-resolved user's enrollment).
- `bnplFullRouter.createPlan` (:405): tier0-only check replaced with
  `assertFeatureEligible(ctx, { flag: "bnpl", minKycTier: 2, featureName:
  "BNPL credit" })` — tier1 can no longer draw unsecured credit.

## A9 — `server/routers/extendedCrud.ts` + `server/db-extended.ts`
- `community.contribute` previously incremented `totalRaised` with NO wallet
  debit (unbacked balances up to $10M/call). New `contributeToCommunityFund`
  (db-extended.ts :397) runs ONE `db.transaction`: load fund (NOT_FOUND if
  missing) → resolve contributor's active wallet in the fund currency →
  guarded atomic debit `UPDATE wallets SET balance = balance - ? WHERE id = ?
  AND CAST(balance AS DECIMAL(18,4)) >= ?` with row-count check (0 rows =>
  BAD_REQUEST "Insufficient wallet balance", whole tx rolls back) → only then
  increment `totalRaised`. Mirrors the guarded-debit pattern in
  investment.ts:323-339 / p2pInstant.ts:602-615. Router now passes
  `ctx.user.id` (extendedCrud.ts :269).

## Validation
- `npx -y esbuild --loader:.ts=ts --outfile=/dev/null` PASSED for all 8 edited
  files (productionV85, transferCore, scheduledTransfers, stablecoinEnhanced,
  posAgentCashFlow, v75Features, extendedCrud, db-extended).
- Not run: full `tsc`/test suite (repo-wide; other Wave-7 coders editing
  concurrently). Residual risk: none known in scope files; TOTP gates bind only
  enrolled users (per Contract 2), unenrolled users keep existing behavior.
