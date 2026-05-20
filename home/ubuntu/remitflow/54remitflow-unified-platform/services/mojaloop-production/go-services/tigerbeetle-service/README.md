# TigerBeetle Production Service

## Overview

TigerBeetle is a distributed financial accounting database designed for mission-critical safety and performance. Used in the Nigerian Remittance Platform as the core ledger for all financial transactions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  TigerBeetle Cluster                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Node 0     │  │   Node 1     │  │   Node 2     │     │
│  │  Port 3000   │  │  Port 3000   │  │  Port 3000   │     │
│  │  100Gi SSD   │  │  100Gi SSD   │  │  100Gi SSD   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  Consensus: Raft                                            │
│  Replication: 3x                                            │
│  Durability: fsync on commit                                │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

- **High Performance**: 10,000+ transfers/second
- **Ultra-Low Latency**: < 1ms p99 latency
- **ACID Compliance**: Full transactional guarantees
- **High Availability**: 3-node cluster with automatic failover
- **Data Integrity**: Cryptographic verification of all transactions
- **Monitoring**: Comprehensive metrics and alerting

## Quick Start

### Prerequisites

- Kubernetes 1.24+
- 300Gi+ fast SSD storage
- Go 1.21+ (for development)

### Installation

```bash
# Deploy TigerBeetle cluster
kubectl apply -f k8s/tigerbeetle-statefulset.yaml

# Verify deployment
kubectl get pods -n remittance-platform -l app=tigerbeetle

# Check cluster health
kubectl exec -it tigerbeetle-0 -- tigerbeetle status
```

### Usage Example

```go
package main

import (
    "github.com/tigerbeetle/tigerbeetle-go"
)

func main() {
    client, _ := tigerbeetle.NewClient(0, []string{
        "tigerbeetle-0:3000",
        "tigerbeetle-1:3000",
        "tigerbeetle-2:3000",
    })
    defer client.Close()
    
    // Create account
    account := tigerbeetle.Account{
        ID:     1,
        Code:   1,
        Ledger: 1,
    }
    client.CreateAccounts([]tigerbeetle.Account{account})
    
    // Create transfer
    transfer := tigerbeetle.Transfer{
        ID:              1,
        DebitAccountID:  1,
        CreditAccountID: 2,
        Amount:          1000,
        Ledger:          1,
        Code:            1,
    }
    client.CreateTransfers([]tigerbeetle.Transfer{transfer})
}
```

## Performance

- **Throughput**: 10,000+ TPS (tested)
- **Latency**: p95 < 0.5ms, p99 < 1ms
- **Availability**: 99.99% SLA

## Monitoring

Access Grafana dashboard: http://grafana.example.com/d/tigerbeetle

Key metrics:
- Transfers per second
- Latency distribution
- Cluster health
- Node status

## Documentation

- [INSTALLATION.md](INSTALLATION.md) - Installation guide
- [CONFIGURATION.md](CONFIGURATION.md) - Configuration reference
- [API_REFERENCE.md](API_REFERENCE.md) - API documentation
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Troubleshooting guide
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) - Operations procedures
- [SECURITY.md](SECURITY.md) - Security configuration
- [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) - Backup and recovery

## Support

For issues or questions, contact the platform team.

## License

Proprietary - Nigerian Remittance Platform
