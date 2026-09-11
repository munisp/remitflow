# SPEC-wave9.md — Remediation contracts for all Wave 8 findings

Base: /mnt/agents/output/remitflow @ audit-fixes HEAD c5a2531. All findings from /mnt/agents/output/remitflow-wave8-fullsweep.md.

Global constraints (unchanged): no new third-party deps (node:crypto scrypt/aes-256-gcm allowed — built-in); NO drizzle schema changes or migrations (enum fixes are CODE-SIDE value mappings only); fail closed everywhere; never fabricate external execution; surgical patches; TS validated via `npx -y esbuild <file> --loader:.ts=ts --outfile=/dev/null`; Python validated via `python3 -m py_compile`.

## CONTRACT Q1 — Legacy pack quarantine (Coder 1, server/routers.ts)

Add near the top of routers.ts:

```ts
// W9: Legacy feature packs quarantine. These v-series/tier/microservices routers were never
// exercised against a real database (enum-invalid writes, fabricated executions, IDOR clusters —
// see remitflow-wave8-fullsweep.md). They are UNMOUNTED unless explicitly re-enabled per-pack
// after a smoke test. Undocumented env; fail-closed default.
const LEGACY_PACKS_ENABLED = process.env.LEGACY_FEATURE_PACKS_ENABLED === "true";
```

Quarantined routers (remove from appRouter spread when flag is off, via conditional spread `...(LEGACY_PACKS_ENABLED ? { name: router } : {})`):
productionV82, productionV84, productionV86, productionV87, productionV89, productionV90,
v92Features, v94Features, v97Features, v98Features, v99Features, v100Features, v101Features,
tier1, tier2, tier3, microservices, microservicesExtended, microservicesV127, missingTables.

NOT quarantined (live, previously hardened): productionV85 (mfa), everything else.
Add a comment block at the mount site listing the quarantine rationale + pointer to the wave8 report.

## CONTRACT Q2 — PIN KDF (Coder 1, server/routers.ts ~:2764)

Replace unsalted `sha256(pin + userId)` with node:crypto scrypt:
- Store format: `scrypt:v1:<saltHex>:<hashHex>` (scrypt N=16384,r=8,p=1, 32-byte key, 16-byte random salt).
- Verify: parse stored value; if starts with `scrypt:` → scrypt compare via `timingSafeEqual`; else treat as legacy sha256(pin+userId), compare timing-safe, and on match LAZILY REHASH to scrypt format (update the row).
- Fail closed: unknown/corrupt stored format → reject.
- changePin (set/change) always writes scrypt format.

## CONTRACT Q3 — TOTP secret at-rest encryption (Coder 2)

New file server/_core/secretBox.ts (Coder 2 owns):

```ts
// AES-256-GCM field encryption. Key: env FIELD_ENCRYPTION_KEY (64-hex or base64 32 bytes).
// PRODUCTION: missing/invalid key => throw (fail closed). Non-production: ephemeral key + console.warn.
export function encryptField(plaintext: string): string; // "v1:<ivHex>:<tagHex>:<ctHex>"
export function decryptField(stored: string): string;    // v1 format => decrypt; else return as-is (legacy plaintext)
export function isEncryptedField(stored: string): boolean;
```

Apply: server/totp.ts `getTotpEnrollment` → return `secret: decryptField(raw)`; all TOTP-secret writers must `encryptField(secret)` on store. Writers: server/productionV85.ts (mfa.enable), server/routers.ts:2717 (Coder 1 applies encryptField there — Coder 1 imports from _core/secretBox; the file is created by Coder 2, so Coder 1 writes the import and call against this exact API).

Fix W8-R2 (routers.ts:2717): `setupTwoFactor` currently stores the whole TOTPResult object — store `encryptField(result.secret)` only.

## CONTRACT Q4 — Fee credit leg (Coder 3, server/transferEngine.ts ~:534)

After the sender debit succeeds, inside the same guarded flow, credit the platform fee wallet when fee > 0:
- Use the Wave 7 platform-float pattern: PLATFORM float wallet resolved via TIGERBEETLE_PLATFORM_USER_ID (default "0"), guarded update `UPDATE wallets SET balance = CAST(balance AS DECIMAL(18,4)) + ? WHERE id = ?`, row-count checked.
- On credit failure: throw (the whole transfer fails — never a debit-without-credit). Log structured warn with transferId + fee.
- Add description/metadata text "platform fee" so the leg is visible.

## CONTRACT Q5 — FX execution fail-closed (Coder 3, server/transferEngine.ts)

Where the engine falls back to STATIC_FALLBACK_RATES for EXECUTION: throw UNAVAILABLE("FX rate unavailable — cannot execute without a live rate") instead. Quote/preview paths may keep the fallback only if the response is tagged `{ stale: true, executable: false }` (Wave 7 C7 pattern).

## CONTRACT Q6 — Quote honesty (Coder 3, server/transferCore.ts)

Remove false rate-lock promises: quote responses that claim `validForSeconds/expiresAt` without an enforced lock must be relabeled `{ indicative: true }` and drop the validity fields, OR bind to the existing rateLock mechanism. Choose relabel (surgical).

## CONTRACT Q7 — Money precision (Coder 3)

- platformHardeningV4.ts:695 — fix operator precedence (parenthesize the division).
- tigerBeetle.ts:588 — replace `parseFloat(amount)*100` with an exact decimal-string→minor-units converter (string manipulation, no float math): add local helper `toMinorUnits(amount: string|number): bigint`.
- stablecoinScheduler.ts — F9-11: never parse amounts from free-text description; use the typed amount column (if absent for legacy rows, skip the row with a warn — fail closed).

## CONTRACT Q8 — Lifecycle completions (Coder 4)

- globalPayroll.ts: add admin-only `confirmPayout` (input: runId/batchId + externalReference + totpCode via canonical W7 step-up) flipping `pending_settlement` → `completed` with reference recorded; extend `cancelRun` to attempt TB hold reversal (compensation) and mark `cancelled` only after reversal succeeds or after logging an explicit unreversed-hold alert + status `cancel_failed_unreversed_hold`.
- propertyEscrow.ts: add sweeper function `sweepAutoRefunds()` (queries escrows where autoRefundDate <= now and status indicates funds held; executes the same refund internals as requestFullRefund) — exported for scheduler registration.
- scheduler.ts: (a) register the escrow auto-refund sweeper on an interval; (b) F11-4 rewrite the reconciliation query using actual columns (debit_account_id/credit_account_id mapped to wallets.user_id via JOINs, and tb_transfers.code for transfer_type); if the legacy tables are truly absent the query must fail loudly and be logged, not silently pass.
- investment.ts: add admin-only `confirmCustody` (holdingId + reference + step-up) flipping `pending_acquisition` → `active`. No auto-flip.
- stripeWebhook.ts: (a) F14-1 map `onramp`→enum-valid `deposit`, metadata notes the rail; (b) ordering — perform business inserts BEFORE marking the event processed; if inserts throw, leave event unprocessed so Stripe retries (fail closed).

## CONTRACT Q9 — Enum-safe writes (Coder 5; CODE-SIDE mapping, no schema change)

Map non-enum values to valid enum members + preserve the semantic in `description`/metadata:
- `investment_buy`→`withdrawal` (metadata "investment buy"), `escrow_deposit`→`deposit` (metadata "escrow deposit"), `onramp`→`deposit`, `offramp`→`withdrawal`, `diaspora_bond_subscription`→`withdrawal` (metadata bond id), cash-pickup/pos variants likewise per the tx_type enum in shared/txnEnums.ts — READ IT FIRST.
- diasporaBond.ts redemption status `"redeemed"` → `"sold"` with description "early redemption".
- openBankingPsd2Router.ts: `"Revoked"`→`"revoked"`; on consent-update error THROW (do not swallow).
- temporal/activities.ts: kycDocuments insert status `"processing"` → enum-valid value per drizzle schema (`pending` if that's the enum member — verify in drizzle schema file first).
- stablecoinEnhanced.ts, agentCashPickup.ts, posAgentCashFlow.ts, financialProductsRouter.ts, diasporaBond.ts: use real column names (amount→fromAmount, currency→fromCurrency etc. — verify against drizzle schema before writing).

## CONTRACT Q10 — Input/auth hardening (Coder 5 unless noted)

- beneficiaryVerification.ts: regex checks persist status `format_validated`; unknown-country account numbers → `unverified` (fail closed); never persist "verified" from regex alone.
- orphanFeatures.ts:125 — use validateIBAN (mod-97) instead of regex; invalid → reject (not just flag).
- billingEngine.ts: invoice tenant from ctx session (tenantProcedure), ignore client-supplied tenantId unless admin + membership verified.
- featurePersistence.ts: camelToSnake identifier — allowlist `[a-z0-9_]` else throw; SSRF guard follow-redirects: `redirect: "manual"` and re-validate any Location target through the existing SSRF guard (or reject redirects outright — preferred, simpler: reject 3xx).
- developerPortalRouter.ts, developerExperience.ts: same redirect-reject in outbound fetch.
- partnerApplications.ts: call validateFile on uploaded doc URLs and REJECT application on scan failure (not just annotate); webhook tenantId from ctx.
- immigrantWorker.ts: enforce validateFile result (fail closed).
- extendedCrud.ts: F9-12 outbox.create → adminProcedure; F8-3 marketplace escrow/milestones verify `resource.userId = ctx.user.id` before confirm/release (add lookup via db-extended helpers — may extend db-extended.ts, Coder 5 owns that file too); F8-4 chat insert senderId = ctx.user.id (ignore client senderId); F8-11 impersonation — delete this endpoint (the pbac one in routers.ts is canonical).

## CONTRACT Q11 — Secrets & compare discipline (Coder 2)

- kycHardening.ts, stablecoinHardening.ts, paymentReconciliation.ts: replace `!==`/`===` on secrets/signatures with `crypto.timingSafeEqual` on equal-length Buffers (length-mismatch → false, never throw).
- qrPayments.ts (TS static secret), security.attacks.ts:771, hardening.ts:240, microservicesExtended.ts:118, shared/constants.ts (APISIX/Grafana/Redis defaults), airflow.service.ts, nifi.service.ts: remove repo-known default secrets — read env; if unset → throw at use/boot with clear message (dev may console.warn + disable the feature; production always throw).
- dataResidency.ts, platformHardeningV3.ts, futureProofing.ts: FIELD_ENCRYPTION_KEY/PII_SALT — production missing → throw; non-prod → ephemeral + warn. PII tokenization must fail closed (no plaintext passthrough when salt absent).
- _core/index.ts:676 security-alert webhook: env unset → skip with structured warn (never placeholder URL); ALSO register `startStablecoinSchedulers()` boot call (F11-3) guarded try/catch + error log.
- python-p2p-intelligence PIN verify: salted hash (hashlib.pbkdf2_hmac, per-PIN random salt, format `pbkdf2$<salt_hex>$<hash_hex>`); never return the hash in the HTTP response; verify via hmac.compare_digest. `python3 -m py_compile` must pass.

## Merge order
C1 (routers.ts) → C2 (crypto) → C3 (money) → C4 (lifecycle) → C5 (enum/input). Orchestrator commits Q1..Q11 spec file first. Coder 1's import of _core/secretBox resolves because C2 creates it — MERGE C2 BEFORE RUNNING C1's esbuild validation, or orchestrator stubs the file before spawning (chosen: orchestrator creates secretBox.ts in the base commit BEFORE spawning coders, per Q3 API above).
