# OpenAppSec Installation Guide

## Prerequisites

- Kubernetes 1.24+
- Apache APISIX deployed
- kubectl configured
- Helm 3.0+

## Installation Steps

### 1. Add Helm Repository

```bash
helm repo add openappsec https://openappsec.github.io/charts
helm repo update
```

### 2. Install OpenAppSec

```bash
helm install openappsec openappsec/openappsec \
  --namespace remittance-platform \
  --create-namespace \
  --values values.yaml
```

### 3. Configure APISIX Plugin

```bash
# Apply APISIX plugin configuration
kubectl apply -f k8s/apisix-openappsec-plugin.yaml
```

### 4. Verify Installation

```bash
# Check pods
kubectl get pods -n remittance-platform -l app=openappsec

# Check logs
kubectl logs -l app=openappsec -n remittance-platform
```

### 5. Test Security Policies

```bash
# Run security tests
pytest tests/security/test_openappsec_security.py -v
```

## Configuration

### Enable WAF

```yaml
security:
  waf:
    enabled: true
    mode: blocking
```

### Enable API Security

```yaml
security:
  api:
    enabled: true
    schema_validation: true
```

### Enable Bot Protection

```yaml
security:
  bot:
    enabled: true
    challenge: captcha
```

## Post-Installation

### Verify Security Policies

```bash
# Check WAF status
curl http://openappsec-service:8080/status

# Test SQL injection protection
curl "http://api.example.com/search?q=' OR '1'='1"
# Should return 403 Forbidden
```

### Monitor Attacks

```bash
# View Grafana dashboard
open http://grafana.example.com/d/openappsec

# Check Prometheus metrics
kubectl port-forward svc/openappsec 9093:9093
curl http://localhost:9093/metrics
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.
