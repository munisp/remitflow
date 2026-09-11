# SPEC — Wave 7: Platform-Wide Gap Remediation (48 findings)

Branch: `audit-fixes` (all work on worktree branches `w7-c1`..`w7-c5`, merged by orchestrator).
Hard constraints: NO new third-party deps. NO drizzle schema changes/migrations. Fail closed everywhere. Never fabricate provider artifacts (ids, txHashes, references, timelines, rates, scores). Surgical patches only. Validate TS with `npx -y esbuild <file> --loader:.ts=ts --outfile=/dev/null`. Commit on YOUR branch only; write `audit/fixlog-w7-c<N>.md`.

## Contract 1 — Shared feature gate (orchestrator-provided, exists at merge base)

`server/_core/featureGuard.ts` exports:

```ts
export async function assertFeatureEligible(
  ctx: { user: NonNullable<TrpcContext["user"]> },
  req: {
    flag?: string;        // feature flag key checked via isFeatureEnabled; omitted => skip
    minKycTier?: number;  // 0..3 numeric; omitted => skip. Parse via tier-string, unknown => 0
    minPlan?: "starter" | "growth" | "enterprise" | "white_label"; // omitted => skip
    featureName: string;  // for error messages
  }
): Promise<void> // throws TRPCError FORBIDDEN (gate) / INTERNAL_SERVER_ERROR (verification unavailable)
```
Semantics identical to investmentGuard.ts: flag fail-closed; KYC numeric parse fail-closed to 0; plan via tenant_users→tenants.plan, admins bypass plan only, no membership => starter, DB error => throw (fail closed).

## Contract 2 — TOTP step-up snippet (canonical, from investment.ts:276-290)

```ts
const { getTotpEnrollment, verifyTOTP } = await import("../totp"); // adjust depth
const enrollment = await getTotpEnrollment(ctx.user.id);
if (enrollment) {
  if (!input.totpCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
  const valid = await verifyTOTP(input.totpCode, enrollment.secret);
  if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
}
```
Rules: add `totpCode: z.string().regex(/^\d{6}$/).optional()` to the input schema. Enrolled users MUST pass TOTP. Do NOT fail open on DB errors inside getTotpEnrollment (it already dual-reads and throws). For account-security mutations (disable2fa, mfa.disable, changePin), TOTP/current-PIN verification is MANDATORY whenever an enrollment/PIN exists — never silently skip.

## Contract 3 — Fail-closed service calls

In `serviceRegistry.ts`, add an options param to `fetchSvc`: `{ failClosed?: boolean }`. When true, instead of returning the safe default, throw `new Error("<svc> unavailable — failing closed")`. Compliance/critical callers (amlCheck, fraudScore, checkSanctions, pixTransfer, upiTransfer, postLedgerEntry, initiateTransfer, getFxQuote) MUST use failClosed:true AND have their URLs/routes corrected to ground truth:

| fn | Correct target (verified in Wave 6) |
|---|---|
| amlCheck | `http://localhost:8083/screen` POST (rust aml-engine) |
| fraudScore | fraud-ml on `:8082` — Coder 5 verifies exact route from services/fraud-ml source before wiring |
| checkSanctions | repoint to the REAL screener: python-compliance-service `:8083` `/sanctions/screen` (verify route exists) — sanctions-updater has no /check |
| pixTransfer | `http://localhost:8080/api/v1/transfers` (python-pix-adapter) |
| upiTransfer | `http://localhost:8092/api/v1/transfers` (rust-upi-adapter) |
| getFxQuote | `http://localhost:8081/quote` POST (go fx-engine; POST only) |
| initiateTransfer | transfer-engine is gRPC-only (:50051) — no HTTP: fail closed with explicit "not reachable over HTTP" |
| postLedgerEntry | ledger-service `:8086` — Coder 5 verifies a real HTTP route exists; if none, fail closed |

ALL fabricated fallbacks removed: no `local-<ts>`, `pix-<ts>`, `upi-<ts>`, `{rate:1}`, `{matched:false}`, `{score:0}`, `{flagged:false}`, `{safe:true}`, `{isKnownDevice:true}`, `{nav:1.0}` returns. Downstream callers (transfer-state-machine.ts, p2pInstant.ts) must treat thrown errors as hard failures: transfers do NOT proceed, payouts get honest failed/pending status, no fake partnerRef stored.

## Contract 4 — Honest statuses (phantom settlement)

Never stamp terminal statuses (`paid`, `settled`, `completed`, `disbursed`, `confirmed`, `locked`) without a real external confirmation. Use existing string columns only (no schema change): use `pending_payout` / `pending_settlement` / `pending_egress` / `pending_acquisition` style values and surface them in responses. Config-default mocks MUST have a production kill-switch:

```ts
if (process.env.NODE_ENV === "production" && provider === "mock") {
  throw new Error("<SERVICE> refuses to run with mock provider in production");
}
```
Mock providers in non-production must return clearly-marked simulated artifacts (id prefix `sandbox-` is acceptable ONLY when NODE_ENV != production and responses include `simulated: true`). `getTransactionStatus`/`getSettlementStatus` under mock must NOT report confirmed/settled — report `unknown` or throw.

## Contract 5 — Pipeline KYC step (A4 root cause)

`server/_core/transferPipeline.ts`: implement the advertised step 4. After sanctions, before ledger: unless `skipKycTier === true`, load ctx user kycTier and enforce per-tier per-tx and daily limits using the SAME limits as transferEngine.ts:74,410 (Coder 3 reads them and mirrors exact constants). Unrecognized tier => tier0 limits. Fail closed on DB error. Update the header comment to match reality.

## Coder file scopes (DISJOINT — do not touch files outside your scope)

- **C1** `server/routers.ts` ONLY: D1 disable2fa verify code; D10 changePin verify currentPin against stored hash; D4 wallet.withdraw step-up; D6 beneficiaries.add step-up; savings.withdraw (~:1755) step-up; communityFunds.approveDisbursement (~:5978) step-up + must stay admin-gated; profile.update phone change (~:2566) step-up; C7: FALLBACK_RATES/getLiveRates — add `source:"fallback"`/`stale:true` to every fallback rate response AND refuse to issue signed rate-lock tokens (lockRate/lockRateV2 ~:1531-1538) when rates are fallback (PRECONDITION_FAILED); C8-C10: dead proxy procedures (~:6194-6510: community-feed, nav-analytics, share-link, portfolio-calc, investment-ml) — replace silent fallbacks with PRECONDITION_FAILED "service not deployed" (mirror investment-feed dead-path pattern at :6410-6433); fcaDashboard (~:3542) — tag every hardcoded stat with `source:"static_placeholder"` in the response.
- **C2** `productionV85.ts` (D2: mfa.disable verify code; mfa.verify actually verifyTOTP, not regex-only), `transferCore.ts` (D3: TOTP step-up on send), `scheduledTransfers.ts` (step-up on create), `stablecoinEnhanced.ts` (D5: step-up on send/withdrawToBank/swap/createVirtualCard; A10: assertFeatureEligible {flag:"stablecoin", minPlan:"growth"} on onramp/offramp — keep existing KYC checks), `posAgentCashFlow.ts` (D11: step-up on cashOut), `v75Features.ts` (D12: step-up on virtualCards.create; A7: bnplFullRouter.createPlan gate tier0-only-check → assertFeatureEligible {flag:"bnpl", minKycTier:2}), `extendedCrud.ts`+`db-extended.ts` (A9: community.contribute must perform a guarded atomic wallet debit in the same flow — mirror the guarded-debit pattern `UPDATE wallets SET balance=... WHERE id=? AND CAST(balance AS DECIMAL(18,4)) >= ?` with row-count check — no debit, no totalRaised increment).
- **C3** `server/_core/transferPipeline.ts` (Contract 5), `newRails.ts` (A1: assertFeatureEligible {flag:"send_money", minKycTier:1} on bricspay/ghipss/papss; {flag:"cbdc", minKycTier:1, minPlan:"enterprise"} on mbridge/africbdc), `cbdcSettlementRouter.ts` (A2: {flag:"cbdc", minKycTier:1, minPlan:"enterprise"} on CBDC/FX-forward; {flag:"stablecoin", minKycTier:1, minPlan:"growth"} on stablecoin settlement; B6: remove ALL fabricated CBDC-/FWD-/STL- ids — serviceCall failure => throw PRECONDITION_FAILED, no row written), `liquidityPool.ts` (A3: assertFeatureEligible {flag:"stablecoin", minKycTier:1, minPlan:"growth"} + tier0 hard block mirroring stablecoinEnhanced:174-176 on executeBuy/executeSell), `diasporaBond.ts` (A5: assertFeatureEligible {flag:"investments", minKycTier:2, minPlan:"growth"} on subscribe/createSellOrder/fillBuyOrder; B5: subscribe debit gets an explicit escrow/issuer credit leg in the same db.transaction — use the platform float/treasury wallet pattern already used elsewhere in the file; coupons/redemption MUST NOT mint unbacked balance — debit the float/treasury wallet in the same transaction with row-count check, insufficient float => throw; D-runner: step-up on subscribe/redeemEarly), `propertyEscrow.ts` (A6: assertFeatureEligible {flag:"investments", minKycTier:2} on create/payDeposit; D9: approveMilestone — replace plain adminProcedure with admin + TOTP step-up; B12: resolve a PROPER TigerBeetle account via the resolveTbTransferAccounts helper used elsewhere, never BigInt(userId); make TB post + wallet credit one db.transaction where possible or fail before wallet credit), `financialProductsRouter.ts` (A12: assertFeatureEligible {flag:"bnpl", minKycTier:2} on createBnplPlan; B7: plan activates only as `pending_disbursement`; a separate admin confirmDisbursement marks disbursed with a real payout reference — no money fabricated), `smeTrade.ts` (A8: assertFeatureEligible {flag:"batch_payments", minPlan:"growth"} on submitBatch; D7: step-up on submitBatch; B10: remove CBN-FM-FALLBACK fabrication — compliance service down => PRECONDITION_FAILED, document stays unvalidated).
- **C4** `server/_core/liquidityProvider.ts` (B2: Contract 4 kill-switch; mock/YellowCard/Circle — no fabricated txHashes; unimplemented providers throw UNAVAILABLE; getPoolBalance returns null + `available:false` when not real; getSettlementStatus never auto-"settled"), `cryptoCustody.ts` (B3: same kill-switch on CUSTODY_PROVIDER=mock; sandbox status poller returns `unknown`, never `{confirmed,6}`; responses include `simulated:true` outside production), `swiftGateway.ts` (B4: sendPacs008 — when no SWIFT egress configured (env SWIFT_EGRESS_URL), keep funds held, status `pending_egress`, user message "queued — not yet transmitted"; buildGpiTimeline returns ONLY real DB events; remove fabricated +1800000ms entries), `globalPayroll.ts` (B1: disburseRun — items become `pending_payout` (NOT paid), disbursements `pending_settlement`, run `payout_pending`; a real rail call is out of scope — honesty is the fix; D8: disburseRun requires TOTP step-up AND rejects when approver===disburser (SoD)), `revenueShare.ts` (B9: markReportPaid — without a verified payout reference, set `approved_for_payout` not `paid`; only with payoutId + matching payout record => paid), `floatIncome.ts` (B11: records booked with status/description explicitly `estimated_internal_accrual` using EXISTING columns only — never presented as realized yield), `investment.ts` (B8 ONLY: realEstate.invest — audit transaction type `topup` => `investment`; ownership record status `active` => `pending_acquisition`; response notes custody pending. DO NOT touch anything else in investment.ts), `extendedCrud` NOT yours.
- **C5** `server/_core/serviceRegistry.ts` (Contract 3 entirely + C12: validateFile/deviceFingerprint/getNavData — fail closed (reject upload / unknown device / throw), no safe-default fabrications), `server/transfer-state-machine.ts` (C4/C5 consumers: on thrown registry error, payout => honest failed/pending, NO fake partnerRef, compensate hold if one was placed using existing saga helpers), `server/routers/p2pInstant.ts` (C1/C2 consumers: amlCheck/fraudScore thrown => transfer BLOCKED fail-closed), `server/services/{share-link,portfolio-calc,investment-ml,community-feed,nav-analytics}-client.ts` (C8-C10: every method throws UNAVAILABLE "service not deployed" — no fabricated URLs/slugs/risk scores; keep health() honest), `server/_core/platformHardeningV3.ts` (C12: crons hitting dead ports :8310/:8311/:8314 — disable with explicit logger.warn "disabled: no listener" and skip; never .catch(()=>{}) silently), `server/_core/polyglotClient.ts` (sendAuditLog => deleted rust-audit: route to local createAuditLog instead), `server/_core/lendingBorrowing.ts`+`crossCurrencySwap.ts`+`accountAbstraction.ts` (C11: getMarkets — no Math.random supply/utilization: return configured markets with zeroed metrics + `source:"config_static"`; swap quote — refuse executable quotes (PRECONDITION_FAILED) since no pool exists; accountAbstraction — no random gas/instant confirmed: return `unavailable` honestly).

## Fixlog format (each coder)
`audit/fixlog-w7-c<N>.md`: per finding ID (from remitflow-gap-sweep.md) — what changed, file:line, fail-closed behavior, validation (esbuild result).
