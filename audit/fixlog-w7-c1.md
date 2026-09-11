# Fixlog — Wave 7 Coder 1 (branch w7-c1)

Scope: `server/routers.ts` ONLY. Findings per `/mnt/agents/output/remitflow-gap-sweep.md`.
Validation: `npx -y esbuild server/routers.ts --loader:.ts=ts --outfile=/dev/null` → PASS (488.9kb, 0 errors).
Line numbers refer to the post-fix file.

## D1 — security.disable2fa accepted `code` but never verified it (CRITICAL)
- **Change:** routers.ts:2719-2741. Before flipping `twoFactorEnabled=false`, the handler now resolves the enrollment via `getTotpEnrollment(ctx.user.id)` (dual-reads `mfa_settings` + legacy `users.twoFactor*`). If enrolled, a 6-digit `code` is REQUIRED and verified with `verifyTOTP`; wrong/absent code rejected. If not enrolled, disable is allowed (nothing to verify). Also dual-writes `totpEnabled:false` into `mfa_settings` when a row exists (mirrors the dual-read; productionV85's mfa router writes that store).
- **Fail-closed:** DB unavailable during enrollment lookup → INTERNAL_SERVER_ERROR, disable blocked. Missing code → PRECONDITION_FAILED; bad code → UNAUTHORIZED. Audit log `2FA_DISABLED` only written after successful disable.

## D10 — security.changePin never verified currentPin (HIGH)
- **Change:** routers.ts:2753-2774. Loads `users.transaction_pin`; if a hash exists, the candidate is hashed with the SAME scheme used at setup (`sha256(pin + userId)`, the only scheme in the codebase — see the UPDATE at :2771) and compared with `timingSafeEqual`. DB is now required (was silently skipped when null).
- **Fail-closed:** wrong current PIN → UNAUTHORIZED, no overwrite. No stored PIN → treated as initial setup (allowed, per spec).

## D4 — wallet.withdraw: no step-up (CRITICAL)
- **Change:** routers.ts:962-973. Input gains `totpCode: z.string().regex(/^\d{6}$/).optional()`; Contract 2 step-up runs before KYC/limit checks and any balance mutation.
- **Fail-closed:** enrollment lookup DB-down → withdrawal blocked (INTERNAL_SERVER_ERROR). Enrolled + no code → PRECONDITION_FAILED; bad code → UNAUTHORIZED.

## D6 — beneficiaries.add: payout-destination integrity, no step-up (HIGH)
- **Change:** routers.ts:1618-1631. Same Contract 2 step-up; `totpCode` added to input and stripped from the insert payload (`{ totpCode: _totpCode, ...beneficiaryValues }`) so no stray field is written.
- **Fail-closed:** same error semantics as D4.

## savings.withdraw (runner-up, Pattern D)
- **Change:** routers.ts:1792-1803. Contract 2 step-up + `totpCode` input before any goal/wallet mutation.
- **Fail-closed:** same error semantics as D4.

## communityFunds.approveDisbursement (runner-up, Pattern D)
- **Change:** routers.ts:6064-6081. `adminProcedure` gating UNCHANGED; Contract 2 step-up added on top (`totpCode` input), before any proposal/fund mutation.
- **Fail-closed:** same error semantics as D4.

## profile.update — phone change (runner-up, Pattern D)
- **Change:** routers.ts:2609-2633. When `input.phone` differs from the currently stored phone (loaded from `users` by openId), Contract 2 step-up is required; unchanged phone and name/address/DoB updates are unaffected.
- **Fail-closed:** same error semantics as D4; phone-change blocked when verification unavailable.

## C7 — hardcoded FX fallback signs rate-locks (HIGH)
- **Change:** routers.ts:358-386. `getLiveRates` refactored: new `getLiveRatesDetailed(base)` returns `{ rates, source: "cache"|"live"|"fallback", stale }`; fallback path returns `source:"fallback", stale:true`. `getLiveRates` kept as a thin wrapper so the ~15 untouched call sites are unchanged.
  - `transfer.quote` (:1511-1525): response carries `source` + `stale`; when stale, NO signed rate-lock token is issued (`rateLockToken: null`, `rateLockExpiresInSeconds: 0`).
  - `fx.calculate` (:1538-1553): response carries `source` + `stale`.
  - `fx.lockRateV2` (:1554-1562): fallback rates + no caller-supplied `lockedRate` → throws PRECONDITION_FAILED "live rates unavailable — refusing to issue a rate lock against fallback rates"; no row written.
  - `fx.lockRate` (:1564-1572): fallback rates → same PRECONDITION_FAILED refusal; no row written.
- **Fail-closed:** signed rate-lock tokens are only ever minted from live/cached rates.

## C8-C10 — dead proxy procedures: silent fabricated fallbacks (HIGH)
- **Change:** every fabricated fallback in the deleted-scaffold proxy procedures replaced with `PRECONDITION_FAILED` "<service> service not deployed", mirroring the investment-feed dead-path pattern at :6502-6525:
  - community-feed (deleted go scaffold): `recent` (:6294-6300), `stats` (:6301-6305), `publish` (:6306-6316).
  - share-link (no service exists): `generate` (:6324-6344 — fabricated slug/shortUrl/WhatsApp/Twitter/Facebook/Telegram URLs removed), `resolve` (:6345-6349), `stats` (:6350-6354), `list` (:6355-6359).
  - nav-analytics (deleted python scaffold): `track`, `summary`, `heatmap`, `recommendations`, `topFeatures`, `retention` (:6376-6413).
  - portfolio-calc (no service exists): `analyzePortfolio` (:6483-6496 — silent `return null` removed), `dcaProjection` (:6547-6555).
  - investment-ml (no service exists): `getRecommendations` (:6498-6503), `scoreRisk` (:6557-6562 — the constant fake `{risk_score:50,"Moderate"}` personalized-ML output REMOVED), `getSentiment` (:6564-6569).
- **Unchanged (intentionally):** all `*.health` probes (`communityFeed.health`, `shareLink.health`, `navAnalytics.health`, `calcHealth`, `mlHealth`) honestly report `{status:"offline", online:false}` — accurate, not fabricated. AML/fraud/fx client fallbacks at :6216-6285 belong to Coder 5's C1-C3 registry scope.
- **Fail-closed:** callers receive an explicit error; no fabricated ids, URLs, slugs, stats, or risk scores.

## fcaDashboard — hardcoded compliance stats honesty tag
- **Change:** routers.ts:3628. Response now includes `source:"static_placeholder"` so consumers can distinguish placeholder stats from real compliance data.
