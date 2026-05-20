# TigerBeetle Troubleshooting Guide

## Common Issues

### Issue 1: Node Not Starting

**Symptoms**: Pod in CrashLoopBackOff state

**Diagnosis**:
```bash
kubectl logs tigerbeetle-0 -n remittance-platform
kubectl describe pod tigerbeetle-0 -n remittance-platform
```

**Common Causes**:
- Storage not available
- Insufficient resources
- Data file corruption

**Solutions**:
```bash
# Check PVC status
kubectl get pvc -n remittance-platform

# Check storage class
kubectl get storageclass

# Increase resources in values.yaml
resources:
  requests:
    cpu: 4000m
    memory: 8Gi
```

### Issue 2: High Latency

**Symptoms**: Transfer latency > 10ms

**Diagnosis**:
```bash
# Check metrics
kubectl port-forward svc/tigerbeetle-service 9092:9092
curl http://localhost:9092/metrics | grep latency
```

**Solutions**:
- Use faster storage (NVMe SSD)
- Increase cache size
- Reduce network latency
- Scale horizontally

### Issue 3: Cluster Split Brain

**Symptoms**: Multiple leaders elected

**Diagnosis**:
```bash
# Check cluster status on each node
for i in 0 1 2; do
  kubectl exec tigerbeetle-$i -- tigerbeetle status
done
```

**Solutions**:
- Ensure network connectivity between nodes
- Check anti-affinity rules
- Verify Raft configuration

### Issue 4: Data Corruption

**Symptoms**: Checksum errors in logs

**Diagnosis**:
```bash
kubectl logs tigerbeetle-0 | grep -i "checksum\|corrupt"
```

**Solutions**:
- Restore from backup
- Use storage with checksumming (ZFS, Btrfs)
- Enable ECC memory

## Debugging Commands

### Check Cluster Health

```bash
# Get cluster status
kubectl exec tigerbeetle-0 -- tigerbeetle status

# Check replication lag
kubectl exec tigerbeetle-0 -- tigerbeetle replication-lag
```

### Check Metrics

```bash
# Port forward metrics endpoint
kubectl port-forward svc/tigerbeetle-service 9092:9092

# Query metrics
curl http://localhost:9092/metrics
```

### Check Logs

```bash
# View logs
kubectl logs -f tigerbeetle-0

# View logs from all replicas
kubectl logs -l app=tigerbeetle --all-containers=true
```

## Performance Debugging

### Identify Bottlenecks

```bash
# Check CPU usage
kubectl top pod -n remittance-platform -l app=tigerbeetle

# Check memory usage
kubectl top pod -n remittance-platform -l app=tigerbeetle

# Check disk I/O
kubectl exec tigerbeetle-0 -- iostat -x 1
```

### Profiling

```bash
# Enable profiling
export TIGERBEETLE_PROFILE=true

# Collect profile data
kubectl exec tigerbeetle-0 -- tigerbeetle profile
```

## Recovery Procedures

### Restore from Backup

```bash
# Stop cluster
kubectl scale statefulset tigerbeetle --replicas=0

# Restore data
kubectl exec tigerbeetle-0 -- restore-backup.sh

# Start cluster
kubectl scale statefulset tigerbeetle --replicas=3
```

### Rebuild Replica

```bash
# Delete pod
kubectl delete pod tigerbeetle-2

# Pod will be recreated and sync from leader
kubectl wait --for=condition=ready pod/tigerbeetle-2
```
