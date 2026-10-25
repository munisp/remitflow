# Kinexys by J.P. Morgan — Integration Status & Access Model

> **Status: seam, not integration.** RemitFlow ships a fail-closed connector
> shell (`server/_core/kinexysClient.ts`) that cannot be activated without a
> J.P. Morgan institutional partnership. There is no public Kinexys API,
> no sandbox, and no developer signup. Nothing in this repo fabricates
> Kinexys endpoints, requests, or responses.

## What Kinexys is

Kinexys (launched as Onyx, rebranded 2024) is J.P. Morgan's blockchain-based
wholesale payments business:

- **Kinexys Digital Payments (formerly JPM Coin)**: blockchain deposit
  accounts for institutional clients to move USD/EUR/GBP between J.P. Morgan
  accounts 24/7 with programmable payments.
- **JPMD**: J.P. Morgan's USD deposit token issued on public chain
  (piloted on Base). **Whitelist-only** — accessible exclusively to
  institutional clients of J.P. Morgan. It explicitly excludes retail users.
- **Kinexys Digital Assets / Blockchain Launch**: tokenization and network
  services for institutional market participants.
- **BDA (Blockchain Deposit Account)**: the on-chain account structure behind
  Kinexys Digital Payments; balances are J.P. Morgan deposits, settled on
  J.P. Morgan's permissioned infrastructure.

## Why RemitFlow cannot just "integrate" it

1. **No public API or sandbox.** Kinexys endpoints, request/response
   schemas, and auth material are provided bilaterally to onboarded
   institutional clients under NDA. Nothing public exists to code against.
2. **JPMD is institutional-whitelist-only.** Retail remittance customers
   are categorically outside the eligible participant set.
3. **The J.P. Morgan Payments developer portal
   (developer.payments.jpmorgan.com) is a different product.** It exposes
   ACH, wires, RTP, and FX APIs for enterprise treasury clients — useful for
   fiat rails, but it is **not** Kinexys and grants no access to JPMD/BDA.

## What activation would require (in order)

1. **J.P. Morgan institutional banking relationship** — RemitFlow (or its
   parent) as an institutional client.
2. **Kinexys commercial onboarding** — product agreement for Kinexys
   Digital Payments, compliance/KYB review of RemitFlow's use case.
3. **Participant whitelisting** — approved wallets/entities admitted to the
   Kinexys network (and the JPMD whitelist, if deposit-token flows are
   in scope).
4. **mTLS credential issuance** — client certificates issued by J.P. Morgan.
5. **NDA-provided endpoint documentation** — the endpoint map that feeds
   `KINEXYS_ENDPOINTS_JSON`.

## Activating the shell (once 1–5 are complete)

Environment variables consumed by `server/_core/kinexysClient.ts`:

| Variable | Purpose |
|---|---|
| `KINEXYS_API_BASE_URL` | Partner-provided base URL (mutual TLS) |
| `KINEXYS_MTLS_CERT_FILE` | Client certificate issued by J.P. Morgan |
| `KINEXYS_MTLS_KEY_FILE` | Matching private key |
| `KINEXYS_MTLS_CA_FILE` | Optional CA bundle override |
| `KINEXYS_ENDPOINTS_JSON` | JSON map: `{"name": {"path": "...", "method": "GET"\|"POST"}}` supplied under NDA |
| `KINEXYS_TIMEOUT_MS` | Optional request timeout (default 15000) |

Behavior contract:

- `getKinexysStatus()` reports `configured` and `mode`
  (`partner-mtls` | `unconfigured`) without network access.
- `callKinexys(name, body?)`, `kinexysGet(name)`, `kinexysPost(name, body)`
  are **generic passthroughs** over real mTLS HTTPS. They resolve the
  path/method exclusively from `KINEXYS_ENDPOINTS_JSON`.
- Anything missing — config, endpoint map entry, or cert material — throws a
  fail-closed error naming this document. There are no mocks and no
  fabricated Kinexys responses, by design.

## What we will never do

Hardcode Kinexys endpoint paths, guess response shapes, or present
simulated Kinexys balances/transfers as real. Until whitelisted onboarding
completes, Kinexys is documented here as a seam with a known activation
path — nothing more.
