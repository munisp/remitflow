# RemitFlow Wave 10 Spec — Consolidated Wave 8 & 9 Honest Audits

Wave 10 closes the remaining Wave 8/9 backlog without repeating their audit mistakes.
This document is the single, verifiable contract between product ambition and engineering reality.

## Scope

**In scope (6 features):**
- **C1 — FX-Earnings Micro-Saving** (S1-S3): rounded FX fees micro-savings with explicit opt-in, real ledger, no phantom APY/yields.
- **C2 — Contributor Marketplace** (S4-S6): paid contributor marketplace with revenue-share escrow, honest payout ledger, zero fake payouts.
- **C3 — Regulatory-by-Region Playbooks** (S7-S9): playbook engine for NGN/CFA/Brazil with deterministic rule mapping, real filing calendar, no hallucinated regulator contact info.
- **C4 — Remittance-Linked Insurance** (S10-S12): opt-in transfer-linked micro-insurance via partner API or fail-closed pending coverage, no fake claims settlement.
- **C5 — B2B API Partner Tiers** (S13-S15): tiered partner program with real rate limits, honest SLA dashboard (no synthetic uptime), real webhook retries.
- **C6 — Agent Liquidity Forecast** (S16-S18): agent liquidity forecast + rebalancing advisory from real telemetry, no fabricated agent earnings.

**Explicitly out of scope (security audit residue — deferred to audit-fix branch):**
- SEC-01 through SEC-12 (DOMPurify, CSP nonce, env hardcoding, etc.) — tracked on `audit-fixes` branch, not in this wave's scope.
- **OQ-01** (Biometric HMAC key): high-risk auth/crypto finding — Wave 10 ships NO biometric auth paths; biometric verification endpoints remain disabled. Feature will not be re-enabled until OQ-01 is resolved on the audit-fix branch.

## Wave 8/9 Audit Lessons (baked into Wave 10)

Wave 8 (F8-1 through F8-15) and Wave 9 (W9-Q1 through W9-Q14) repeatedly caught the same failure modes. Wave 10 specifications hard-code the fixes:

| Pattern | Bad Example | Wave 10 Rule |
|--------|------------|-------------|
| **Fabricated metrics** | Wave 9 partner tiers advertised fake uptime numbers (W9-Q3) | Dashboards read ONLY real aggregated telemetry; unconfigured → `data unavailable` |
| **Phantom financial flows** | Wave 8 APY/yield endpoints returned computed-but-fake numbers (F8-6) | No yield/insurance payout math unless connected to real ledger or partner API; otherwise explicit `pending`/`unavailable` |
| **Hardcoded contact/regulator info** | Wave 8 compliance docs contained invented regulator addresses (F8-9) | Playbooks must have zero hardcoded addresses/phones; all contact points from env config |
| **Silent fallbacks for payments** | Wave 9 payout executor silently fell back to "manual review" (W9-Q5) | Payouts/insurance claims either succeed with real transaction ID or throw honest error |
| **Telemetry hallucination** | Wave 8 agent dashboards extrapolated trends from thin data (F8-12) | Forecasts require minimum data window; below threshold → explicitly say so |

## Constraints

1. **No fake data:** Never invent balances, rates, APY, payouts, uptime, agent earnings, or regulator contacts. If a dependency is missing, return explicit failure.
2. **Real ledger only:** All financial state transitions (fees, savings, escrow, payouts) MUST write to the transactional ledger (TigerBeetle or Postgres with idempotency keys). No in-memory "wallets" for money movement.
3. **Audit trail:** Every opt-in, payout, claim, tier change, and playbook execution MUST emit an immutable audit log entry with hash-chaining.
4. **Test coverage:** Each feature ships with tests that verify the honest behavior: missing config → explicit error, insufficient data → explicit message, ledger write failure → rollback + error.
5. **Security boundary:** No new auth/crypto surfaces. OQ-01 (biometric HMAC) remains open; Wave 10 features do NOT add biometric dependencies.
6. **Config-driven:** All external endpoints (insurance partner, SLA telemetry source, regulator calendar feeds) come from environment configuration with schema validation at startup; missing config → fail fast at boot, not at request time.

## Success Criteria

A feature is "done" when:
1. It passes its audit: a hostile reviewer cannot find a fabricated number, phantom payout, or silent fallback.
2. Missing dependencies produce explicit, actionable errors (not 500s with stack traces, not silent empty states).
3. All money movements are idempotent, ledger-backed, and auditable.
4. Integration tests prove the honest-failure paths, not just the happy path.
5. The feature is demoable end-to-end with real config (or with a stub that loudly identifies itself as a stub).
