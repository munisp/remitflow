# Fixlog — Wave 7, Coder 5 (Pattern C: Phantom Services & Seed-as-Live)

Branch: `w7-c5` (worktree off `audit-fixes` @ d2772d9).
Validation: every edited file passed `npx -y esbuild <f> --loader:.ts=ts --outfile=/dev/null` (13/13 OK).

## Verified ground truth (read from services/ source before wiring)

| fn | Wired target | Evidence |
|---|---|---|
| amlCheck | `http://localhost:8083` POST `/screen` | services/aml-engine/src/main.rs:574 (route), :584 (default port 8083); ScreenRequest/ScreenResponse :182-212 |
| fraudScore | `http://localhost:8082` POST `/score` | services/fraud-ml/main.py:257 (route), :381 (PORT default 8082); TransactionInput/ScoreResponse :176-198 |
| checkSanctions | `http://localhost:8083` POST `/sanctions/screen` | services/python-compliance-service/main.py:918 (route exists), SanctionsScreenRequest/Result :579-591; sanctions-updater has no /check |
| pixTransfer | `http://localhost:8080` POST `/api/v1/transfers` | services/python-pix-adapter/app/main.py:299; Dockerfile `EXPOSE ${PORT:-8080}`; PixTransferRequest :82-89 |
| upiTransfer | `http://localhost:8092` POST `/api/v1/transfers` | services/rust-upi-adapter/src/main.rs:143 (route), :124 (port 8092); TransferRequest/Response models.rs:25-49 |
| getFxQuote | `http://localhost:8081` POST `/quote` (POST only) | services/fx-engine/main.go:559 (route), :565 (port 8081); QuoteRequest/Response :30-49 |
| initiateTransfer | none — transfer-engine is gRPC-only (:50051) | always throws "not reachable over HTTP" |
| postLedgerEntry | `http://localhost:8086` POST `/api/v1/transfers` | services/ledger-service/main.go:990 (route), Dockerfile EXPOSE 8086; CreateTransferReq :112-121 |
| validateFile | no compatible route — rust-crypto-guard serves `/validate-file` requiring content_b64/mime_type/filename (main.rs:342, :34-44), not URL scans | throws (upload rejected) |
| crons | :8310 go-continuous-kyc not in any compose file; :8311 no listener; :8314 python-adverse-media has no /batch-screen (real: /screen/adverse-media); :8315 python-predictive-routing has no /refresh-stats | disabled with logger.warn |

Deleted services confirmed absent from `services/`: rust-share-link, rust-portfolio-calc, python-investment-ml, go-community-feed, python-nav-analytics, rust-audit-service.

## C1 — AML phantom (serviceRegistry.ts)

- `amlCheck` repointed `:8093/check` → `:8083/screen`; request mapped to ScreenRequest (`transaction_id`, `amount_usd`, `receiver_country`, `receiver_name`); response mapped decision PASS/REVIEW/BLOCK → `flagged`/`requiresReview`, `matched_rules` → `reasons`.
- `fetchSvc` gained `{ failClosed?: boolean; serviceName?: string }` — when set, non-OK/timeout/unreachable THROWS `new Error("<svc> unavailable — failing closed")` instead of returning the safe default.
- Deleted fallback `{flagged:false, riskScore:0, ...}` (serviceRegistry.ts:221-255).
- Consumer p2pInstant.ts:524-540: `amlCheck` wrapped — thrown error ⇒ TRPCError, transfer BLOCKED (fail closed).

## C2 — Fraud-ML phantom

- `fraudScore` repointed `:8094/score` → `:8082/score`; payload mapped to TransactionInput; response mapped: recommendation BLOCK → label `critical`, HIGH → `high`, MEDIUM → `medium`, else `low`; top_features → `features`.
- Deleted fallback `{score:0, label:"low"}`.
- Consumer p2pInstant.ts:461-473: `fraudScore` wrapped — thrown error ⇒ TRPCError, transfer BLOCKED. Outage no longer = always-pass.

## C3 — Sanctions phantom

- `checkSanctions` repointed `:8098/check` (sanctions-updater, no such route) → python-compliance-service `:8083/sanctions/screen`; response `is_sanctioned`/`list_source` mapped. failClosed:true. Deleted `{matched:false}` fallback (serviceRegistry.ts: ~391).

## C4 — PIX/UPI phantom payouts

- `pixTransfer` → `:8080/api/v1/transfers` (payee_key mapping); throws on outage or missing `end_to_end_id`. Deleted `pix-<ts>` + fake ACSC.
- `upiTransfer` → `:8092/api/v1/transfers` (payee_vpa mapping); throws on outage or missing `transaction_id`. Deleted `upi-<ts>` + fake SUCCESS.
- Consumer transfer-state-machine.ts:464-490: rail throw ⇒ honest `failed` status with real error message, NO partnerRef stored, then `compensateFailedTransfer` (existing saga helper, transferPipeline.ts:740) voids/reverses the pipeline's TB hold (stage:"settlement"); compensation failure logged for manual reconciliation.

## C5 — Transfer-engine/ledger phantom

- `initiateTransfer`: transfer-engine is gRPC-only — now always throws; deleted `local-<ts>` transferId + `fxRate:1` fallback.
- `postLedgerEntry` → ledger-service `:8086/api/v1/transfers`; throws on outage or missing id; deleted `local-<ts>` entryId fallback.

## C6 — FX engine phantom

- `getFxQuote` → `:8081` POST `/quote` with `{from,to,amount}`; validates returned rate (finite, >0) else throws; maps `fxRate/rate`, `spread`, `expiresAt`. Deleted `rate:1` fallback.

## C8 — Deleted-service clients (community-feed, nav-analytics)

- `community-feed-client.ts`, `nav-analytics-client.ts`: every method rejects `UNAVAILABLE: <svc> service not deployed`; `health()` returns honest `{status:"offline"}` with zeroed stats. No empty-feed/empty-summary successes.

## C9 — Share-link phantom

- `share-link-client.ts`: all methods throw UNAVAILABLE; `health()` offline. No fabricated slugs/short URLs.
- serviceRegistry `createShareLink` also throws "service not deployed" (its fallback fabricated `remitflow.app/s/<ts>` URLs).

## C10 — Portfolio/ML phantom

- `portfolio-calc-client.ts`, `investment-ml-client.ts`: all methods throw UNAVAILABLE; `health()` offline. The fabricated constant `{risk_score:50, "Moderate"}` path is unreachable.
- serviceRegistry `calcPortfolio` / `getInvestmentRecommendations` throw "service not deployed".

## C11 — Fake DeFi markets

- `lendingBorrowing.ts` getMarkets: deleted `Math.random()` totalSupply/totalBorrow/utilizationRate → zeroed metrics + `source:"config_static"`.
- `crossCurrencySwap.ts`: deleted the `1 - Math.random()*3bps` pricing engine, quoteId+expiry fabrication, and the executeSwap fabricated `0x<random>` txHash/`status:"completed"`; getQuote and executeSwap both throw `PRECONDITION_FAILED: ... no liquidity pool is deployed`. Unused `randomBytes` import removed.
- `accountAbstraction.ts` sendGasless: deleted random gas estimate, fabricated txHash, instant `status:"confirmed"` — throws `UNAVAILABLE: ... no bundler/paymaster is deployed`.

## C12 — Bundle

- `validateFile` (serviceRegistry): phantom `:8087/validate` + `{safe:true}` fallback → throws; upload rejected when scanner unavailable.
- `checkDeviceFingerprint`: failure now returns unknown device `{isKnownDevice:false, riskScore:100, flags:["device_fingerprint_service_unavailable"]}` (forces re-verify); deleted `isKnownDevice:true`.
- `getNavData`: throws "service not deployed"; deleted `nav:1.0`.
- `getCommunityFeed` (registry): throws "service not deployed".
- `platformHardeningV3.ts`: crons to :8310/:8311/:8314/:8315 no longer `fetch(...).catch(()=>{})` — each logs `logger.warn("cron disabled: target service not deployed")` once (with target + verified reason) and skips cleanly.
- `polyglotClient.ts` sendAuditLog/sendAuditBatch: rust-audit-service target was a deleted scaffold — events now written to the local TS `createAuditLog` (server/db.ts:382, same helper routers use); still best-effort/never-throws; returns null honestly (no fabricated id/checksum); events without a numeric userId are skipped (auditLogs.userId NOT NULL).

## Residual risk / notes

- aml-engine and python-compliance-service both default to :8083 in their own sources; compose must disambiguate via env (`AML_ENGINE_URL`, `PYTHON_COMPLIANCE_URL` remain env-overridable).
- rust-device-fingerprint port is ambiguous (code default 8092 / Dockerfile 8099 / registry 8088) and its validate handler is itself a stub returning `known_device:false`; the registry keeps the env-overridable URL and fails to unknown-device — semantically identical to the stub, fail-closed either way.
- `servicesHealth.ts` router (out of scope) now surfaces thrown UNAVAILABLE errors from the phantom-service registry fns as 500s — honest failure; C1's routers.ts work covers the main dead-proxy surface.
- transfer-state-machine compensation uses `transferRef` as the pipeline transfer id (matches how callers invoke `runTransferPipeline(ref, ...)`); `compensateFailedTransfer` is idempotent (deterministic void ids, ALREADY_VOIDED/EXPIRED tolerated).

---

## Verification round (post-merge re-check, 4 findings)

Validation: esbuild OK on all 7 edited files (polyglotClient, serviceRegistry, platformHardeningV3, transfer-state-machine, p2pInstant, globalPayroll, v97Features).

### V1 — BLOCKER: `polyglotClient.screenSanctions` fail-open (live money path)

- `screenSanctions` returned `{isSanctioned:false, riskLevel:"low", action:"allow"}` on ANY failure. Now THROWS on transport error (`sanctions screening unavailable — failing closed`) and on non-OK (`HTTP <status> — failing closed`).
- Call-site audit: `p2pInstant.ts:518` (mine) wrapped — throw ⇒ TRPCError, transfer BLOCKED. `globalPayroll.ts:527` (call-site adjustment authorized by lead) — `Promise.all` screening wrapped — throw ⇒ TRPCError, disbursement BLOCKED before any TB transfer. `transferPipeline.ts:204-235` already catches and fails CLOSED in production (SEC-17). `routers.ts:1233` + `smeTrade.ts:180` propagate ⇒ transfer/batch halts. `kycProviderWebhook.ts:169` uses `allSettled` — a rejection is treated as no-hit on a *post-approval* rescreen (no new privilege granted); left as-is.
- Same-class fixes in the same file (also fail-open with live consumers): `runComplianceCheck` (fallback `decision:"approved"`, consumed at routers.ts:1195 in transfer.send and stablecoinEnhanced.ts:111) and `getFraudScore` (fallback `decision:"approve"`, consumed at routers.ts:1208 and v97Features.ts:976) now THROW on failure. `v97Features.ts:976` fail-open `.catch(() => ({decision:'approve'}))` replaced — batch item marked `failed` ("Fraud screening unavailable — item blocked (fail closed)") and skipped.

### V2 — serviceRegistry residual fail-open fallbacks

- `assessRisk`: route corrected `/assess` → `/score` (verified services/risk-engine/main.go:434), request mapped to RiskRequest, response RiskResponse→RiskAssessment (decision approve/review/reject → allow/review/block; unrecognized riskLevel ⇒ conservative "high", missing score ⇒ 1). failClosed:true — throws on outage.
- `complianceScore`: registry contract incompatible with real python-compliance-ml `/compliance/score` schema; fallback fabricated `{score:0, category:"clean"}` — now throws (no production consumers; servicesHealth demo procedure surfaces honest error).
- `generateReceipt`: fallback fabricated `receipt-<id>` with empty pdfUrl — now failClosed:true, throws `rust-pdf-receipt unavailable — failing closed`.

### V3 — platformHardeningV3 VASP/MiCA FX fabrication (:763)

- `getLiveFxRate(...).catch(() => 1)` deleted. On FX failure: `logger.warn` ("skipping MiCA threshold evaluation — no rate=1 fabrication"), `amountUsd = null`, threshold evaluation skipped, and crypto transfers are filed CONSERVATIVELY (`filingRequired = amountUsd === null || amountUsd >= 1000`) — fail closed regulatorily; `amount_usd` column is nullable (drizzle/0071:846) so no fabricated amount is stored.

### V4 — transfer-state-machine pre-generated `RF-<ts>` partnerRef (:378)

- `partnerRef` now starts `null` and is set ONLY by a real rail response (PIX e2e id / UPI txn id / Mojaloop transferId / MarkLane transferId) or the legitimate internal `CP-` cash-pickup reference (funds stay on-platform by design). After the rail block: `if (!partnerRef)` (DB down or transfer row missing) ⇒ advance to honest `failed` with `requiresManualReview:true` and return — the machine can NEVER reach `partner_sent` without a real reference.
