# Fluvio Production Deployment

## Overview

Fluvio is a high-performance, distributed streaming platform used in the Nigerian Remittance Platform for real-time event processing, audit logging, and transaction streaming.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Fluvio Cluster                           │
│                                                              │
│  ┌──────────────┐                                           │
│  │   SC (1)     │  ← Streaming Controller                   │
│  │  Port 9003   │                                           │
│  └──────────────┘                                           │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  SPU-0       │  │  SPU-1       │  │  SPU-2       │     │
│  │  Port 9005   │  │  Port 9005   │  │  Port 9005   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

- **High Throughput**: 10,000+ messages/second
- **Low Latency**: < 5ms p99 latency
- **High Availability**: 3-node SPU cluster with replication
- **Durability**: Persistent storage with 100Gi per SPU
- **Monitoring**: Comprehensive Prometheus metrics and Grafana dashboards

## Topics

| Topic | Partitions | Replication | Retention | Purpose |
|-------|------------|-------------|-----------|---------|
| audit-logs | 6 | 3 | 7 days | Audit trail |
| transaction-events | 12 | 3 | 30 days | Transaction processing |
| security-alerts | 3 | 3 | 90 days | Security monitoring |
| performance-metrics | 6 | 3 | 3 days | Performance data |
| user-activity | 6 | 3 | 14 days | User actions |
| system-events | 3 | 3 | 7 days | System events |

## Quick Start

### Prerequisites

- Kubernetes 1.24+
- kubectl configured
- 300Gi+ storage available
- Prometheus and Grafana (for monitoring)

### Installation

```bash
# Create namespace
kubectl create namespace remittance-platform

# Deploy Fluvio
kubectl apply -f k8s/fluvio-statefulset.yaml

# Verify deployment
kubectl get pods -n remittance-platform -l app=fluvio

# Check logs
kubectl logs -n remittance-platform fluvio-sc-0
kubectl logs -n remittance-platform fluvio-spu-0
```

### Configuration

See [CONFIGURATION.md](CONFIGURATION.md) for detailed configuration options.

### Monitoring

Access Grafana dashboard: http://grafana.example.com/d/fluvio

Key metrics:
- Cluster health
- Message throughput
- Consumer lag
- Latency (p95, p99)

## API Reference

See [API_REFERENCE.md](API_REFERENCE.md) for complete API documentation.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

## Operations

See [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) for operational procedures.

## Security

See [SECURITY.md](SECURITY.md) for security configuration and best practices.

## Disaster Recovery

See [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) for backup and recovery procedures.

## Performance

- **Throughput**: 10,000+ msg/s (tested)
- **Latency**: p95 < 3ms, p99 < 5ms
- **Availability**: 99.9% SLA

## Support

For issues or questions, contact the platform team.

## License

Proprietary - Nigerian Remittance Platform
