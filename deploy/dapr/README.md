# Dapr components — Wave 10 (W10-C4)

`go-accounting-sync` (:8113) uses two Dapr building blocks via its sidecar:

| Component      | Type          | Used for                                                        |
| -------------- | ------------- | --------------------------------------------------------------- |
| `kafka-pubsub` | `pubsub.kafka` | Publishing `remitflow.accounting-sync` sync/connect/error events |
| `redis-state`  | `state.redis`  | OAuth state nonces (single-use, TTL) + sync cursors (idempotency) |

Both manifests are scoped to the Dapr app id `accounting-sync`.

## Sidecar annotations

Add these annotations to the `go-accounting-sync` Deployment pod template so
the Dapr injector attaches the sidecar:

```yaml
metadata:
  annotations:
    dapr.io/enabled: "true"
    dapr.io/app-id: "accounting-sync"
    dapr.io/app-port: "8113"
    dapr.io/app-protocol: "http"
    dapr.io/enable-api-logging: "false"
```

The service discovers the sidecar through the injected `DAPR_HTTP_PORT` env
var (default 3500). When `DAPR_HTTP_PORT` is **unset** the service still runs,
but logs a warning and falls back to:

- in-memory OAuth state nonces (TTL-bounded; single replica only), and
- a local cursor file (`CURSOR_FILE`, default
  `$TMPDIR/go-accounting-sync-cursors.json`), and
- direct event emit to `TS_EVENT_URL` (TS core → Kafka) instead of Dapr
  pub/sub.

## Rendering the manifests

Broker/host values are environment placeholders — render before applying:

```bash
export KAFKA_BROKERS="kafka-0.kafka-headless:9092,kafka-1.kafka-headless:9092"
export REDIS_HOST="redis-master:6379"
envsubst < deploy/dapr/components/kafka-pubsub.yaml | kubectl apply -f -
envsubst < deploy/dapr/components/redis-state.yaml | kubectl apply -f -
```

Secrets are resolved from Kubernetes secrets via `secretKeyRef`
(`remitflow-kafka`, `remitflow-redis`) — no credentials live in these files.

## Event contract

Published to topic `remitflow.accounting-sync` on component `kafka-pubsub`:

```json
{
  "type": "connect | push_complete | pull_complete | error",
  "provider": "quickbooks_online | xero",
  "connectionId": "<accounting_connections.id>",
  "detail": "human-readable summary",
  "at": "RFC3339Nano"
}
```

Events never carry OAuth tokens or provider payload bodies.
