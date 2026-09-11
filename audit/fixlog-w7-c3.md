# Fixlog — Wave 7, Coder 3

Branch: `w7-c3` (worktree) · Base: `audit-fixes` HEAD d2772d9

Validation: every edited file passes
`npx -y esbuild <f> --loader:.ts=ts --outfile=/dev/null` (8/8 OK).

---

## A4 (Contract 5) — transferPipeline dead KYC step — FIXED
`server/_core/transferPipeline.ts`
- Added `KYC_TIER_LIMITS` — EXACT mirror of `server/transferEngine.ts:73-78`
  (tier0 {0,0,0} / tier1 {500,1000,5000} / tier2 {5000,10000,50000} / tier3 {50000,100000,500000}).
- New `enforceKycTierLimits(userId, amount)`: loads `users.kycTier` (unrecognized => tier0,
  fail closed), same daily-total query as `checkKycLimits` (`transfers` 24h, status != 'failed'),
  per-tx + daily enforcement; **DB error => throw (fail closed)**, FORBIDDEN on limit breach.
- Wired as pipeline step 4 (after velocity, before TB ledger); honored only when
  `skipKycTier !== true` (`transferPipeline.ts:377-382`).
- Header comment rewritten to describe the steps the pipeline actually executes
  (incl. note that 2FA is enforced by callers).

## A1 — newRails un-gated rails — FIXED
`server/routers/newRails.ts`
- `bricspay.initiate` (:155), `ghipss.initiate`, `papss.initiate`:
  `assertFeatureEligible(ctx, { flag: "send_money", minKycTier: 1, ... })`.
- `mbridge.initiate`, `africbdc.initiate`:
  `assertFeatureEligible(ctx, { flag: "cbdc", minKycTier: 1, minPlan: "enterprise", ... })`.
- Gates run before any DB insert / service call; flag/DB failures fail closed (Contract 1).

## A2 + B6 — cbdcSettlementRouter — FIXED
`server/routers/cbdcSettlementRouter.ts`
- A2 gates: `initiateCbdcSettlement` + `lockFxForward` => `{ flag: "cbdc", minKycTier: 1, minPlan: "enterprise" }`;
  `initiateStablecoinSettlement` => `{ flag: "stablecoin", minKycTier: 1, minPlan: "growth" }`.
- B6: deleted ALL fabricated ids. `STL-${Date.now()}` "queued" fallback,
  `CBDC-${Date.now()}` fallback, and `FWD-${Date.now()}` with `forwardRate: 0` "locked"
  are gone — when `serviceCall` returns null the procedure throws PRECONDITION_FAILED
  and writes/returns nothing.

## A3 — liquidityPool executeBuy/executeSell — FIXED
`server/routers/liquidityPool.ts`
- Both mutations: `assertFeatureEligible(ctx, { flag: "stablecoin", minKycTier: 1, minPlan: "growth" })`
  plus an explicit tier0 hard block mirroring `stablecoinEnhanced.ts:174-176`
  ("KYC verification required to buy/sell stablecoins").
- `_core/liquidityProvider.ts` untouched (Coder 4 scope).

## A5 + B5 + D-runner — diasporaBond — FIXED
`server/routers/diasporaBond.ts`
- A5: `subscribe`, `createSellOrder`, `fillBuyOrder` (previously NO user check)
  gated with `{ flag: "investments", minKycTier: 2, minPlan: "growth" }`.
- D-runner: `subscribe` + `requestEarlyRedemption` got `totpCode` input + canonical
  Contract 2 TOTP step-up (enrolled users MUST pass; DB errors in enrollment propagate).
- B5 subscribe: the guarded user debit is now paired with an explicit credit leg to the
  platform float/treasury wallet (`PLATFORM_SYSTEM_USER_ID`, imported from
  `_core/tigerBeetle.ts`) in the SAME `db.transaction`; float wallet missing =>
  PRECONDITION_FAILED, whole subscription rolls back.
- B5 coupons (`processUpcomingCoupons`): no longer mints balance — guarded debit of the
  float/treasury wallet (`CAST(balance AS numeric) >= amount`, row-count checked) in the
  same transaction as the subscriber credit; insufficient float => throw, nothing partial.
- B5 early redemption: same funded pattern — float debit precedes user credit;
  insufficient float => PRECONDITION_FAILED, subscription stays active.

## A6 + D9 + B12 — propertyEscrow — FIXED
`server/routers/propertyEscrow.ts`
- A6: `create` and `payDeposit` gated with `{ flag: "investments", minKycTier: 2 }`.
- D9: `approveMilestone` (plain adminProcedure) now also verifies the ADMIN's own TOTP
  via the Contract 2 snippet (`totpCode` input).
- B12: `creditAccountId: BigInt(builder.userId)` replaced with a properly resolved,
  deterministically-derived (SHA-256 hash of builder user id) builder payout account on
  `ESCROW_LEDGER`, provisioned idempotently (TB exists(21) tolerated by the bridge client).
  Sequencing: TB release posts FIRST; the SQL wallet credit happens only after the
  confirmed TB post, row-count checked — missing builder wallet => throw + reconciliation
  log, milestone NOT approved. Fabricated `BigInt(Date.now())` transfer id replaced with a
  deterministic hash (`escrow-release:<milestoneId>`).

## A12 + B7 — financialProductsRouter (BNPL) — FIXED
`server/routers/financialProductsRouter.ts`
- A12: `createBnplPlan` gated with `{ flag: "bnpl", minKycTier: 2 }`.
- B7: plans are created as `pending_disbursement` (NOT `active`). New adminProcedure
  `confirmDisbursement` requires a real `payoutReference` (4-120 chars); single-winner
  guarded transition `pending_disbursement => active` + a `transactions` record carrying
  the reference, in one transaction. No merchant payment is ever fabricated.

## A8 + D7 + B10 — smeTrade — FIXED
`server/routers/smeTrade.ts`
- A8: `submitBatch` gated with `{ flag: "batch_payments", minPlan: "growth" }`.
- D7: `submitBatch` got `totpCode` input + Contract 2 TOTP step-up.
- B10: the regex-only local fallback that fabricated `CBN-FM-FALLBACK-${Date.now()}`
  regulatory references is deleted — compliance service down => PRECONDITION_FAILED,
  Form M stays unvalidated, no audit-trail fabrication.

---

## Verification round — TOTP enrollment check fix

Advisory: `getTotpEnrollment` ALWAYS returns a truthy object
(`{dbAvailable, enabled, secret}` — server/totp.ts:87-98), so `if (enrollment)`
forced UNENROLLED users through `verifyTOTP(code, null)` which always fails —
permanent lockout. Contract 2 requires TOTP only for ENROLLED users.

Fixed all 4 of my step-up sites to the canonical pattern (investment.ts:278-294):
- `if (!enrollment.dbAvailable)` => throw INTERNAL_SERVER_ERROR (fail closed);
- `if (enrollment.enabled && enrollment.secret)` => require + verify `totpCode`;
- unenrolled users proceed (pre-existing behavior preserved).

Sites: `diasporaBond.ts` (subscribe ~:285, requestEarlyRedemption ~:1055),
`propertyEscrow.ts` (approveMilestone ~:737), `smeTrade.ts` (submitBatch ~:167).

Validation: esbuild OK on all 3 files (8/8 scope files still pass).
