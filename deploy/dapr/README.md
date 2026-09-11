# Dapr — RemitFlow Middleware Integration

## Why Dapr is in this stack

Dapr (`docker-compose.middleware.yml: dapr-placement`, plus one `daprd`
sidecar per participating app via `dapr-sidecar-creator.sh`) is our
**portable middleware facade**. It is NOT a new broker or database — it sits
in front of the infra we already run (Kafka, Redis, PostgreSQL) and exposes
the three primitives the polyglot services (Go / Rust / Python / TS) consume
through a single sidecar API (`http://localhost:3500` by default):

| Primitive   | Backing component (see `components/`) | Used for |
|-------------|----------------------------------------|----------|
| **Pub/Sub** | `pubsub.kafka` (`components/kafka-pubsub.yaml`) | Domain events — Kafka stays the broker; services publish/subscribe via the sidecar instead of embedding Kafka clients |
| **State**   | `statestore.redis` (`components/redis-state.yaml`) | Ephemeral workflow/service state with TTL — Redis stays the store |
| **Secrets** | `secretstores.local.env` (dev) / `kubernetes` (prod) (`components/local-secrets.yaml`, `kubernetes-secrets.yaml`) | Uniform secret retrieval for services |

`dapr-placement` (port 50005) only exists to track **actor** placement —
required infrastructure even when actors are lightly used, and harmless
otherwise. The **Dapr dashboard** (`:8099`) is the read-only topology view
scoped to `network_mode: service:dapr-placement` so it shares the
placement network and requires no port of its own.

## How services opt in

A service gets a sidecar only if it is listed in
`dapr-sidecar-creator.sh` — sidecars are **created on demand**, not globally.
Health probes for Dapr-enabled apps should hit the sidecar health endpoint
(`:3500/v1.0/healthz`) in addition to app `/health`.

## Observability

`configuration.yaml` enables **Zipkin** tracing and **Prometheus** metrics
on the sidecars (`:9090/metrics`). The dashboard is inventory/topology only
and is not a metrics source.

## What to check when debugging

1. Is the app's sidecar created? (`dapr-sidecar-creator.sh` allowlist)
2. Are component YAMLs loaded? (mounted under `/components`)
3. Is `dapr-placement` healthy? (required for any actor workload)
4. For pub/sub issues: check Kafka reachability first — Dapr is a facade,
   the broker is still authoritative.
