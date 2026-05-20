# TigerBeetle Configuration Guide

## Configuration Files

### tigerbeetle.yaml

```yaml
cluster:
  replicas: 3
  addresses:
    - tigerbeetle-0:3001
    - tigerbeetle-1:3001
    - tigerbeetle-2:3001

cache:
  grid_size: 1GB

ledgers:
  - id: 1
    name: "NGN"
    currency: "NGN"
  - id: 2
    name: "USD"
    currency: "USD"

accounts:
  default_flags: 0

transfers:
  timeout_ms: 1000
```

## Environment Variables

### TigerBeetle Node

- `TIGERBEETLE_CLUSTER_ID`: Cluster ID (default: 1)
- `TIGERBEETLE_REPLICA_COUNT`: Number of replicas (default: 3)
- `TIGERBEETLE_CACHE_SIZE_MB`: Cache size in MB (default: 1024)

### TigerBeetle Service

- `TIGERBEETLE_ADDRESS_0`: Address of node 0
- `TIGERBEETLE_ADDRESS_1`: Address of node 1
- `TIGERBEETLE_ADDRESS_2`: Address of node 2
- `SERVICE_PORT`: gRPC service port (default: 50051)
- `HTTP_PORT`: HTTP API port (default: 8080)
- `METRICS_PORT`: Prometheus metrics port (default: 9092)

## Performance Tuning

### Cache Configuration

```yaml
cache:
  grid_size: 2GB  # Increase for higher throughput
```

### Resource Allocation

```yaml
resources:
  requests:
    cpu: 4000m      # Increase for higher load
    memory: 8Gi
  limits:
    cpu: 16000m
    memory: 32Gi
```

### Storage Configuration

```yaml
storage:
  storageClass: fast-ssd  # Use fastest available storage
  size: 500Gi             # Increase as needed
```

## Security Configuration

### TLS Configuration

```yaml
tls:
  enabled: true
  certFile: /etc/tls/tls.crt
  keyFile: /etc/tls/tls.key
```

### RBAC Configuration

```yaml
rbac:
  enabled: true
  serviceAccount: tigerbeetle
```

## High Availability

### Replication

- Minimum 3 nodes for fault tolerance
- Raft consensus protocol
- Automatic leader election

### Pod Disruption Budget

```yaml
minAvailable: 2  # Always keep 2 nodes running
```

### Anti-Affinity

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - topologyKey: kubernetes.io/hostname
```
