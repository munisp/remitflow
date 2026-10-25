# DTCC — Why It's Out of Scope, and the Only Real Path In

> **Status: seam, not integration — and explicitly the wrong layer for
> remittance.** `server/_core/dtccClient.ts` is a fail-closed shell kept for a
> future, custodian-mediated tokenized-securities use case. `getDtccStatus()`
> always reports `inScopeForRemittance: false`.

## What DTCC is

The Depository Trust & Clearing Corporation is the central post-trade
infrastructure for US (and much global) securities markets: clearing,
settlement, custody (via DTC), netting (via NSCC), and asset servicing.
It processes securities, not payments.

## Why DTCC is the wrong layer for RemitFlow's rails

- **It is not a payments rail.** No retail transfers, no remittance
  corridors, no stablecoin payout capability. Cross-border remittance
  settles through banking rails (ACH/wires/RTP/SWIFT) and stablecoin rails
  (Circle) — never through a securities depository.
- **Access is member-only.** DTCC services are available to member firms
  (broker-dealers, banks, clearing agencies). Connectivity is FIX, SWIFT,
  and file-based batch — not developer REST APIs.
- **The DTCC API Marketplace (developer.dtcc.com) is client-only.**
  Credentials are provisioned through a DTCC relationship manager to
  existing member firms. There is no public signup, no open sandbox, and no
  self-serve path for a fintech that is not a member.
- **DTCC's digital-asset work (e.g. tokenized collateral initiatives)**
  targets institutional securities workflows, not consumer money movement.

## The only path in: custodian / clearing-broker sponsorship

If RemitFlow ever launches **tokenized securities** (not remittance), the
realistic route is:

1. Contract a **custodian bank or clearing broker that is a DTCC member**.
2. Access DTCC services **through the sponsor's membership** — RemitFlow
   never connects to DTCC directly.
3. The sponsor (or DTCC) provides endpoint/file-format documentation for
   the specific sponsored service.
4. Only then configure the shell in `server/_core/dtccClient.ts`.

## Shell configuration (future, custodian-mediated use only)

| Variable | Purpose |
|---|---|
| `DTCC_API_BASE_URL` | Sponsor-provided API base URL (mTLS) |
| `DTCC_MTLS_CERT_FILE` | Client certificate |
| `DTCC_MTLS_KEY_FILE` | Matching private key |
| `DTCC_MTLS_CA_FILE` | Optional CA bundle override |
| `DTCC_ENDPOINTS_JSON` | JSON map: `{"name": {"path": "...", "method": "GET"\|"POST"}}` from the sponsor |
| `DTCC_SFTP_HOST` / `DTCC_SFTP_PORT` / `DTCC_SFTP_USER` / `DTCC_SFTP_KEY_FILE` | Member file-based batch channel (validated by `getDtccSftpConfig()`) |
| `DTCC_TIMEOUT_MS` | Optional request timeout (default 15000) |

Behavior contract:

- `callDtccApi(name, body?)` — generic mTLS HTTPS passthrough; paths come
  exclusively from `DTCC_ENDPOINTS_JSON`. Unknown names throw.
- `getDtccSftpConfig()` — validates and returns the SFTP channel config;
  throws if unset or key file missing.
- Everything is fail-closed: no mocks, no fabricated DTCC responses, no
  hardcoded DTCC endpoint paths. Unconfigured calls throw an error naming
  this document.
