# Fluvio Installation Guide

## Prerequisites

- Kubernetes 1.24+
- kubectl configured
- Helm 3.0+
- 300Gi+ storage available

## Installation Steps

### 1. Add Helm Repository

```bash
helm repo add nigerian-remittance https://charts.nigerian-remittance.com
helm repo update
```

### 2. Install Fluvio

```bash
helm install fluvio nigerian-remittance/fluvio \
  --namespace remittance-platform \
  --create-namespace \
  --values values.yaml
```

### 3. Verify Installation

```bash
kubectl get pods -n remittance-platform -l app=fluvio
kubectl logs -n remittance-platform fluvio-sc-0
```

### 4. Create Topics

```bash
kubectl exec -it fluvio-sc-0 -- fluvio topic create audit-logs --partitions 6 --replication 3
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.
