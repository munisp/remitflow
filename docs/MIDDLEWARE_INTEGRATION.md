# RemitFlow — Enterprise Middleware Integration Guide

**Version:** v56  
**Date:** 2026-04-18

---

## Architecture Overview

RemitFlow uses a polyglot microservices architecture with the following middleware stack:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APISIX API Gateway                          │
│  Rate limiting · JWT auth · CORS · Prometheus metrics · Tracing     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│  Node.js App  │   │  Go Microservices │   │ Python/Rust Services │
│  (tRPC/React) │   │  fx-engine       │   │ kafka-processor      │
│  Port 3000    │   │  mojaloop-conn   │   │ search-indexer       │
│               │   │  ledger-service  │   │ lakehouse-etl        │
│               │   │  risk-engine     │   │ temporal-workflows   │
│               │   │  go-community    │   │ fraud-ml             │
│               │   │  go-investment   │   │ investment-ml        │
└───────┬───────┘   └────────┬─────────┘   └──────────┬──────────┘
        │                    │                         │
        └────────────────────┼─────────────────────────┘
                             │
        ┌────────────────────┼─────────────────────────┐
        │                    │                         │
        ▼                    ▼                         ▼
┌──────────────┐   ┌──────────────────┐   ┌───────────────────────┐
│    Kafka     │   │     Redis        │   │      OpenSearch       │
│  Event bus   │   │  Cache/Sessions  │   │   Full-text search    │
│  Fluvio alt  │   │  Rate limiting   │   │   Transaction index   │
└──────────────┘   └──────────────────┘   └───────────────────────┘
        │
        ├──────────────────────────────────────────────┐
        │                                              │
        ▼                                              ▼
┌──────────────────┐                        ┌──────────────────────┐
│    Temporal      │                        │    TigerBeetle       │
│  Workflow engine │                        │  Double-entry ledger │
│  Payment flows   │                        │  Immutable audit     │
└──────────────────┘                        └──────────────────────┘
        │
        ├────────────────────────────────────────────────────────────┐
        │                                                            │
        ▼                                                            ▼
┌──────────────────┐                                    ┌────────────────────┐
│    Keycloak      │                                    │      Permify       │
│  SSO / OAuth2    │                                    │  RBAC / AuthZ      │
│  Enterprise IdP  │                                    │  Fine-grained      │
└──────────────────┘                                    └────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         Lakehouse (Delta Lake)                           │
│  Transaction analytics · Regulatory reporting · ML feature store         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Middleware Components

### 1. Apache Kafka (Event Bus)

**Purpose:** Decoupled event-driven communication between all services.

**Topics:**
| Topic | Producer | Consumer | Description |
|---|---|---|---|
| `remitflow.transactions` | Node.js app | kafka-processor, search-indexer, aml-engine | All transaction events |
| `remitflow.kyc.events` | Node.js app | kafka-processor, fraud-ml | KYC status changes |
| `remitflow.fx.rates` | fx-engine | Node.js app, risk-engine | Live FX rate updates |
| `remitflow.fraud.alerts` | fraud-ml, aml-engine | Node.js app, kafka-processor | Fraud/AML alerts |
| `remitflow.payments.completed` | Node.js app, mojaloop-connector | temporal-workflows, lakehouse-etl | Payment completions |
| `remitflow.investments` | Node.js app | kafka-processor, search-indexer | Investment events |
| `remitflow.community` | Node.js app | go-community-feed | Community activity |

**Node.js Integration:** `server/middleware/kafka.ts`
```typescript
import { publishEvent, subscribeToTopic } from './server/middleware/kafka';

// Publish a transaction event
await publishEvent('remitflow.transactions', {
  type: 'TRANSACTION_CREATED',
  transactionId: tx.id,
  userId: ctx.user.id,
  amount: tx.amount,
  currency: tx.currency,
  timestamp: Date.now()
});
```

### 2. Redis (Cache + Sessions)

**Purpose:** High-performance caching, session storage, and rate limiting.

**Key Patterns:**
| Pattern | TTL | Description |
|---|---|---|
| `fx:rate:{from}:{to}` | 30s | FX rate cache |
| `session:{userId}` | 24h | User session data |
| `ratelimit:{ip}:{window}` | 60s | Rate limit counters |
| `kyc:status:{userId}` | 5m | KYC status cache |
| `portfolio:{userId}` | 60s | Portfolio value cache |
| `lockout:{userId}` | 15m | Auth lockout |

**Node.js Integration:** `server/middleware/redis.ts`
```typescript
import { redisGet, redisSet, redisDel } from './server/middleware/redis';

// Cache FX rate
await redisSet(`fx:rate:${from}:${to}`, JSON.stringify(rate), 30);
const cached = await redisGet(`fx:rate:${from}:${to}`);
```

### 3. OpenSearch (Full-Text Search)

**Purpose:** Full-text search across transactions, users, beneficiaries, and community content.

**Indices:**
| Index | Documents | Description |
|---|---|---|
| `remitflow-transactions` | All transactions | Searchable by amount, currency, status, recipient |
| `remitflow-users` | User profiles | Searchable by name, email, KYC tier |
| `remitflow-beneficiaries` | Beneficiary records | Searchable by name, bank, country |
| `remitflow-community` | Posts, comments | Full-text community search |
| `remitflow-investments` | Investment assets | Searchable by symbol, name, sector |

**Node.js Integration:** `server/middleware/opensearch.ts`
```typescript
import { searchTransactions, indexDocument } from './server/middleware/opensearch';

const results = await searchTransactions({
  query: 'Lagos Nigeria',
  filters: { status: 'completed', minAmount: 100 },
  from: 0,
  size: 20
});
```

### 4. Temporal (Workflow Engine)

**Purpose:** Durable, fault-tolerant execution of long-running business processes.

**Workflows:**
| Workflow | Trigger | Steps |
|---|---|---|
| `PaymentWorkflow` | Transaction created | Validate → FX lock → AML check → Execute → Notify → Ledger |
| `KYCWorkflow` | KYC submission | Document verify → Biometric → Sanctions check → Approve/Reject |
| `RecurringPaymentWorkflow` | Scheduled trigger | Check balance → FX rate → Execute → Notify |
| `InvestmentOrderWorkflow` | Stripe webhook | Verify payment → Allocate shares → Update portfolio → Notify |
| `DisputeWorkflow` | Dispute filed | Notify merchant → Gather evidence → Review → Resolve |

**Python Worker:** `services/temporal-workflows/main.py`

### 5. Keycloak (Enterprise SSO)

**Purpose:** Enterprise-grade identity provider for B2B customers and admin users.

**Realm:** `remitflow` (config: `config/keycloak/remitflow-realm.json`)

**Clients:**
- `remitflow-web` — React frontend (public client)
- `remitflow-api` — Node.js backend (confidential client)
- `remitflow-admin` — Admin panel (confidential, admin-only)

**Roles:**
- `user` — Standard remittance user
- `agent` — Cash-out agent
- `admin` — Platform administrator
- `compliance` — Compliance officer
- `finance` — Finance team

### 6. Permify (Fine-Grained Authorization)

**Purpose:** Relationship-based access control (ReBAC) for complex permission scenarios.

**Schema:** `config/permify/schema.perm`

**Key Permissions:**
```
entity user {
  relation admin @role#admin
  relation compliance @role#compliance
  
  action view_kyc = admin or compliance
  action approve_kyc = admin or compliance
  action view_transactions = admin or self
  action export_data = admin
}

entity transaction {
  relation owner @user
  relation viewer @user
  
  action view = owner or viewer or admin
  action cancel = owner or admin
  action dispute = owner
}
```

**Node.js Integration:** `server/middleware/permify.ts`
```typescript
import { checkPermission } from './server/middleware/permify';

const allowed = await checkPermission({
  subject: { type: 'user', id: ctx.user.id.toString() },
  permission: 'view_kyc',
  entity: { type: 'user', id: input.targetUserId.toString() }
});
if (!allowed) throw new TRPCError({ code: 'FORBIDDEN' });
```

### 7. Dapr (Distributed Application Runtime)

**Purpose:** Service-to-service communication, pub/sub, state management, and secret management.

**Components:**
- **Pub/Sub:** Kafka-backed (`config/dapr/components/pubsub.yaml`)
- **State Store:** Redis-backed (`config/dapr/components/statestore.yaml`)
- **Bindings:** Kafka topic bindings (`config/dapr/components/bindings.yaml`)

**Sidecar Annotations (K8s):**
```yaml
annotations:
  dapr.io/enabled: "true"
  dapr.io/app-id: "remitflow-app"
  dapr.io/app-port: "3000"
```

### 8. TigerBeetle (Financial Ledger)

**Purpose:** High-performance, ACID-compliant double-entry accounting ledger.

**Account Types:**
| Account ID | Type | Description |
|---|---|---|
| 1000 | Asset | Customer wallets (aggregate) |
| 2000 | Liability | Pending transfers |
| 3000 | Revenue | Platform fees |
| 4000 | Expense | FX costs |
| 5000-5999 | User | Individual user accounts |

**Go Integration:** `services/ledger-service/main.go`

### 9. Apache APISIX (API Gateway)

**Purpose:** Production API gateway with rate limiting, auth, load balancing, and observability.

**Configuration:** `config/apisix/config.yaml`, `config/apisix/routes.yaml`

**Setup:** `services/gateway-config/setup-routes.sh`

**Plugins enabled:**
- `limit-req` — Token bucket rate limiting
- `jwt-auth` — JWT token validation
- `cors` — Cross-origin resource sharing
- `proxy-cache` — Response caching (FX rates: 30s TTL)
- `prometheus` — Metrics export
- `zipkin` — Distributed tracing
- `response-rewrite` — Security headers injection

### 10. Fluvio (Streaming Alternative)

**Purpose:** Alternative to Kafka for edge deployments and lower-latency streaming.

**Topics:** `config/fluvio/topics.yaml`

**Use cases:**
- Real-time FX rate streaming to frontend
- Live transaction status updates
- Community feed real-time updates

### 11. Lakehouse (Delta Lake)

**Purpose:** Analytics data lake for regulatory reporting, ML training, and business intelligence.

**ETL Pipeline:** `services/lakehouse-etl/main.py`

**Tables:**
| Table | Source | Refresh | Use |
|---|---|---|---|
| `transactions_delta` | PostgreSQL | Every 5 min | Regulatory reporting |
| `fx_rates_history` | fx-engine | Real-time | ML feature store |
| `user_behavior` | Kafka | Real-time | Fraud ML training |
| `payment_metrics` | PostgreSQL | Hourly | Business analytics |
| `investment_performance` | PostgreSQL | Daily | Portfolio analytics |

### 12. Mojaloop (Interoperability)

**Purpose:** ISO 20022-compliant interoperable payment network for cross-border transfers.

**Go Connector:** `services/mojaloop-connector/main.go`

**Supported flows:**
- P2P transfers via MSISDN/account lookup
- Bulk disbursements
- Merchant payments
- Agent cash-out

---

## Quick Start

### Local Development (Docker Compose)

```bash
# Start core app only
docker-compose up -d

# Start with middleware
docker-compose -f docker-compose.yml -f docker-compose.middleware.yml up -d

# Start with all microservices
docker-compose -f docker-compose.full.yml up -d

# Configure APISIX routes
./services/gateway-config/setup-routes.sh http://localhost:9180
```

### Production (Kubernetes)

```bash
# Create namespaces
kubectl apply -f k8s/middleware/middleware-stack.yaml

# Deploy app
kubectl apply -f k8s/deployment.yaml

# Deploy microservices
kubectl apply -f k8s/middleware/services-stack.yaml

# Verify
kubectl get pods -n remitflow
kubectl get pods -n remitflow-middleware
```

---

## Environment Variables

All middleware connection strings are configured via environment variables. See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker list |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `OPENSEARCH_URL` | `http://localhost:9200` | OpenSearch URL |
| `TEMPORAL_HOST` | `localhost:7233` | Temporal gRPC endpoint |
| `KEYCLOAK_URL` | `http://localhost:8080` | Keycloak base URL |
| `PERMIFY_URL` | `http://localhost:3476` | Permify HTTP API |
| `DAPR_HTTP_PORT` | `3500` | Dapr sidecar HTTP port |
| `TIGERBEETLE_ADDRESS` | `localhost:3000` | TigerBeetle address |
| `APISIX_ADMIN_URL` | `http://localhost:9180` | APISIX admin API |
