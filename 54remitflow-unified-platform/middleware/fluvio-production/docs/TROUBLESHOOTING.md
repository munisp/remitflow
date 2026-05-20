# Fluvio Troubleshooting Guide

## Common Issues

### Issue 1: SPU Not Starting

**Symptoms**: SPU pod in CrashLoopBackOff

**Solution**:
```bash
kubectl logs fluvio-spu-0
kubectl describe pod fluvio-spu-0
```

Check storage class and PVC status.

### Issue 2: High Consumer Lag

**Symptoms**: Consumer lag > 10,000 messages

**Solution**:
- Scale consumer replicas
- Increase partition count
- Optimize consumer code

### Issue 3: High Latency

**Symptoms**: p99 latency > 10ms

**Solution**:
- Check network latency
- Increase SPU resources
- Reduce batch size

## Debugging

```bash
# Check cluster health
kubectl exec fluvio-sc-0 -- fluvio cluster status

# Check topic status
kubectl exec fluvio-sc-0 -- fluvio topic list

# Check consumer lag
kubectl exec fluvio-sc-0 -- fluvio consumer lag
```
