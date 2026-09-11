# Fixlog — Wave 7, Coder 4 (Pattern B phantom execution + D8)

Branch: `w7-c4` (worktree, base `audit-fixes` @ d2772d9).
Validation: `npx -y esbuild <file> --loader:.ts=ts --outfile=/dev/null` — PASS for all 7 edited files.
No new deps. No drizzle schema/migration changes. Fail-closed throughout.

## B2 — `server/_core/liquidityProvider.ts` (Contract 4 kill-switch, honest providers)

- **Production kill-switch**: `getLiquidityProvider()` throws `liquidityProvider refuses to run with mock provider in production` when the resolved provider is `mock`, and throws on unknown provider names instead of silently falling back to mock (was: warn + fallback). New `activeProviders()` helper excludes mock in production; used by `getAllProviders()`, `getBestQuote()`, `checkRebalanceNeeded()` so no dashboard/quote-router/rebalance path can surface simulated liquidity in prod. `MockLiquidityProvider` methods also call `assertMockAllowed()` (defense in depth).
- **YellowCard/Circle contain NO HTTP** — all phantom behavior removed, fail closed with `UNAVAILABLE: <provider> provider integration not implemented (<op>) — no live API egress`:
  - `executeSettlement` throws (was: fabricated `YC-SETTLE`/`CIRCLE-SETTLE` ids + `0x${randomBytes(32)}` txHashes, :384/:528).
  - `getQuote` throws (was: fabricated `YC-QUOTE`/`CIRCLE-QUOTE` provider artifacts). Also prevents a stranded pipeline hold in `liquidityPool.executeBuy/Sell` (quote is fetched before the pipeline).
  - `getPoolBalance` throws (was: hardcoded 500k/550k and 10M/11M balances feeding the admin treasury dashboard, :393-395). All three downstream call sites (`liquidityPool.getPoolBalances`, `getReserves`, `checkRebalanceNeeded`) already wrap the call in try/catch and skip the provider — dashboards now show nothing rather than phantom liquidity.
  - `getSettlementStatus` throws (was: always `"settled"`, :415-427/:559-571).
  - `YellowCard.cancelSettlement` throws (was: claimed `{cancelled:true}` with no provider call).
  - `getHealth` returns `healthy: false` for both (honest: no live integration), so `getBestQuote` skips them.
- **Mock provider (non-production only)**: every artifact marked `simulated: true` (new optional field on `LPQuote`, `LPSettlementResult`, `LPPoolBalance`, `LPHealthStatus`); ids prefixed `sandbox-quote-`/`sandbox-settle-`; txHash is `sandbox-tx-<hex>` — no `0x${randomBytes}` presented as a real hash; `getSettlementStatus` returns `status: "unknown"` (never auto-`settled`).
- **Interface note (merge review / Coder 3)**: `LPSettlementResult.status` union extended with `"unknown"`. Downstream `liquidityPool.ts` only string-compares `=== "settled"` on the `executeSettlement` result (mock still returns `settled` + `simulated:true` in sandbox), so no behavior change there; `getSettlementStatus` passthrough now surfaces `"unknown"` (mock) or a thrown UNAVAILABLE error (yellowcard/circle).

## B3 — `server/routers/cryptoCustody.ts`

- Kill-switch in `getCustodyProvider()` (:329-337): `NODE_ENV=production` with `CUSTODY_PROVIDER` unset/`mock`/any unknown value (which previously fell through to `SandboxCustody`) throws `cryptoCustody refuses to run with mock provider in production` at module init — fail closed at startup.
- `SandboxCustody` (real guarded USD debit may stay): `getBalance` and `initiateTransfer` results now include `simulated: true` (new optional interface fields); `getTransactionStatus` returns `{ status: "unknown", confirmations: 0, simulated: true }` — NEVER the fabricated `{status:"confirmed", confirmations:6}` (:115-117).

## B4 — `server/routers/swiftGateway.ts`

- `sendPacs008`: real egress attempt only when `SWIFT_EGRESS_URL` is configured (POST `<url>/pacs008`, 15s timeout). No egress configured / non-2xx / unreachable ⇒ funds stay held (pipeline hold kept), DB status `pending_egress` (was hardcoded `'ACCP'`), response `statusDescription: "queued — not yet transmitted to SWIFT"`, `transmittedToSwift: false`, `estimatedSettlement: null`, `fundsHeld: true`. Success ⇒ `ACCP` with honest description "Transmitted to SWIFT egress gateway — awaiting network acknowledgement" (never "accepted for processing" by the network). Push notification title/message now honest in both branches.
- `buildGpiTimeline` (:305-315): fabricated `+1800000ms` "Correspondent Bank"/"Beneficiary Bank" entries DELETED — returns only events that exist in the DB (creation row with real status; a status-update event only when `updated_at > created_at`).
- `getStatusDescription`: added `pending_egress` mapping; `ACCP` re-labeled honestly. `listTransactions` status filter enum extended with `pending_egress`.

## B1 + D8 — `server/routers/globalPayroll.ts` (`disburseRun`)

- **B1 honest statuses**: terminal stamps removed — items are NO LONGER stamped `paid`/`disbursedAt`, disbursements NO LONGER `settled`/`settledAt`, run NO LONGER `disbursed`/`disbursedAt`. Disbursement rows are inserted directly as `pending_settlement` with no `sentAt` (varchar(20) column, fits). **Deviation (enum constraint, no schema changes allowed)**: `payroll_item_status` pgEnum lacks `pending_payout` and `payroll_run_status` pgEnum lacks `payout_pending`, so items remain `pending` (untouched — truthful: no payout executed) and the run remains `processing` (truthful: payouts in-flight/queued, not completed). Response now includes `payoutsQueued: true, payoutsCompleted: false` and an explicit "queued, not completed" message; audit action renamed `PAYROLL_DISBURSED` → `PAYROLL_PAYOUTS_QUEUED`; notifications say queued, funds not yet sent.
- **cancelRun guard** (B1 follow-through): cancellation is rejected (CONFLICT) when `pending_settlement` disbursements exist — funds were already provisioned wallet→float-pool via TigerBeetle; cancelling would strand the ledger movement.
- **D8 TOTP step-up** (Contract 2): `totpCode: z.string().regex(/^\d{6}$/).optional()` added; enrolled users MUST pass TOTP (`PRECONDITION_FAILED` if missing, `UNAUTHORIZED` if invalid); fails closed (`INTERNAL_SERVER_ERROR`) when the enrollment store is unavailable.
- **D8 separation of duty**: rejects (FORBIDDEN) when `ctx.user.id === run.approvedByUserId` (approver ≠ disburser; approver field read from `approveRun`'s `approvedByUserId`).

## B9 — `server/routers/revenueShare.ts` (`markReportPaid`)

- No `payoutId` ⇒ status `approved_for_payout`, NO `paidAt`, NO `payoutId`; response states payout was not executed.
- With `payoutId` ⇒ must reference a real `partnerPayouts` row, same tenant as the report, and `status === "completed"` (money actually moved); otherwise `PRECONDITION_FAILED` (fail closed — never silently degrades to paid). Only then `paid` + `paidAt`.
- `listReports` status filter enum extended with `approved_for_payout`.

## B11 — `server/routers/floatIncome.ts` (`accrueDaily` + consumers)

- `float_income_records` has NO status/description column (verified `drizzle/0071_remaining_contract_schemas.sql:382`) and schema changes are out of scope, so honest labeling travels in the API surface + audit trail: every accrual result carries `accrualType: "estimated_internal_accrual", realizedExternalYield: false`; response includes a note that no external yield-generating placement exists; audit description records the same. `summary` and `history` responses (incl. the backward-projection branch, marked `derived: true`) are labeled identically so accruals are never presented as realized external yield.

## B8 — `server/routers/investment.ts` (`realEstate.invest` ONLY, ~:715-778)

- Audit transaction `type: "topup"` ⇒ `"withdrawal"`. **Deviation**: `tx_type` pgEnum has no `"investment"` value (`drizzle/schema.ts:26`) and schema changes are forbidden; `withdrawal` is the honest money-out direction, description/channel (`real_estate`) carry investment context.
- Ownership record `status: "active"` ⇒ `"pending_acquisition"` (varchar(30), fits).
- Response adds `custodyPending: true` + note that asset custody/acquisition is pending.
- **Known downstream effect (not touched, surgical scope)**: portfolio summary at `investment.ts:1071` aggregates only `status = "active"` investments, so `pending_acquisition` positions no longer count there until custody is confirmed — honest but flagged for merge review. `getMyInvestments` surfaces the new status verbatim.
- placeOrder/broker flow untouched.

## Cross-coder interface notes (merge review)

1. **Coder 3 (`liquidityPool.ts`)**: `LPSettlementResult.status` now includes `"unknown"`; yellowcard/circle `getQuote`/`executeSettlement`/`getPoolBalance`/`getSettlementStatus`/`cancelSettlement` now THROW `UNAVAILABLE...` errors (pool-balance call sites already try/catch; `getSettlementStatus` passthrough will surface a 500 with the UNAVAILABLE message — acceptable fail-closed, optionally map to TRPCError UNAVAILABLE). `getAllProviders()` excludes mock in production.
2. No other router imports `liquidityProvider.ts` (verified by grep).
3. Payroll run/items stay in `processing`/`pending` after `disburseRun` (enum-constrained); any future "payout confirmation" flow should flip items `pending`→`paid`, disbursements `pending_settlement`→`settled`, run `processing`→`disbursed` upon real rail confirmation.
4. `swift_transactions.status` may now contain `pending_egress`; `sendPacs008` response gained `transmittedToSwift`/`fundsHeld`, and `estimatedSettlement` can be `null`.

## Verification round — B8 residual: startup-investment flow (`server/routers/investment.ts` ~:964-1005)

Verification found the same phantom pattern in the STARTUP-investment flow that was fixed for `realEstate.invest`. Applied the identical surgical fix (nothing else in the file touched):

- `startupInvestments` insert: wallet-paid status `"confirmed"` ⇒ `"pending_acquisition"` (varchar(30), fits); `confirmedAt` now stays `null` — a wallet debit proves funds moved, but no SPV/escrow/custody of the startup asset exists. Non-wallet path unchanged (`"pending"`).
- Audit transaction `type: "topup"` ⇒ `"withdrawal"` (same enum deviation as realEstate: `tx_type` pgEnum lacks `"investment"`; description + `channel: "startup_invest"` carry investment context).
- Response adds `custodyPending: true` + note that asset custody/acquisition is pending and the investment is not yet confirmed.
- **Known downstream effect (not touched, surgical scope)**: portfolio summary at `investment.ts:1097` aggregates only `status = "confirmed"` startup investments, so `pending_acquisition` positions no longer count there until custody is confirmed — same accepted trade-off as `realEstate` (:1071), flagged for merge review.
- Validation: `npx -y esbuild server/routers/investment.ts --loader:.ts=ts --outfile=/dev/null` — PASS.
