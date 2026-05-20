# OpenAppSec Troubleshooting Guide

## Common Issues

### Issue 1: High False Positive Rate

**Symptoms**: Legitimate requests being blocked

**Diagnosis**:
```bash
# Check blocked requests
kubectl logs -l app=openappsec | grep "blocked"

# Check metrics
curl http://openappsec:9093/metrics | grep false_positive
```

**Solutions**:
- Tune WAF rules
- Add whitelist rules
- Switch to monitoring mode temporarily
- Review and adjust patterns

### Issue 2: Performance Degradation

**Symptoms**: High latency, slow response times

**Diagnosis**:
```bash
# Check resource usage
kubectl top pod -l app=openappsec

# Check latency metrics
curl http://openappsec:9093/metrics | grep latency
```

**Solutions**:
- Increase resources (CPU, memory)
- Scale horizontally
- Enable caching
- Optimize rules

### Issue 3: Integration Issues with APISIX

**Symptoms**: OpenAppSec not receiving traffic

**Diagnosis**:
```bash
# Check APISIX plugin status
kubectl exec -it apisix-0 -- curl http://localhost:9180/apisix/admin/plugins

# Check OpenAppSec connectivity
kubectl exec -it apisix-0 -- curl http://openappsec:8080/health
```

**Solutions**:
- Verify plugin configuration
- Check service endpoints
- Verify network policies
- Check APISIX logs

### Issue 4: Attack Not Detected

**Symptoms**: Known attacks passing through

**Diagnosis**:
```bash
# Check WAF mode
kubectl get configmap openappsec-config -o yaml

# Test with known attack
curl "http://api.example.com/search?q=' OR '1'='1"
```

**Solutions**:
- Ensure WAF is in blocking mode
- Update attack signatures
- Enable all security modules
- Check rule priorities

## Debugging Commands

### Check Security Status

```bash
# Get security status
curl http://openappsec:8080/status

# Check active rules
curl http://openappsec:8080/rules
```

### View Attack Logs

```bash
# View recent attacks
kubectl logs -l app=openappsec --tail=100 | grep "attack"

# View blocked requests
kubectl logs -l app=openappsec | grep "blocked"
```

### Test Security Policies

```bash
# Run security tests
pytest tests/security/test_openappsec_security.py -v

# Test specific attack type
pytest tests/security/test_openappsec_security.py::TestSQLInjection -v
```

## Performance Debugging

### Identify Bottlenecks

```bash
# Check CPU usage
kubectl top pod -l app=openappsec

# Check memory usage
kubectl top pod -l app=openappsec

# Check request rate
curl http://openappsec:9093/metrics | grep request_rate
```

### Profiling

```bash
# Enable profiling
kubectl set env deployment/openappsec OPENAPPSEC_PROFILE=true

# Collect profile data
kubectl exec openappsec-0 -- curl http://localhost:8080/debug/pprof/profile
```

## Recovery Procedures

### Reset Configuration

```bash
# Backup current config
kubectl get configmap openappsec-config -o yaml > backup.yaml

# Reset to default
kubectl delete configmap openappsec-config
kubectl apply -f config/default-config.yaml

# Restart pods
kubectl rollout restart deployment/openappsec
```

### Clear Cache

```bash
# Clear rule cache
kubectl exec openappsec-0 -- curl -X POST http://localhost:8080/admin/cache/clear

# Restart service
kubectl rollout restart deployment/openappsec
```

## Monitoring and Alerts

### Check Grafana Dashboard

```bash
# Access dashboard
open http://grafana.example.com/d/openappsec
```

### Check Prometheus Alerts

```bash
# View active alerts
kubectl port-forward svc/prometheus 9090:9090
open http://localhost:9090/alerts
```

### Configure Alerting

```yaml
alerts:
  - name: HighAttackRate
    condition: rate(attacks_detected) > 100
    severity: warning
  
  - name: CriticalVulnerability
    condition: critical_vulnerabilities > 0
    severity: critical
```
