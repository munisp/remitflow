# Circle (USDC) — Current Integration Inventory

> **Status: integrated.** Unlike the Kinexys/DTCC seams, Circle is a live
> integration in this repo. This document inventories what exists today and
> what remains gated behind commercial prerequisites.

## Implemented: `server/_core/circleClient.ts`

Production client for Circle's Programmable Wallets and Payments APIs
(`api.circle.com/v1` in production, `api-sandbox.circle.com/v1` otherwise),
with retry/backoff, circuit breaker (`getCircuitBreaker("circle-api")`),
feature-event emission, and fail-closed behavior in production.

Capabilities in code:

| Function | Purpose |
|---|---|
| `createWallet(userId, blockchain)` | Programmable (developer) wallet creation |
| `getWallet(walletId)` | Wallet lookup |
| `createTransfer(...)` | On-chain USDC transfer from a developer wallet |
| `getTransfer(transferId)` | Transfer status tracking |
| `createDepositAddress(walletId, chain)` | Generate blockchain deposit addresses |
| `createWireAccount(...)` | Register wire bank accounts (ACH/SEPA/SWIFT rails) |
| `createPayout(...)` | USDC → fiat payout to a wire account |
| `getPayout(payoutId)` | Payout status |
| `getBusinessBalance()` | Business account balances |

Fail-closed contract: in `NODE_ENV=production`, a missing `CIRCLE_API_KEY`
or an open circuit breaker throws. Dev-only mock responses exist and are
clearly labeled.

Consumers elsewhere in the server include
`server/_core/liquidityProvider.ts` (a `CircleProvider` using
`CIRCLE_API_URL`), `server/_core/fiatRailsClient.ts`,
`server/routers/embeddedPayouts.ts`, `server/routers/stablecoinEnhanced.ts`,
`server/services/payoutSettlementSweeper.ts`, and
`server/middleware/stablecoinAtomicity.ts`.

## Environment variables

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle API key (required in production) |
| `CIRCLE_ENTITY_SECRET` | Entity secret ciphertext for developer-controlled wallet signing |
| `CIRCLE_ENV` | `production` selects `api.circle.com`; anything else uses sandbox |
| `CIRCLE_API_URL` / `CIRCLE_BASE_URL` | Base URL override used by `liquidityProvider` |
| `CIRCLE_PAYOUT_SOURCE_WALLET_ID` | Source wallet for payouts |
| `CIRCLE_PAYOUT_TOKEN_ID` | Token ID for payout asset (USDC) |

## CCTP (Cross-Chain Transfer Protocol)

Cross-chain USDC movement (burn-and-mint via Circle's attestation service)
is the natural next step for corridor settlement. It is not yet wired as a
dedicated module in this repo. CCTP is permissionless at the contract level,
so the remaining work is engineering (attestation polling, per-chain domain
config, receive-side minting) rather than commercial gating.

## Gated items and their prerequisites

- **Circle Mint (programmatic fiat↔USDC mint/redeem)** — requires a Circle
  Mint account with approved banking relationships and KYB. The wire
  account + payout functions above form the rails; full Mint flows activate
  only after Circle approves the account.
- **CPN (Circle Payments Network)** — Circle's network for institutional
  cross-border payouts via partner financial institutions. Requires a CPN
  commercial agreement and institution-level onboarding; not self-serve.
  Not wired in this repo.
- **Webhook verification / production entity-secret custody** — production
  deployment requires HSM/KMS custody of the entity secret and verified
  webhook endpoints before real funds flow.

## Honest boundary

Everything listed under "Implemented" is real code against Circle's public,
documented APIs. Everything under "Gated" is named plainly with its
prerequisite — no fake endpoints, no simulated balances presented as real.
