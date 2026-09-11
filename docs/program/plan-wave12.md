# Plan — Wave 12: Production-Readiness Verification + Funds-Flow Atomicity + GitHub Merge/Push

User asks: (1) validate all features/claims are fully implemented end-to-end (no stubs/mocks/placeholders),
with a production-readiness score per feature; (2) verify flow-of-funds atomicity across middleware
(Temporal, Kafka, Redis, TigerBeetle, Fluvio, Postgres); (3) merge all branches/PRs to main on GitHub
and confirm functional.

## Stage 0 — Git reconciliation (prerequisite, orchestrator)
- Diff origin/main vs audit-fixes; merge audit-fixes → main; push audit-fixes + main to origin;
  delete stale local w9/w10/w11 branches after push. If push auth fails → report, continue verification.
- Working tree: commit the 3 plan-*.md docs or leave untracked (docs only — leave out of code history
  or commit as docs; decide: commit as docs).

## Stage 1 — Implementation-reality audit (parallel verifiers, scored)
Each verifier: read code, hunt stubs/mocks/placeholders/TODOs/fabricated-terminal states, verify
business-rule completeness, output per-feature score (0-100) with evidence (file:line).
- V-A: Money movement core — wallets, P2P transfers, payout orchestration, settlement sweeper,
  card funding (W10 contract), refunds/idempotency.
- V-B: AP/AR suite (W10 nine features) — bill capture OCR, approvals, batch/scheduled payments,
  vendor mgmt, invoices + payment links, receivables.
- V-C: Rails & integrations — accounting sync (QBO/Xero/Odoo), FX engine, Mojaloop-style interop,
  multi-chain adapters (evm/xrpl/stellar/polygon/tron/solana), Stripe webhooks.
- V-D: Platform & compliance — tenant isolation, API keys/webhooks, KYC tiers, AML/sanctions,
  TOTP step-up, audit ledger, auth (Keycloak), Permify authorization.
- V-E: Observability (W11) — OTel wiring across TS/Go/Rust/Python, middleware coverage honesty,
  alert rules reality (REQUIRES-METRIC discipline), per-tenant labeling.

## Stage 2 — Funds-flow atomicity audit (dedicated verifier pair)
- F1: Atomicity patterns — DB transactions vs distributed saga boundaries; TigerBeetle two-phase
  transfers (pending/post/void); Temporal saga compensation on failure; Kafka idempotent producers/
  consumer offsets; Redis lock correctness (TTL, fencing); Drizzle tx usage on every money write.
- F2: Failure-injection reasoning — crash mid-transfer, duplicate webhook, double sweep, partial
  batch failure, outbox loss, replay; verify no money-creation/destruction/double-spend paths.

## Stage 3 — Fixes (coders, worktree-isolated) for any CRIT/HIGH findings; re-verify (binary gate).

## Stage 4 — Final integration + push
- Merge fixes to audit-fixes → main; run build/compile smoke checks; push to GitHub;
  confirm remote main is functional; produce readiness scorecard report
  (/mnt/agents/output/remitflow-production-readiness.md).

## Honesty constraints
- Scores must cite file:line evidence; fabricated verification = task failure.
- No absolute "cannot be compromised" claims; report residual risks explicitly.
- Standing constraints apply: no new TS npm deps; additive-only schema; fail closed; TOTP step-up
  on money mutations; secretBox for secrets.
