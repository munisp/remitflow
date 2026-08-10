# RemitFlow — 13-Component Infrastructure Audit & Remediation (2026-08-11)

Adversarial, evidence-based audit of HEAD by 4 parallel auditors, followed by a
6-track remediation wave + manifest consolidation. Every fix is real code —
no mocks, no placeholders, fail-loud where dependencies are unavailable.

## Scorecard (pre-remediation → post-remediation)

| # | Component | Before | After | Key remediation |
|---|-----------|--------|-------|-----------------|
| 1 | PostgreSQL | 7/10 | 9/10 | Migration journal reconciled to one track (0081-0083 added); demo-wallet seeding gated to non-prod (`ENABLE_DEMO_SEED`); outbox worker `FOR UPDATE SKIP LOCKED` + visibility timeout; tenant GUC middleware on all protected procedures (`tenantGuc.ts`); `withTransactionOutbox` atomic producers |
| 2 | TigerBeetle | 3/10 | 7/10 | Client pinned to 0.16.63 matching server; Rust bridge rewritten to the exact TS contract with real TB wire client + honest health; hardcoded `connected:true` lies removed; transfer pipeline resolves provisioned 128-bit accounts per currency; TB server container + init added to compose; tigerbeetle-shadow implemented (Go) |
| 3 | Redis | 6/10 | 8/10 | Three TS clients consolidated into `redisHardened.ts` (facade preserved); redis.conf/users.acl actually mounted (EVAL ban replaced with per-user ACL Lua gating); appendonly + allkeys-lfu on both containers; fail-open lock degraded mode behind explicit flag |
| 4 | Mojaloop | 3/10 | 7/10 | Real FSPIOP v1.1 JWS signing + callback verification; genuine ILPv4 binary packets (IL-RFC-27) in TS and Go; fabricated quotes/parties deleted (fail-closed all envs); Go connector `COMMITTED`-on-error lie fixed; pending-transfer state persisted to real tables; ports/routes converged on 8113 `/v1/*` |
| 5 | Kafka | 6/10 | 8/10 | Idempotent producers (`idempotent:true, maxInFlightRequests:1`), deterministic idempotency keys; consumer retry+backoff with real DLQ→Postgres persistence + reprocess; theater `kafkaConsumers.ts`/`kafkaHardened.ts` deleted; Go `RequiredAcks: RequireAll` + error checks; Python `enable.idempotence`; schema-registry service added |
| 6 | APISIX | 4/10 | 7/10 | Published default admin key removed everywhere (fail-fast); rate-limit config now GET-merge-PUT (no route clobbering); bootstrap route gains `openid-connect` (Keycloak discovery, ssl_verify default true); foreign 54remit YAML deleted; stablecoin routes actually applied via setup-routes.sh; admin plane bound to localhost |
| 7 | Keycloak | 5/10 | 8/10 | `jose` JWKS RS256 verification (`keycloak-jwks.ts`, alg/iss/aud strict); 300s sessions + refresh rotation when configured; dev-login gated behind `ALLOW_DEV_LOGIN`; `/api/auth/keycloak/login` PKCE initiation wired to PWA + RN; realm export: audience mapper, refresh rotation, admin service-account, no fallback secrets |
| 8 | open-appsec | 3/10 | 6/10 | Fabricated `/v1/check` + `/inspect` middleware deleted; sidecar contract honest (`OPENAPPSEC_SIDECAR_URL`, fail-open, 250ms); `X-OpenAppSec-Protected` only after real inspection; compose agent moved to ghcr.io image, privileged/docker.sock removed; real agent+APISIX-attachment pattern kept as the WAF path |
| 9 | Permify | 4/10 | 8/10 | Canonical schema `remitflow_schema.perm` covering every checked entity/permission; startup tenant-create + schema-write bootstrap (`scripts/permify-bootstrap.ts` + k8s Job); `.catch(()=>true)` fail-open removed; owner-relationship tuple writes with retry/outbox; `writeRelationship` no longer swallows 4xx; go-permify-service implemented and deployed in compose |
| 10 | OpenSearch | 5/10 | 7/10 | `bootstrapOpenSearch()` at startup: real index creation + index-template/ILM application; TLS verification on by default (`OPENSEARCH_INSECURE` dev opt-out); security plugin enabled in compose with strong admin password; canonical env (`OPENSEARCH_USERNAME/PASSWORD`) with legacy fallback |
| 11 | Fluvio | 2/10 | 5/10 | In-memory `fluvioHardened.ts` fake deleted; tRPC procedures rerouted to real bridge client (fail-loud `FluvioError`); outbox circular requeue broken (dead-letter + redrive); env unified on `FLUVIO_HTTP_BRIDGE_URL`. Remaining: protocol-native `fluvio` crate consumer + bridge service deployment |
| 12 | Dapr | 5/10 | 8/10 | Component names unified (`pubsub`/`statestore`, env `DAPR_PUBSUB`/`DAPR_STATE_STORE`); publish throws on critical topics; real `/dapr/subscribe` + `/events/<topic>` handlers with RETRY semantics; plaintext Redis password removed (secretKeyRef); daprd version aligned 1.14.4; go-dapr-service implemented |
| 13 | Lakehouse | 5/10 | 8/10 | `lakehouseHardened.ts` fake deleted; TS↔Python contract aligned (`/sync/{table}`, real `/ingest`, `/read`, `/compact`); asyncio sync scheduler (900s); fabricated Delta/Kafka-CDC claims removed; missing deps added (psycopg2, duckdb); lakehouse-etl deployed in compose; MinIO creds externalized |

## Systemic patterns fixed repo-wide
- All `*Hardened.ts` in-memory fakes (fluvio, lakehouse, kafka) deleted or consolidated.
- Duplicate parallel integrations collapsed to single tested paths (Redis ×3→1, Permify ×2→1, WAF ×2→0+real attachment, Dapr naming ×3→1).
- Plaintext/default secrets removed: APISIX default admin key (5 sites), Dapr Redis password, Keycloak fallback secrets, MinIO defaults, k8s `CHANGE_ME` ×11.
- UI theater removed: fabricated FX rates, fake rate-locks, hardcoded account numbers, dead nav items (PWA); new Platform Status dashboard + Keycloak SSO (PWA + React Native).

## Known deferrals (honest list)
1. `pnpm-lock.yaml` regeneration required after the tigerbeetle-node 0.16.63 pin (needs network `pnpm install`).
2. Rust crates (tigerbeetle-bridge/service) and new Go services (tigerbeetle-shadow, go-dapr-service, go-permify-service) compile-verified where toolchains existed; `cargo check`/`go build` should rerun in CI.
3. Fluvio protocol-native consumer (fluvio crate) and an actual HTTP bridge deployment remain infrastructure work.
4. Mojaloop end-to-end against a live switch/sandbox requires JWS key provisioning (`MOJALOOP_JWS_*`).
5. ES-ILM→OpenSearch-ISM policy translation fails loudly with remediation guidance (not silently faked).
6. Pre-existing port collisions (8100, 8102, 8092, 8103) and duplicate `temporal:` compose key flagged but out of audit scope.
