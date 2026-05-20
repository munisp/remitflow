# PostgreSQL HA for Mojaloop

This directory contains the Kubernetes manifests for deploying a highly-available PostgreSQL cluster for Mojaloop services using the Zalando Postgres Operator.

## Architecture

```
                                    ┌─────────────────────────────────────────┐
                                    │           Mojaloop Services             │
                                    │  (Central Ledger, Settlement, etc.)     │
                                    └─────────────────┬───────────────────────┘
                                                      │
                                                      ▼
                                    ┌─────────────────────────────────────────┐
                                    │              PgBouncer                  │
                                    │         (Connection Pooling)            │
                                    │            Port: 6432                   │
                                    └─────────────────┬───────────────────────┘
                                                      │
                              ┌───────────────────────┼───────────────────────┐
                              │                       │                       │
                              ▼                       ▼                       ▼
                    ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
                    │   PostgreSQL    │     │   PostgreSQL    │     │   PostgreSQL    │
                    │    Primary      │────▶│    Replica 1    │     │    Replica 2    │
                    │   (Read/Write)  │     │   (Read Only)   │     │   (Read Only)   │
                    └─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   TigerBeetle   │
                    │  (Ledger Truth) │
                    └─────────────────┘
```

## Components

### 1. Postgres Operator (`postgres-operator.yaml`)
- Zalando Postgres Operator v1.10.1
- Manages PostgreSQL clusters lifecycle
- Handles automatic failover via Patroni
- Provides connection pooling via PgBouncer

### 2. Mojaloop Postgres Cluster (`mojaloop-postgres-cluster.yaml`)
- 3-node PostgreSQL 15 cluster (1 primary + 2 replicas)
- Automatic failover with Patroni
- Built-in connection pooler
- Prometheus metrics exporter
- Logical backup to S3

### 3. PgBouncer (`pgbouncer-config.yaml`)
- Transaction-mode connection pooling
- Separate pools for read-write and read-only
- Health monitoring and metrics

### 4. Migration Job (`migration-job.yaml`)
- Runs Alembic migrations before deployment
- Helm pre-upgrade/pre-install hook
- Waits for PostgreSQL to be ready

## Deployment

### Prerequisites
1. Kubernetes cluster with storage class
2. kubectl configured
3. Helm (optional, for hooks)

### Install Postgres Operator
```bash
kubectl apply -f postgres-operator.yaml
```

### Deploy Mojaloop Cluster
```bash
kubectl apply -f mojaloop-postgres-cluster.yaml
```

### Deploy PgBouncer
```bash
kubectl apply -f pgbouncer-config.yaml
```

### Run Migrations
```bash
kubectl apply -f migration-job.yaml
```

## Connection Strings

### Through PgBouncer (Recommended)
```
postgresql://mojaloop:PASSWORD@pgbouncer.remittance.svc.cluster.local:6432/mojaloop
```

### Direct to Primary
```
postgresql://mojaloop:PASSWORD@mojaloop-postgres-primary.remittance.svc.cluster.local:5432/mojaloop
```

### Direct to Replica (Read-Only)
```
postgresql://mojaloop:PASSWORD@mojaloop-postgres-replica.remittance.svc.cluster.local:5432/mojaloop
```

## Schema Organization

Each Mojaloop service has its own schema:
- `central_ledger` - Participant positions, NDC, liquidity
- `settlement` - Settlement windows, batches, reconciliation
- `participant_registry` - FSP registration, endpoints, credentials
- `transfers` - Transfer lifecycle, ILP, callbacks
- `quotes` - Quote management

## Alembic Migrations

Each service has its own Alembic configuration:
```
migrations/
├── alembic.ini
├── central_ledger/
│   ├── env.py
│   └── versions/
├── settlement_service/
│   ├── env.py
│   └── versions/
├── participant_registry/
│   ├── env.py
│   └── versions/
└── transfer_service/
    ├── env.py
    └── versions/
```

### Running Migrations Locally
```bash
cd backend/mojaloop-services/migrations
export DATABASE_URL="postgresql://mojaloop:password@localhost:5432/mojaloop"

# Central Ledger
alembic -c alembic.ini upgrade head

# Settlement Service
alembic -c alembic.ini -x script_location=settlement_service upgrade head
```

## HA Features

### Automatic Failover
- Patroni manages leader election
- Automatic promotion of replica on primary failure
- Typically < 30 seconds failover time

### Connection Pooling
- PgBouncer in transaction mode
- Reduces connection overhead
- Handles failover transparently

### Idempotency
- All operations use idempotency keys
- Unique constraints prevent duplicates
- Safe retry on failover

### Reconciliation
- Background reconciliation service
- Syncs Postgres state with TigerBeetle
- Detects and fixes state mismatches

## Monitoring

### Prometheus Metrics
- PostgreSQL exporter on port 9187
- PgBouncer exporter on port 9127
- ServiceMonitor for automatic discovery

### Key Metrics
- `pg_up` - Database availability
- `pg_replication_lag` - Replication delay
- `pgbouncer_pools_*` - Connection pool stats

## Backup & Recovery

### Logical Backups
- Daily backups to S3
- Configurable schedule in cluster spec
- Point-in-time recovery support

### WAL Archiving
- Continuous WAL archiving
- Enables PITR
- Configurable retention

## TigerBeetle Integration

TigerBeetle remains the source of truth for monetary balances. PostgreSQL stores:
- Orchestration state (transfer lifecycle)
- Participant metadata
- Settlement windows and batches
- Audit trails

The reconciliation service ensures Postgres state matches TigerBeetle truth.

## Troubleshooting

### Check Cluster Status
```bash
kubectl get postgresql -n remittance
kubectl describe postgresql mojaloop-postgres -n remittance
```

### Check Pod Status
```bash
kubectl get pods -n remittance -l cluster-name=mojaloop-postgres
```

### View Patroni Status
```bash
kubectl exec -it mojaloop-postgres-0 -n remittance -- patronictl list
```

### Check Replication Lag
```bash
kubectl exec -it mojaloop-postgres-0 -n remittance -- psql -c "SELECT * FROM pg_stat_replication;"
```

### View PgBouncer Stats
```bash
kubectl exec -it pgbouncer-xxx -n remittance -- psql -p 6432 pgbouncer -c "SHOW POOLS;"
```
