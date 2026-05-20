# Mojaloop Local Hub Architecture

This document describes the architecture for the local Mojaloop Hub deployment with PostgreSQL and its integration with TigerBeetle as the ledger-of-record.

## Overview

The Nigerian Remittance Platform deploys a local Mojaloop Hub to handle FSPIOP (Financial Services Provider Interoperability Protocol) operations. This architecture provides:

1. **Local Mojaloop Hub** - Full FSPIOP protocol support for interoperable payments
2. **PostgreSQL Backend** - HA PostgreSQL (RDS Multi-AZ) instead of MySQL
3. **TigerBeetle Integration** - TigerBeetle remains the ledger-of-record for all customer balances
4. **Future Compatibility** - Designed to be compatible with Mojaloop upstream updates

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Nigerian Remittance Platform                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │   PWA / Mobile   │    │  Android Native  │    │   iOS Native     │       │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘       │
│           │                       │                       │                  │
│           └───────────────────────┼───────────────────────┘                  │
│                                   ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        API Gateway (Kong)                            │    │
│  └─────────────────────────────────┬───────────────────────────────────┘    │
│                                    │                                         │
│           ┌────────────────────────┼────────────────────────┐               │
│           ▼                        ▼                        ▼               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Transaction Svc │    │   Wallet Svc    │    │  Payment Svc    │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           └──────────────────────┼──────────────────────┘                   │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Mojaloop Connector Service                        │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │   │
│  │  │ Enhanced Client │  │ Callback Handler│  │ Reconciliation  │      │   │
│  │  │ (mojaloop_      │  │ (mojaloop_      │  │ (tigerbeetle_   │      │   │
│  │  │  enhanced.py)   │  │  callbacks.py)  │  │  reconcile.py)  │      │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘      │   │
│  └───────────┼────────────────────┼────────────────────┼───────────────┘   │
│              │                    │                    │                    │
│              ▼                    │                    ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      LOCAL MOJALOOP HUB                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │   │
│  │  │ ML API      │  │ Central     │  │ Account     │  │ Quoting     │ │   │
│  │  │ Adapter     │  │ Ledger      │  │ Lookup Svc  │  │ Service     │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │   │
│  │         │                │                │                │        │   │
│  │         └────────────────┼────────────────┼────────────────┘        │   │
│  │                          ▼                ▼                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │   │
│  │  │ Transaction │  │ Settlement  │  │ Event       │                  │   │
│  │  │ Requests    │  │ Service     │  │ Processor   │                  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│              │                                                              │
│              ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DATA LAYER                                   │   │
│  │                                                                      │   │
│  │  ┌─────────────────────────┐    ┌─────────────────────────┐         │   │
│  │  │   PostgreSQL (RDS)      │    │     TigerBeetle         │         │   │
│  │  │   Multi-AZ HA           │    │   (Ledger-of-Record)    │         │   │
│  │  │                         │    │                         │         │   │
│  │  │  - Mojaloop Hub DB      │    │  - Customer Accounts    │         │   │
│  │  │  - Participants         │    │  - Wallet Balances      │         │   │
│  │  │  - Quotes               │    │  - Two-Phase Transfers  │         │   │
│  │  │  - Transfers (metadata) │    │  - Linked Transfers     │         │   │
│  │  │  - Settlement Windows   │    │  - Fee Splits           │         │   │
│  │  │  - Callbacks            │    │  - Settlement Accounts  │         │   │
│  │  │  - Audit Logs           │    │                         │         │   │
│  │  └─────────────────────────┘    └─────────────────────────┘         │   │
│  │           │                              │                           │   │
│  │           └──────────────┬───────────────┘                           │   │
│  │                          ▼                                           │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │              Reconciliation Service                          │    │   │
│  │  │  (Ensures Mojaloop positions match TigerBeetle balances)     │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Ledger-of-Record Separation

### TigerBeetle (Ledger-of-Record)

TigerBeetle is the authoritative source of truth for all financial balances:

| Data Type | Description |
|-----------|-------------|
| Customer Accounts | Individual user wallet balances |
| DFSP Treasury | Platform's treasury/settlement accounts |
| Two-Phase Transfers | Pending transfers with reserved funds |
| Linked Transfers | Atomic multi-leg operations (fee splits) |
| Transfer History | Complete audit trail of all movements |

### PostgreSQL (Mojaloop Metadata)

PostgreSQL stores Mojaloop scheme-level data (NOT balances):

| Data Type | Description |
|-----------|-------------|
| Participants | Registered DFSPs and their endpoints |
| Quotes | FSPIOP quote requests and responses |
| Transfers | Transfer metadata and state (NOT balances) |
| Transaction Requests | Request-to-Pay records |
| Authorizations | OTP/PIN verification records |
| Settlement Windows | Settlement window state and content |
| Callbacks | Callback delivery tracking |
| Audit Logs | Scheme-level audit trail |

### Reconciliation

The platform maintains a reconciliation process to ensure consistency:

1. **Transfer Reconciliation**: Each Mojaloop transfer references its TigerBeetle transfer ID
2. **Position Reconciliation**: Periodic comparison of Mojaloop positions vs TigerBeetle balances
3. **Settlement Reconciliation**: Settlement window totals verified against TigerBeetle

## PostgreSQL Configuration

### Database Instances

The Mojaloop Hub uses a dedicated RDS PostgreSQL instance:

```
Instance: remittance-platform-mojaloop
Engine: PostgreSQL 15.4
Instance Class: db.r6g.large (production)
Multi-AZ: Enabled
Storage: gp3, 100GB initial, autoscaling to 500GB
Encryption: KMS encrypted
```

### Database Schema

Separate databases for each Mojaloop service:

| Database | Service |
|----------|---------|
| mojaloop_hub | Main hub database |
| mojaloop_central_ledger | Central Ledger service |
| mojaloop_als | Account Lookup Service |
| mojaloop_quoting | Quoting Service |
| mojaloop_txn_requests | Transaction Requests Service |
| mojaloop_settlement | Settlement Service |

### Connection Pooling

Each service uses connection pooling optimized for PostgreSQL:

```yaml
pool:
  min: 2
  max: 20
  acquireTimeoutMillis: 30000
  idleTimeoutMillis: 30000
```

## High Availability

### PostgreSQL HA (RDS Multi-AZ)

- **Primary**: Active instance handling all writes
- **Standby**: Synchronous replica in different AZ
- **Failover**: Automatic failover (typically < 60 seconds)
- **Read Replica**: Optional read replica for read scaling

### Mojaloop Service HA

Each Mojaloop service runs with:

- **Replicas**: Minimum 2 replicas per service
- **Pod Disruption Budget**: At least 1 pod always available
- **Horizontal Pod Autoscaler**: Scale based on CPU (70% target)
- **Anti-Affinity**: Pods spread across availability zones

### TigerBeetle HA

TigerBeetle provides its own HA through:

- **Consensus**: Viewstamped Replication for fault tolerance
- **Durability**: Direct I/O with strict fsync guarantees
- **Recovery**: Automatic recovery from replica failures

## Integration Flow

### Outbound Transfer (Platform → External DFSP)

```
1. User initiates transfer in PWA/Mobile
2. Transaction Service receives request
3. Mojaloop Connector creates quote via local hub
4. Hub routes quote to destination DFSP
5. Quote response received, user confirms
6. TigerBeetle: Create pending transfer (reserve funds)
7. Mojaloop Connector initiates transfer via hub
8. Hub routes transfer to destination DFSP
9. Transfer fulfilled/rejected callback received
10. TigerBeetle: Post or void pending transfer
11. PostgreSQL: Update transfer state
```

### Inbound Transfer (External DFSP → Platform)

```
1. Hub receives transfer from external DFSP
2. Callback handler receives notification
3. PostgreSQL: Record transfer metadata
4. TigerBeetle: Create pending transfer (credit user)
5. Validate and accept/reject transfer
6. TigerBeetle: Post pending transfer
7. PostgreSQL: Update transfer state
8. Notify user via push notification
```

### Settlement Flow

```
1. Settlement window closes (scheduled or manual)
2. Hub calculates net positions per participant
3. PostgreSQL: Record settlement window content
4. Reconciliation: Compare with TigerBeetle balances
5. If matched: Proceed with settlement
6. If discrepancy: Flag for manual review
7. Settlement completed, new window opens
```

## Future Compatibility

### Mojaloop Version Upgrades

To maintain compatibility with future Mojaloop versions:

1. **No Forks**: Use official Mojaloop images without modification
2. **Configuration Only**: All customization via Helm values
3. **Standard APIs**: Integration only via documented FSPIOP APIs
4. **Schema Migrations**: Let Mojaloop manage its own schema migrations

### PostgreSQL Support

Mojaloop's PostgreSQL support status:

- **Knex.js**: Mojaloop uses Knex.js which supports PostgreSQL
- **Configuration**: Set `db.type: postgres` in Helm values
- **Testing**: Run integration tests against PostgreSQL before upgrades
- **Fallback**: If PostgreSQL issues arise, can switch to MySQL

### Upgrade Process

```
1. Review Mojaloop release notes for breaking changes
2. Test new version in staging environment
3. Backup PostgreSQL databases
4. Update Helm chart version
5. Apply Helm upgrade with rolling deployment
6. Verify all services healthy
7. Run reconciliation to verify data integrity
```

## Deployment

### Prerequisites

- EKS cluster with sufficient capacity
- RDS PostgreSQL instance (Multi-AZ)
- MSK Kafka cluster
- ElastiCache Redis cluster
- Secrets Manager for credentials

### Helm Deployment

```bash
# Add Mojaloop Helm repo
helm repo add mojaloop https://mojaloop.github.io/helm

# Create namespace
kubectl create namespace mojaloop

# Deploy with custom values
helm upgrade --install mojaloop mojaloop/mojaloop \
  --namespace mojaloop \
  --values infrastructure/mojaloop-hub/values.yaml \
  --set global.config.db.host=$MOJALOOP_DB_HOST \
  --set global.config.db.password=$MOJALOOP_DB_PASSWORD
```

### Schema Initialization

```bash
# Connect to RDS and run schema
psql -h $MOJALOOP_DB_HOST -U mojaloop_admin -d mojaloop_hub \
  -f infrastructure/mojaloop-hub/postgres-schema.sql
```

## Monitoring

### Metrics

Prometheus scrapes metrics from all Mojaloop services:

- Transfer latency (p50, p95, p99)
- Transfer success/failure rates
- Quote response times
- Settlement window duration
- Callback delivery success rate

### Alerts

Critical alerts configured:

- Transfer failure rate > 5%
- Quote timeout rate > 10%
- Settlement reconciliation discrepancy
- Database connection pool exhaustion
- Callback delivery failures

### Dashboards

Grafana dashboards for:

- Mojaloop Hub Overview
- Transfer Flow Analysis
- Settlement Window Status
- Reconciliation Status
- Database Performance

## Security

### Network Security

- Mojaloop services in private subnets
- Network policies restrict pod-to-pod communication
- Ingress only via API Gateway
- TLS for all internal communication

### Authentication

- mTLS between Mojaloop services
- JWT tokens for API authentication
- Secrets stored in AWS Secrets Manager
- Vault integration for dynamic credentials

### Audit

- All API calls logged
- Transfer state changes audited
- Settlement actions logged
- Reconciliation results recorded

## Troubleshooting

### Common Issues

1. **Transfer Stuck in RESERVED**
   - Check TigerBeetle for pending transfer status
   - Verify callback was received
   - Check for network issues to destination DFSP

2. **Reconciliation Discrepancy**
   - Compare Mojaloop position with TigerBeetle balance
   - Check for failed callbacks
   - Review audit logs for missing state changes

3. **Settlement Window Not Closing**
   - Check for pending transfers
   - Verify all participants have responded
   - Review settlement service logs

### Useful Commands

```bash
# Check Mojaloop pod status
kubectl get pods -n mojaloop

# View central-ledger logs
kubectl logs -n mojaloop -l app=central-ledger

# Check PostgreSQL connections
psql -h $MOJALOOP_DB_HOST -U mojaloop_admin -c "SELECT * FROM pg_stat_activity"

# Run reconciliation
python -m core-services.common.tigerbeetle_reconcile
```
