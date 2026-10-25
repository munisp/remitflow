# W21 Gap Closure — Forensic Finding → Fix Lane → Evidence Map

Source: forensic reports on instant settlement, XRP/ODL, stablecoins (post-W20 tree `bdc-integration` @ c0c0aa0), plus W21 residuals.
Evidence column intentionally left PENDING-MERGE — to be filled by the orchestrator/verifier after lane merges and adversarial verification.

| # | Forensic finding | Fix lane | Evidence file (expected) | Evidence |
|---|------------------|----------|--------------------------|----------|
| 1 | P2P instant settlement: Mojaloop UNCERTAIN parks (`settling` rows) never reconciled; no reaper | G | `server/_core/p2pReconWorker.ts`, `server/routers/p2pInstant.ts`, `drizzle/0104_p2p_recon.sql` | PENDING-MERGE |
| 2 | Localhost FX fallback (localhost:3001 rate source, mock rate history :1785) reachable in prod | G | `server/routers/p2pInstant.ts` (fail-closed prod path) | PENDING-MERGE |
| 3 | Mojaloop sandbox defaults (switch URL / API key / callback URL) used in production | H | `server/mojaloop.service.ts`, `server/mojaloop.webhook.ts` | PENDING-MERGE |
| 4 | Redis distributed lock placeholder always returns true (:189-192) | H | `server/mojaloop.service.ts` (SET NX PX + fencing token, fail closed) | PENDING-MERGE |
| 5 | APISix rate-limit config (:141-178) defined but never applied | H | APISix admin-API push (config-gated) or honest removal in `server/mojaloop.service.ts` | PENDING-MERGE |
| 6 | Fluvio `streamToFluvio` log-only (claimed streaming, no produce) | H | Fluvio producer wiring or removed claim in `server/mojaloop.service.ts` | PENDING-MERGE |
| 7 | Callback durability: transfer-state callbacks silently degrade to in-memory; opportunistic DDL `_ensurePendingCallbacksTable` | H | `server/mojaloop.webhook.ts` (fail-closed durable persistence) | PENDING-MERGE |
| 8 | transfer.send third ledger path `grpcLedgerTransfer` fail-open (~:1855) on ledger write | I | `server/routers.ts` (durable journal/dual-write outbox pattern) | PENDING-MERGE |
| 9 | `broker_fill_intents` log-only intent, no persistence | I | `drizzle/schema.ts`, `drizzle/0105_broker_fill_intents.sql` | PENDING-MERGE |
| 10 | XRPL adapter: fabricated txIDs / static fabricated EstimatedCost/Liquidity on XRP corridors | J | `services/go-odl-orchestrator/`, `services/universal-fx/` (real rippled JSON-RPC client, fail-closed UNAVAILABLE without config) | PENDING-MERGE |
| 11 | Custody key files: Fireblocks PEM env-only; no file/KMS loading, no prod fail-closed | K | `server/routers/cryptoCustody.ts` (`FIREBLOCKS_API_SECRET_FILE` / KMS hook) | PENDING-MERGE |
| 12 | Capability flags: UI cannot honestly disable on-chain send; stablecoinEnhanced missing `onChainAvailable` flag | K | `server/routers/cryptoCustody.ts`, `server/routers/stablecoinEnhanced.ts` | PENDING-MERGE |
| 13 | Drizzle journal: migrations 0087–0103 present as files but unregistered in `drizzle/meta/_journal.json` | L (this lane) | `drizzle/meta/_journal.json` | REGISTERED-THIS-LANE |

## Notes

- Journal entries appended for 0087–0103 (idx 37–53), matching the existing format exactly (`version: "7"`, `dialect: "postgresql"`, `breakpoints: true`, `when` increasing by 60000 ms per entry, continuing from 0086's 1776482075965).
- `0104_p2p_recon.sql` (Lane G) and `0105_broker_fill_intents.sql` (Lane I) do not exist at this commit and are NOT journaled. The orchestrator must append journal entries idx 54/55 (`when` +60000 ms each, in order) once those lanes merge, or re-run Lane L registration.
- OTP "in production: verify" stub (:1234) is folded into finding #1/#2 scope (Lane G).
