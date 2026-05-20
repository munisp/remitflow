# Fluvio Configuration Guide

## Configuration Files

### fluvio.yaml

```yaml
cluster:
  name: remittance-platform
  replication_factor: 3

topics:
  - name: audit-logs
    partitions: 6
    replication: 3
    retention_hours: 168
```

## Environment Variables

- `FLUVIO_CLUSTER_URL`: Cluster URL
- `FLUVIO_PROFILE`: Profile name
- `FLUVIO_PRODUCER_BATCH_SIZE`: Batch size
- `FLUVIO_PRODUCER_FLUSH_INTERVAL`: Flush interval

## Tuning

### Performance Tuning

- Increase batch size for higher throughput
- Adjust flush interval for lower latency
- Scale SPUs horizontally

### Resource Tuning

- CPU: 1-4 cores per SPU
- Memory: 2-8 GB per SPU
- Disk: 100-500 GB per SPU
