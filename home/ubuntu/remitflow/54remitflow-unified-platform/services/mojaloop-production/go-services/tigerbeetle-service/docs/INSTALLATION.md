# TigerBeetle Installation Guide

## Prerequisites

- Kubernetes 1.24+
- kubectl configured
- Helm 3.0+
- 300Gi+ fast SSD storage
- Go 1.21+ (for development)

## Installation Steps

### 1. Create Namespace

```bash
kubectl create namespace remittance-platform
```

### 2. Install TigerBeetle using Helm

```bash
helm install tigerbeetle ./helm \
  --namespace remittance-platform \
  --values helm/values.yaml
```

### 3. Verify Installation

```bash
# Check pods
kubectl get pods -n remittance-platform -l app=tigerbeetle

# Check StatefulSet
kubectl get statefulset -n remittance-platform tigerbeetle

# Check services
kubectl get svc -n remittance-platform -l app=tigerbeetle
```

### 4. Initialize Cluster

```bash
# The cluster is automatically initialized by the init container
# Verify cluster status
kubectl exec -it tigerbeetle-0 -n remittance-platform -- tigerbeetle status
```

### 5. Deploy TigerBeetle Service

```bash
# Build and push Docker image
docker build -t nigerian-remittance/tigerbeetle-service:latest ./cmd
docker push nigerian-remittance/tigerbeetle-service:latest

# Deploy service
kubectl apply -f k8s/tigerbeetle-statefulset.yaml
```

## Post-Installation

### Verify Cluster Health

```bash
# Check all nodes are up
kubectl get pods -n remittance-platform -l app=tigerbeetle

# Check metrics
kubectl port-forward svc/tigerbeetle-service 9092:9092
curl http://localhost:9092/metrics
```

### Create Test Accounts

```bash
# Use the Go client
go run examples/create_account.go
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.
